/**
 * Repository ports (hexagonal). Every lookup is tenant-scoped: a reporting
 * store that can accidentally read another tenant's facts is the worst kind
 * of bug in this domain, so the interfaces make it impossible to ask.
 *
 * The fact repository is deliberately narrow — append, scan a window, count,
 * purge. Everything analytical happens in the aggregation engine, so a
 * Postgres implementation can push the scan down to SQL without having to
 * reimplement the semantic layer.
 */
import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { CubeDefinition, CubeStatus } from "./cube.js";
import type { Dashboard, DashboardStatus } from "./dashboard.js";
import type { Dimension } from "./dimension.js";
import type { ExportJob, ExportStatus } from "./export-job.js";
import type { DeadLetterRecord, FactRecord, IngestWatermark } from "./fact.js";
import type { KpiDefinition, KpiSnapshot } from "./kpi.js";
import type { MetricDefinition, MetricStatus } from "./metric.js";

export interface MetricRepository {
  save(metric: MetricDefinition): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<MetricDefinition | null>;
  findByCode(tenantId: TenantId, code: string): Promise<MetricDefinition | null>;
  list(
    tenantId: TenantId,
    filter?: { cube?: string; status?: MetricStatus; tag?: string },
  ): Promise<MetricDefinition[]>;
}

export interface DimensionRepository {
  save(dimension: Dimension): Promise<void>;
  findByKey(tenantId: TenantId, key: string): Promise<Dimension | null>;
  list(tenantId: TenantId): Promise<Dimension[]>;
}

export interface CubeRepository {
  save(cube: CubeDefinition): Promise<void>;
  findByName(tenantId: TenantId, name: string): Promise<CubeDefinition | null>;
  list(tenantId: TenantId, filter?: { status?: CubeStatus }): Promise<CubeDefinition[]>;
}

export interface FactScan {
  readonly cube: string;
  readonly from?: IsoDateTime;
  readonly toExclusive?: IsoDateTime;
  /** Exact-match pre-filter applied at the store, before aggregation. */
  readonly dimensions?: Readonly<Record<string, string>>;
}

export interface FactRepository {
  append(facts: readonly FactRecord[]): Promise<void>;
  /** Idempotency guard: has this source event already produced facts? */
  hasEvent(tenantId: TenantId, eventId: Ulid): Promise<boolean>;
  scan(tenantId: TenantId, scan: FactScan): Promise<FactRecord[]>;
  count(tenantId: TenantId, cube?: string): Promise<number>;
  /** Latest fact instant per cube — the freshness indicator on dashboards. */
  latestOccurredAt(tenantId: TenantId, cube: string): Promise<IsoDateTime | null>;
  purgeBefore(tenantId: TenantId, cube: string, before: IsoDateTime): Promise<number>;
}

export interface DeadLetterRepository {
  append(record: DeadLetterRecord): Promise<void>;
  list(
    tenantId: TenantId,
    filter?: { reason?: string; eventType?: string; limit?: number },
  ): Promise<DeadLetterRecord[]>;
  count(tenantId: TenantId): Promise<number>;
}

export interface WatermarkRepository {
  upsert(watermark: IngestWatermark): Promise<void>;
  get(tenantId: TenantId, source: string): Promise<IngestWatermark | null>;
  list(tenantId: TenantId): Promise<IngestWatermark[]>;
}

export interface KpiRepository {
  save(kpi: KpiDefinition): Promise<void>;
  findByCode(tenantId: TenantId, code: string): Promise<KpiDefinition | null>;
  list(tenantId: TenantId, filter?: { active?: boolean; cube?: string }): Promise<KpiDefinition[]>;
}

export interface KpiSnapshotRepository {
  /** Upserts by (kpiCode, period): recomputing a period replaces it. */
  save(tenantId: TenantId, snapshot: KpiSnapshot): Promise<void>;
  latest(tenantId: TenantId, kpiCode: string): Promise<KpiSnapshot | null>;
  history(tenantId: TenantId, kpiCode: string, limit?: number): Promise<KpiSnapshot[]>;
  find(tenantId: TenantId, kpiCode: string, period: string): Promise<KpiSnapshot | null>;
}

export interface DashboardRepository {
  save(dashboard: Dashboard): Promise<void>;
  findByCode(tenantId: TenantId, code: string): Promise<Dashboard | null>;
  list(tenantId: TenantId, filter?: { status?: DashboardStatus }): Promise<Dashboard[]>;
}

export interface ExportJobRepository {
  save(job: ExportJob): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<ExportJob | null>;
  findByNumber(tenantId: TenantId, jobNumber: string): Promise<ExportJob | null>;
  list(tenantId: TenantId, filter?: { status?: ExportStatus; limit?: number }): Promise<ExportJob[]>;
  /** Oldest queued job, FIFO — the worker's unit of work. */
  nextQueued(tenantId: TenantId): Promise<ExportJob | null>;
}
