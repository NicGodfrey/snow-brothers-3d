/**
 * KPI computation.
 *
 * A snapshot is produced by one dense time-series query over the KPI's
 * trailing window: the last bucket is the current value, the one before it
 * the comparison, and the whole series is the sparkline. Densifying matters
 * here — a period with no facts must read as zero-or-null in the series, not
 * shift the previous period into the current slot.
 *
 * Status transitions are diffed against the last stored snapshot so
 * alerting fires on the *edge* (on-track -> at-risk) rather than every time
 * the KPI is recomputed while still unhealthy.
 */
import {
  brand,
  ConflictError,
  envelope,
  NotFoundError,
  type EventEnvelope,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  ReportingEventTypes,
  type KpiSnapshotComputedPayload,
  type KpiThresholdBreachedPayload,
} from "../domain/events.js";
import {
  buildSnapshot,
  KpiDefinition,
  STATUS_SEVERITY,
  type DefineKpiInput,
  type KpiSnapshot,
  type KpiStatus,
  type SparklinePoint,
} from "../domain/kpi.js";
import type { DimensionFilter } from "../domain/query.js";
import type { KpiRepository, KpiSnapshotRepository } from "../domain/repositories.js";
import { bucketStart, periodKey, periodLabel, trailingRange } from "../domain/time-grain.js";
import type { Clock, Outbox } from "./ports.js";
import type { QueryService } from "./query-service.js";

/** Statuses that mean "someone should look at this". */
const ALERT_STATUSES: readonly KpiStatus[] = ["at-risk", "off-track"];

export interface ScorecardEntry {
  readonly snapshot: KpiSnapshot;
  readonly severity: number;
}

export class KpiService {
  constructor(
    private readonly kpis: KpiRepository,
    private readonly snapshots: KpiSnapshotRepository,
    private readonly queries: QueryService,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
  ) {}

