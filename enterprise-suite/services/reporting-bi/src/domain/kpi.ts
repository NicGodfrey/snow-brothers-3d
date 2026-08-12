/**
 * KPI definitions and snapshots.
 *
 * A KPI is a metric plus the context that makes it judgeable: a filter, a
 * period grain, a target, and thresholds. Without the target a number is
 * trivia; with it, "revenue 1.2M" becomes "revenue 1.2M, 94% of target,
 * worsening" — which is the only form a dashboard can act on.
 *
 * Attainment normalises direction: for a lower-is-better KPI (defect rate,
 * days-to-close) the ratio is inverted, so 1.0 always means "on target" and
 * every threshold band reads the same way across the whole scorecard.
 */
import {
  AggregateRoot,
  ConflictError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { DefinitionError } from "./errors.js";
import { ReportingEventTypes } from "./events.js";
import { assertMetricCode, type MetricDirection, type MetricUnit } from "./metric.js";
import type { DimensionFilter } from "./query.js";
import { isTimeGrain, type TimeGrain } from "./time-grain.js";

export type KpiStatus = "on-track" | "watch" | "at-risk" | "off-track" | "no-target" | "no-data";

export type KpiTrend = "improving" | "worsening" | "flat" | "unknown";

export interface KpiThresholds {
  /** Attainment at or above this is still "watch" rather than "at-risk". */
  readonly warning: number;
  /** Below this the KPI is "off-track". */
  readonly critical: number;
}

export const DEFAULT_THRESHOLDS: KpiThresholds = { warning: 0.95, critical: 0.85 };

interface KpiProps {
  code: string;
  name: string;
  description?: string;
  cube: string;
  metricCode: string;
  unit: MetricUnit;
  direction: MetricDirection;
  grain: TimeGrain;
  filters: DimensionFilter[];
  target?: number;
  thresholds: KpiThresholds;
  /** How many trailing periods the sparkline covers. */
  sparklinePeriods: number;
  owner?: string;
  active: boolean;
}

export interface DefineKpiInput {
  code: string;
  name: string;
  cube: string;
  metricCode: string;
  unit: MetricUnit;
  description?: string;
  direction?: MetricDirection;
  grain?: TimeGrain;
  filters?: readonly DimensionFilter[];
  target?: number;
  thresholds?: Partial<KpiThresholds>;
  sparklinePeriods?: number;
  owner?: string;
}

export class KpiDefinition extends AggregateRoot<KpiProps> {
  private constructor(tenantId: TenantId, props: KpiProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static define(tenantId: TenantId, input: DefineKpiInput): KpiDefinition {
    const code = assertMetricCode(input.code);
    if (!input.name.trim()) throw new DefinitionError(`KPI '${code}' needs a name`);
    if (input.grain && !isTimeGrain(input.grain)) {
      throw new DefinitionError(`KPI '${code}' has unknown grain '${input.grain}'`);
    }
    const thresholds = normalizeThresholds(code, input.thresholds);
    const sparklinePeriods = input.sparklinePeriods ?? 12;
    if (!Number.isInteger(sparklinePeriods) || sparklinePeriods < 2 || sparklinePeriods > 104) {
      throw new DefinitionError(`KPI '${code}' sparklinePeriods must be an integer 2..104`);
    }
    if (input.target !== undefined && !Number.isFinite(input.target)) {
      throw new DefinitionError(`KPI '${code}' target must be a finite number`);
    }

    const kpi = new KpiDefinition(tenantId, {
      code,
      name: input.name.trim(),
      description: input.description?.trim(),
      cube: input.cube,
      metricCode: input.metricCode,
      unit: input.unit,
      direction: input.direction ?? "higher-is-better",
      grain: input.grain ?? "month",
      filters: [...(input.filters ?? [])],
      target: input.target,
      thresholds,
      sparklinePeriods,
      owner: input.owner,
      active: true,
    });
    kpi.raise(
      envelope({
        eventType: ReportingEventTypes.KpiDefined,
        aggregateType: "KpiDefinition",
        aggregateId: kpi.id,
        tenantId,
        payload: { code, cube: input.cube, metricCode: input.metricCode, target: input.target },
      }),
    );
    return kpi;
  }

  static rehydrate(tenantId: TenantId, props: KpiProps, existing: Partial<EntityProps>): KpiDefinition {
    return new KpiDefinition(tenantId, props, existing);
  }

  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get description(): string | undefined { return this.props.description; }
  get cube(): string { return this.props.cube; }
  get metricCode(): string { return this.props.metricCode; }
  get unit(): MetricUnit { return this.props.unit; }
  get direction(): MetricDirection { return this.props.direction; }
  get grain(): TimeGrain { return this.props.grain; }
  get filters(): readonly DimensionFilter[] { return this.props.filters; }
  get target(): number | undefined { return this.props.target; }
  get thresholds(): KpiThresholds { return this.props.thresholds; }
  get sparklinePeriods(): number { return this.props.sparklinePeriods; }
  get owner(): string | undefined { return this.props.owner; }
  get active(): boolean { return this.props.active; }

  retarget(target: number | undefined, thresholds?: Partial<KpiThresholds>): void {
    if (!this.props.active) throw new ConflictError(`KPI '${this.props.code}' is retired`);
    if (target !== undefined && !Number.isFinite(target)) {
      throw new DefinitionError(`KPI '${this.props.code}' target must be a finite number`);
    }
    this.props.target = target;
    if (thresholds) this.props.thresholds = normalizeThresholds(this.props.code, thresholds);
    this.touch();
  }

  refilter(filters: readonly DimensionFilter[]): void {
    if (!this.props.active) throw new ConflictError(`KPI '${this.props.code}' is retired`);
    this.props.filters = [...filters];
    this.touch();
  }

  retire(): void {
    if (!this.props.active) throw new ConflictError(`KPI '${this.props.code}' is already retired`);
    this.props.active = false;
    this.touch();
  }
}

function normalizeThresholds(code: string, input?: Partial<KpiThresholds>): KpiThresholds {
  const warning = input?.warning ?? DEFAULT_THRESHOLDS.warning;
  const critical = input?.critical ?? DEFAULT_THRESHOLDS.critical;
  for (const [label, value] of [["warning", warning], ["critical", critical]] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 2) {
      throw new DefinitionError(`KPI '${code}' ${label} threshold must be a ratio in (0, 2]`);
    }
  }
  if (critical >= warning) {
    throw new DefinitionError(
      `KPI '${code}' critical threshold (${critical}) must be below the warning threshold (${warning})`,
    );
  }
  return { warning, critical };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface SparklinePoint {
  readonly period: string;
  readonly value: number | null;
}

export interface KpiSnapshot {
  readonly kpiCode: string;
  readonly name: string;
  readonly unit: MetricUnit;
  readonly direction: MetricDirection;
  readonly grain: TimeGrain;
  readonly period: string;
  readonly periodLabel: string;
  readonly value: number | null;
  readonly previousValue: number | null;
  readonly targetValue: number | null;
  /** 1.0 = exactly on target, direction-normalised. Null without a target. */
  readonly attainment: number | null;
  readonly variance: number | null;
  readonly variancePct: number | null;
  readonly changeVsPrevious: number | null;
  readonly changePct: number | null;
  readonly status: KpiStatus;
  readonly trend: KpiTrend;
  readonly sparkline: readonly SparklinePoint[];
  readonly computedAt: IsoDateTime;
}

/**
 * Direction-normalised progress toward target. Lower-is-better KPIs invert
 * the ratio, so 40 against a target of 50 scores 1.25 (beating target) for
 * a defect rate and 0.8 (missing it) for revenue.
 */
export function attainmentOf(
  value: number | null,
  target: number | null,
  direction: MetricDirection,
): number | null {
  if (value === null || target === null) return null;
  if (direction === "lower-is-better") {
    if (value === 0) return target === 0 ? 1 : 2;
    return target / value;
  }
  if (target === 0) return value >= 0 ? 1 : 0;
  return value / target;
}

export function statusFor(
  value: number | null,
  attainment: number | null,
  thresholds: KpiThresholds,
): KpiStatus {
  if (value === null) return "no-data";
  if (attainment === null) return "no-target";
  if (attainment >= 1) return "on-track";
  if (attainment >= thresholds.warning) return "watch";
  if (attainment >= thresholds.critical) return "at-risk";
  return "off-track";
}

/** Ranked worst-first, so a scorecard can sort by "needs attention". */
export const STATUS_SEVERITY: Readonly<Record<KpiStatus, number>> = {
  "off-track": 0,
  "at-risk": 1,
  watch: 2,
  "no-data": 3,
  "no-target": 4,
  "on-track": 5,
};

/** Period-over-period movement, with a dead band so noise is not a trend. */
export function trendOf(
  value: number | null,
  previous: number | null,
  direction: MetricDirection,
  deadBandPct = 0.5,
): KpiTrend {
  if (value === null || previous === null) return "unknown";
  if (previous === 0) return value === 0 ? "flat" : direction === "lower-is-better" ? "worsening" : "improving";
  const changePct = ((value - previous) / Math.abs(previous)) * 100;
  if (Math.abs(changePct) < deadBandPct) return "flat";
  const better = direction === "lower-is-better" ? changePct < 0 : changePct > 0;
  if (direction === "neutral") return "flat";
  return better ? "improving" : "worsening";
}

export function buildSnapshot(
  kpi: KpiDefinition,
  input: {
    period: string;
    periodLabel: string;
    value: number | null;
    previousValue: number | null;
    sparkline: readonly SparklinePoint[];
    computedAt: IsoDateTime;
  },
): KpiSnapshot {
  const target = kpi.target ?? null;
  const attainment = attainmentOf(input.value, target, kpi.direction);
  const variance = input.value === null || target === null ? null : input.value - target;
  const variancePct =
    variance === null || target === null || target === 0 ? null : (variance / Math.abs(target)) * 100;
  const changeVsPrevious =
    input.value === null || input.previousValue === null ? null : input.value - input.previousValue;
  const changePct =
    changeVsPrevious === null || input.previousValue === null || input.previousValue === 0
      ? null
      : (changeVsPrevious / Math.abs(input.previousValue)) * 100;

  return {
    kpiCode: kpi.code,
    name: kpi.name,
    unit: kpi.unit,
    direction: kpi.direction,
    grain: kpi.grain,
    period: input.period,
    periodLabel: input.periodLabel,
    value: input.value,
    previousValue: input.previousValue,
    targetValue: target,
    attainment,
    variance,
    variancePct,
    changeVsPrevious,
    changePct,
    status: statusFor(input.value, attainment, kpi.thresholds),
    trend: trendOf(input.value, input.previousValue, kpi.direction),
    sparkline: [...input.sparkline],
    computedAt: input.computedAt,
  };
}
