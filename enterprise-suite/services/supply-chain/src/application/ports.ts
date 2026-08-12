import type { EventEnvelope, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { Allocation } from "../domain/allocation.js";
import type { DemandForecast } from "../domain/demand-forecast.js";
import type { PlanningItem } from "../domain/planning-item.js";
import type { PlanningRun } from "../domain/planning-run.js";
import type { InventoryRecord, ScheduledReceipt } from "../domain/records.js";
import type { SafetyStockPolicy } from "../domain/safety-stock.js";
import type { SupplierCapacityCalendar } from "../domain/supplier-calendar.js";
import type { SupplyPlan } from "../domain/supply-plan.js";
import type { IsoDate, LocationCode, SupplierId } from "../domain/types.js";

export interface PlanningItemRepository {
  save(item: PlanningItem): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<PlanningItem | null>;
  findBySku(tenantId: TenantId, sku: string): Promise<PlanningItem | null>;
  listActive(tenantId: TenantId): Promise<PlanningItem[]>;
  listAll(tenantId: TenantId): Promise<PlanningItem[]>;
}

export interface DemandForecastRepository {
  save(forecast: DemandForecast): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<DemandForecast | null>;
  findPublished(tenantId: TenantId, sku: string, location: LocationCode): Promise<DemandForecast | null>;
  list(tenantId: TenantId, filter?: { sku?: string; location?: LocationCode; status?: string }): Promise<DemandForecast[]>;
}

export interface SafetyStockPolicyRepository {
  save(policy: SafetyStockPolicy): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<SafetyStockPolicy | null>;
  list(tenantId: TenantId): Promise<SafetyStockPolicy[]>;
}

export interface InventoryRepository {
  upsert(record: InventoryRecord): Promise<void>;
  find(tenantId: TenantId, sku: string, location: LocationCode): Promise<InventoryRecord | null>;
  list(tenantId: TenantId, location?: LocationCode): Promise<InventoryRecord[]>;
}

export interface ScheduledReceiptRepository {
  save(receipt: ScheduledReceipt): Promise<void>;
  delete(tenantId: TenantId, id: Ulid): Promise<boolean>;
  listFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<ScheduledReceipt[]>;
  list(tenantId: TenantId, location?: LocationCode): Promise<ScheduledReceipt[]>;
}

export interface SupplyPlanRepository {
  save(plan: SupplyPlan): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<SupplyPlan | null>;
  listByRun(tenantId: TenantId, runId: Ulid): Promise<SupplyPlan[]>;
  /** Most recent plan for the item/location, by creation order across runs. */
  findLatestFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<SupplyPlan | null>;
  list(tenantId: TenantId, filter?: { sku?: string; location?: LocationCode }): Promise<SupplyPlan[]>;
}

export interface AllocationRepository {
  save(allocation: Allocation): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<Allocation | null>;
  listActiveFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<Allocation[]>;
  list(tenantId: TenantId, filter?: { sku?: string; location?: LocationCode; status?: string }): Promise<Allocation[]>;
}

export interface SupplierCalendarRepository {
  save(calendar: SupplierCapacityCalendar): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<SupplierCapacityCalendar | null>;
  /** Item-specific calendar wins over the supplier-wide one. */
  findFor(tenantId: TenantId, supplierId: SupplierId, sku: string): Promise<SupplierCapacityCalendar | null>;
  list(tenantId: TenantId, supplierId?: SupplierId): Promise<SupplierCapacityCalendar[]>;
}

export interface PlanningRunRepository {
  save(run: PlanningRun): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<PlanningRun | null>;
  list(tenantId: TenantId): Promise<PlanningRun[]>;
}

/**
 * Transactional outbox port. In-memory today; the SQL migration ships the
 * outbox table so a Postgres adapter can publish exactly-once later.
 */
export interface OutboxPort {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}

export interface Clock {
  now(): Date;
  today(): IsoDate;
}

/** Full set of dependencies the application services are wired with. */
export interface SupplyChainDeps {
  readonly items: PlanningItemRepository;
  readonly forecasts: DemandForecastRepository;
  readonly policies: SafetyStockPolicyRepository;
  readonly inventory: InventoryRepository;
  readonly receipts: ScheduledReceiptRepository;
  readonly plans: SupplyPlanRepository;
  readonly allocations: AllocationRepository;
  readonly calendars: SupplierCalendarRepository;
  readonly runs: PlanningRunRepository;
  readonly outbox: OutboxPort;
  readonly clock: Clock;
}
