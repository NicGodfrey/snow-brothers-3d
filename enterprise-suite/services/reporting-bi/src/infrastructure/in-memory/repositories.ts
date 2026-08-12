/**
 * In-memory repository implementations.
 *
 * Two things here are not "just a Map":
 *
 *  - **Tenant scoping** is enforced on every read, so a bug in a service
 *    cannot leak rows across tenants even in tests.
 *  - **The fact store keeps a per-cube, occurredAt-ordered array plus a
 *    source-event index.** Ordered inserts make range scans a binary-search
 *    slice instead of a full filter, and the index makes the idempotency
 *    check O(1) — the same two access paths a Postgres implementation would
 *    build indexes for.
 */
import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { CubeDefinition, CubeStatus } from "../../domain/cube.js";
import type { Dashboard, DashboardStatus } from "../../domain/dashboard.js";
import type { Dimension } from "../../domain/dimension.js";
import type { ExportJob, ExportStatus } from "../../domain/export-job.js";
import type { DeadLetterRecord, FactRecord, IngestWatermark } from "../../domain/fact.js";
import type { KpiDefinition, KpiSnapshot } from "../../domain/kpi.js";
import type { MetricDefinition, MetricStatus } from "../../domain/metric.js";
import type {
  CubeRepository,
  DashboardRepository,
  DeadLetterRepository,
  DimensionRepository,
  ExportJobRepository,
  FactRepository,
  FactScan,
  KpiRepository,
  KpiSnapshotRepository,
  MetricRepository,
  WatermarkRepository,
} from "../../domain/repositories.js";

const scoped = (tenantId: TenantId, key: string): string => `${tenantId}::${key}`;

export class InMemoryMetricRepository implements MetricRepository {
  private readonly byCode = new Map<string, MetricDefinition>();