  async defineKpi(ctx: TenantContext, input: DefineKpiInput): Promise<KpiDefinition> {
    const existing = await this.kpis.findByCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`KPI '${input.code}' already exists`);
    const kpi = KpiDefinition.define(ctx.tenantId, input);
    await this.kpis.save(kpi);
    await this.outbox.append(kpi.pullEvents());
    return kpi;
  }

  async getKpi(ctx: TenantContext, code: string): Promise<KpiDefinition> {
    const kpi = await this.kpis.findByCode(ctx.tenantId, code);
    if (!kpi) throw new NotFoundError("Kpi", code);
    return kpi;
  }

  async listKpis(ctx: TenantContext, filter?: { active?: boolean; cube?: string }): Promise<KpiDefinition[]> {
    return this.kpis.list(ctx.tenantId, filter);
  }

  async retarget(
    ctx: TenantContext,
    code: string,
    target: number | undefined,
    thresholds?: { warning?: number; critical?: number },
  ): Promise<KpiDefinition> {
    const kpi = await this.getKpi(ctx, code);
    kpi.retarget(target, thresholds);
    await this.kpis.save(kpi);
    return kpi;
  }

  async refilter(ctx: TenantContext, code: string, filters: readonly DimensionFilter[]): Promise<KpiDefinition> {
    const kpi = await this.getKpi(ctx, code);
    kpi.refilter(filters);
    await this.kpis.save(kpi);
    return kpi;
  }

  async retire(ctx: TenantContext, code: string): Promise<KpiDefinition> {
    const kpi = await this.getKpi(ctx, code);
    kpi.retire();
    await this.kpis.save(kpi);
    return kpi;
  }

  /** Computes, stores, and announces the snapshot for the current period. */
  async computeSnapshot(ctx: TenantContext, code: string, anchor?: IsoDateTime): Promise<KpiSnapshot> {
    const kpi = await this.getKpi(ctx, code);
    const at = anchor ?? this.clock.now();
    const series = await this.series(ctx, kpi, at);

    const currentPeriod = periodKey(bucketStart(at, kpi.grain), kpi.grain);
    const currentIndex = series.findIndex((point) => point.period === currentPeriod);
    const index = currentIndex === -1 ? series.length - 1 : currentIndex;
    const value = series[index]?.value ?? null;
    const previousValue = index > 0 ? (series[index - 1]?.value ?? null) : null;

    const previousSnapshot = await this.snapshots.latest(ctx.tenantId, code);
    const snapshot = buildSnapshot(kpi, {
      period: series[index]?.period ?? currentPeriod,
      periodLabel: periodLabel(series[index]?.period ?? currentPeriod, kpi.grain),
      value,
      previousValue,
      sparkline: series,
      computedAt: this.clock.now(),
    });
    await this.snapshots.save(ctx.tenantId, snapshot);
    await this.announce(ctx, snapshot, previousSnapshot?.status);
    return snapshot;
  }

  /** Recomputes every active KPI; used by the scheduler and dashboards. */
  async computeAll(ctx: TenantContext, anchor?: IsoDateTime): Promise<KpiSnapshot[]> {
    const kpis = await this.kpis.list(ctx.tenantId, { active: true });
    const snapshots: KpiSnapshot[] = [];
    for (const kpi of kpis) {
      snapshots.push(await this.computeSnapshot(ctx, kpi.code, anchor));
    }
    return snapshots;
  }

  /** Worst-first scorecard — the default "what needs attention" ordering. */
  async scorecard(ctx: TenantContext, codes?: readonly string[]): Promise<ScorecardEntry[]> {
    const kpis = codes
      ? await Promise.all(codes.map((code) => this.getKpi(ctx, code)))
      : await this.kpis.list(ctx.tenantId, { active: true });

    const entries: ScorecardEntry[] = [];
    for (const kpi of kpis) {
      const snapshot =
        (await this.snapshots.latest(ctx.tenantId, kpi.code)) ??
        (await this.computeSnapshot(ctx, kpi.code));
      entries.push({ snapshot, severity: STATUS_SEVERITY[snapshot.status] });
    }
    return entries.sort(
      (a, b) =>
        a.severity - b.severity ||
        (a.snapshot.attainment ?? 99) - (b.snapshot.attainment ?? 99) ||
        a.snapshot.kpiCode.localeCompare(b.snapshot.kpiCode),
    );
  }

  async history(ctx: TenantContext, code: string, limit = 24): Promise<KpiSnapshot[]> {
    await this.getKpi(ctx, code);
    return this.snapshots.history(ctx.tenantId, code, limit);
  }

  /** Dense trailing series for the KPI's metric at its own grain. */
  private async series(
    ctx: TenantContext,
    kpi: KpiDefinition,
    anchor: IsoDateTime,
  ): Promise<SparklinePoint[]> {
    const range = trailingRange(anchor, kpi.grain, kpi.sparklinePeriods);
    const result = await this.queries.run(ctx, {
      cube: kpi.cube,
      metrics: [kpi.metricCode],
      dimensions: [],
      timeGrain: kpi.grain,
      timeRange: range,
      filters: kpi.filters,
      densify: true,
      includeTotals: false,
      orderBy: [{ key: "period", direction: "asc" }],
      limit: kpi.sparklinePeriods,
    });
    return result.rows.map((row) => ({
      period: row.keys.period ?? "",
      value: row.metrics[kpi.metricCode] ?? null,
    }));
  }

  private async announce(
    ctx: TenantContext,
    snapshot: KpiSnapshot,
    previousStatus?: KpiStatus,
  ): Promise<void> {
    const computed: KpiSnapshotComputedPayload = {
      kpiCode: snapshot.kpiCode,
      period: snapshot.period,
      value: snapshot.value,
      previousValue: snapshot.previousValue,
      targetValue: snapshot.targetValue,
      status: snapshot.status,
    };
    const aggregateId: Ulid = brand<string, "Ulid">(snapshot.kpiCode);
    const events: EventEnvelope[] = [
      envelope({
        eventType: ReportingEventTypes.KpiSnapshotComputed,
        aggregateType: "Kpi",
        aggregateId,
        tenantId: ctx.tenantId,
        payload: computed,
      }),
    ];

    const isAlerting = ALERT_STATUSES.includes(snapshot.status);
    const wasAlerting = previousStatus !== undefined && ALERT_STATUSES.includes(previousStatus);
    if (isAlerting && !wasAlerting) {
      const breach: KpiThresholdBreachedPayload = {
        kpiCode: snapshot.kpiCode,
        period: snapshot.period,
        value: snapshot.value,
        targetValue: snapshot.targetValue,
        severity: snapshot.status === "off-track" ? "critical" : "warning",
        previousStatus: previousStatus ?? "unknown",
      };
      events.push(
        envelope({
          eventType: ReportingEventTypes.KpiThresholdBreached,
          aggregateType: "Kpi",
          aggregateId,
          tenantId: ctx.tenantId,
          payload: breach,
        }),
      );
    } else if (!isAlerting && wasAlerting && snapshot.status !== "no-data") {
      events.push(
        envelope({
          eventType: ReportingEventTypes.KpiRecovered,
          aggregateType: "Kpi",
          aggregateId,
          tenantId: ctx.tenantId,
          payload: {
            kpiCode: snapshot.kpiCode,
            period: snapshot.period,
            status: snapshot.status,
            previousStatus,
          },
        }),
      );
    }

    await this.outbox.append(events);
  }
}