  async save(metric: MetricDefinition): Promise<void> {
    this.byCode.set(scoped(metric.tenantId, metric.code), metric);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<MetricDefinition | null> {
    return (
      [...this.byCode.values()].find((m) => m.tenantId === tenantId && m.id === id) ?? null
    );
  }

  async findByCode(tenantId: TenantId, code: string): Promise<MetricDefinition | null> {
    return this.byCode.get(scoped(tenantId, code)) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { cube?: string; status?: MetricStatus; tag?: string },
  ): Promise<MetricDefinition[]> {
    return [...this.byCode.values()]
      .filter((metric) => metric.tenantId === tenantId)
      .filter((metric) => (filter?.cube ? metric.cube === filter.cube : true))
      .filter((metric) => (filter?.status ? metric.status === filter.status : true))
      .filter((metric) => (filter?.tag ? metric.tags.includes(filter.tag) : true))
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryDimensionRepository implements DimensionRepository {
  private readonly byKey = new Map<string, Dimension>();

  async save(dimension: Dimension): Promise<void> {
    this.byKey.set(scoped(dimension.tenantId, dimension.key), dimension);
  }

  async findByKey(tenantId: TenantId, key: string): Promise<Dimension | null> {
    return this.byKey.get(scoped(tenantId, key)) ?? null;
  }

  async list(tenantId: TenantId): Promise<Dimension[]> {
    return [...this.byKey.values()]
      .filter((dimension) => dimension.tenantId === tenantId)
      .sort((a, b) => a.key.localeCompare(b.key));
  }
}

export class InMemoryCubeRepository implements CubeRepository {
  private readonly byName = new Map<string, CubeDefinition>();

  async save(cube: CubeDefinition): Promise<void> {
    this.byName.set(scoped(cube.tenantId, cube.name), cube);
  }

  async findByName(tenantId: TenantId, name: string): Promise<CubeDefinition | null> {
    return this.byName.get(scoped(tenantId, name)) ?? null;
  }

  async list(tenantId: TenantId, filter?: { status?: CubeStatus }): Promise<CubeDefinition[]> {
    return [...this.byName.values()]
      .filter((cube) => cube.tenantId === tenantId)
      .filter((cube) => (filter?.status ? cube.status === filter.status : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export class InMemoryFactRepository implements FactRepository {
  /** tenant::cube -> facts ordered by occurredAt ascending. */
  private readonly partitions = new Map<string, FactRecord[]>();
  private readonly eventIndex = new Set<string>();

  async append(facts: readonly FactRecord[]): Promise<void> {
    for (const fact of facts) {
      const key = scoped(fact.tenantId, fact.cube);
      const partition = this.partitions.get(key) ?? [];
      insertOrdered(partition, fact);
      this.partitions.set(key, partition);
      this.eventIndex.add(scoped(fact.tenantId, fact.source.eventId));
    }
  }

  async hasEvent(tenantId: TenantId, eventId: Ulid): Promise<boolean> {
    return this.eventIndex.has(scoped(tenantId, eventId));
  }

  async scan(tenantId: TenantId, scan: FactScan): Promise<FactRecord[]> {
    const partition = this.partitions.get(scoped(tenantId, scan.cube)) ?? [];
    const start = scan.from ? lowerBound(partition, scan.from) : 0;
    const end = scan.toExclusive ? lowerBound(partition, scan.toExclusive) : partition.length;
    const window = partition.slice(start, end);
    if (!scan.dimensions) return window;
    const required = Object.entries(scan.dimensions);
    return window.filter((fact) => required.every(([key, value]) => fact.dimensions[key] === value));
  }

  async count(tenantId: TenantId, cube?: string): Promise<number> {
    if (cube) return (this.partitions.get(scoped(tenantId, cube)) ?? []).length;
    let total = 0;
    for (const [key, facts] of this.partitions) {
      if (key.startsWith(`${tenantId}::`)) total += facts.length;
    }
    return total;
  }

  async latestOccurredAt(tenantId: TenantId, cube: string): Promise<IsoDateTime | null> {
    const partition = this.partitions.get(scoped(tenantId, cube)) ?? [];
    return partition.length === 0 ? null : partition[partition.length - 1]!.occurredAt;
  }

  async purgeBefore(tenantId: TenantId, cube: string, before: IsoDateTime): Promise<number> {
    const key = scoped(tenantId, cube);
    const partition = this.partitions.get(key);
    if (!partition) return 0;
    const cut = lowerBound(partition, before);
    if (cut === 0) return 0;
    const removed = partition.splice(0, cut);
    for (const fact of removed) {
      this.eventIndex.delete(scoped(tenantId, fact.source.eventId));
    }
    return removed.length;
  }
}

/** Insertion sort by occurredAt — ingest is near-ordered, so this is O(1). */
function insertOrdered(partition: FactRecord[], fact: FactRecord): void {
  let index = partition.length;
  while (index > 0 && partition[index - 1]!.occurredAt > fact.occurredAt) index -= 1;
  partition.splice(index, 0, fact);
}

/** First index whose occurredAt is >= bound. */
function lowerBound(partition: readonly FactRecord[], bound: IsoDateTime): number {
  let low = 0;
  let high = partition.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (partition[mid]!.occurredAt < bound) low = mid + 1;
    else high = mid;
  }
  return low;
}

export class InMemoryDeadLetterRepository implements DeadLetterRepository {
  private readonly records: DeadLetterRecord[] = [];

  async append(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
  }

  async list(
    tenantId: TenantId,
    filter?: { reason?: string; eventType?: string; limit?: number },
  ): Promise<DeadLetterRecord[]> {
    const matches = this.records
      .filter((record) => record.tenantId === tenantId)
      .filter((record) => (filter?.reason ? record.reason === filter.reason : true))
      .filter((record) => (filter?.eventType ? record.eventType === filter.eventType : true))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    return filter?.limit ? matches.slice(0, filter.limit) : matches;
  }

  async count(tenantId: TenantId): Promise<number> {
    return this.records.filter((record) => record.tenantId === tenantId).length;
  }
}

export class InMemoryWatermarkRepository implements WatermarkRepository {
  private readonly byKey = new Map<string, IngestWatermark>();

  async upsert(watermark: IngestWatermark): Promise<void> {
    this.byKey.set(scoped(watermark.tenantId, watermark.source), watermark);
  }

  async get(tenantId: TenantId, source: string): Promise<IngestWatermark | null> {
    return this.byKey.get(scoped(tenantId, source)) ?? null;
  }

  async list(tenantId: TenantId): Promise<IngestWatermark[]> {
    return [...this.byKey.values()]
      .filter((watermark) => watermark.tenantId === tenantId)
      .sort((a, b) => a.source.localeCompare(b.source));
  }
}

export class InMemoryKpiRepository implements KpiRepository {
  private readonly byCode = new Map<string, KpiDefinition>();

  async save(kpi: KpiDefinition): Promise<void> {
    this.byCode.set(scoped(kpi.tenantId, kpi.code), kpi);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<KpiDefinition | null> {
    return this.byCode.get(scoped(tenantId, code)) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { active?: boolean; cube?: string },
  ): Promise<KpiDefinition[]> {
    return [...this.byCode.values()]
      .filter((kpi) => kpi.tenantId === tenantId)
      .filter((kpi) => (filter?.active === undefined ? true : kpi.active === filter.active))
      .filter((kpi) => (filter?.cube ? kpi.cube === filter.cube : true))
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryKpiSnapshotRepository implements KpiSnapshotRepository {
  /** tenant::kpiCode -> snapshots ordered by period ascending. */
  private readonly byKpi = new Map<string, KpiSnapshot[]>();

  async save(tenantId: TenantId, snapshot: KpiSnapshot): Promise<void> {
    const key = scoped(tenantId, snapshot.kpiCode);
    const history = this.byKpi.get(key) ?? [];
    const existing = history.findIndex((s) => s.period === snapshot.period);
    if (existing === -1) {
      history.push(snapshot);
      history.sort((a, b) => a.period.localeCompare(b.period));
    } else {
      history[existing] = snapshot;
    }
    this.byKpi.set(key, history);
  }

  async latest(tenantId: TenantId, kpiCode: string): Promise<KpiSnapshot | null> {
    const history = this.byKpi.get(scoped(tenantId, kpiCode)) ?? [];
    return history.length === 0 ? null : history[history.length - 1]!;
  }

  async history(tenantId: TenantId, kpiCode: string, limit = 24): Promise<KpiSnapshot[]> {
    const history = this.byKpi.get(scoped(tenantId, kpiCode)) ?? [];
    return history.slice(Math.max(0, history.length - limit));
  }

  async find(tenantId: TenantId, kpiCode: string, period: string): Promise<KpiSnapshot | null> {
    const history = this.byKpi.get(scoped(tenantId, kpiCode)) ?? [];
    return history.find((snapshot) => snapshot.period === period) ?? null;
  }
}

export class InMemoryDashboardRepository implements DashboardRepository {
  private readonly byCode = new Map<string, Dashboard>();

  async save(dashboard: Dashboard): Promise<void> {
    this.byCode.set(scoped(dashboard.tenantId, dashboard.code), dashboard);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<Dashboard | null> {
    return this.byCode.get(scoped(tenantId, code)) ?? null;
  }

  async list(tenantId: TenantId, filter?: { status?: DashboardStatus }): Promise<Dashboard[]> {
    return [...this.byCode.values()]
      .filter((dashboard) => dashboard.tenantId === tenantId)
      .filter((dashboard) => (filter?.status ? dashboard.status === filter.status : true))
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryExportJobRepository implements ExportJobRepository {
  private readonly byNumber = new Map<string, ExportJob>();

  async save(job: ExportJob): Promise<void> {
    this.byNumber.set(scoped(job.tenantId, job.jobNumber), job);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<ExportJob | null> {
    return [...this.byNumber.values()].find((job) => job.tenantId === tenantId && job.id === id) ?? null;
  }

  async findByNumber(tenantId: TenantId, jobNumber: string): Promise<ExportJob | null> {
    return this.byNumber.get(scoped(tenantId, jobNumber)) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: ExportStatus; limit?: number },
  ): Promise<ExportJob[]> {
    const matches = [...this.byNumber.values()]
      .filter((job) => job.tenantId === tenantId)
      .filter((job) => (filter?.status ? job.status === filter.status : true))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return filter?.limit ? matches.slice(0, filter.limit) : matches;
  }

  async nextQueued(tenantId: TenantId): Promise<ExportJob | null> {
    return (
      [...this.byNumber.values()]
        .filter((job) => job.tenantId === tenantId && job.status === "queued")
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.jobNumber.localeCompare(b.jobNumber))[0] ?? null
    );
  }
}
