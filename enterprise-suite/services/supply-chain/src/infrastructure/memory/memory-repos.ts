import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { Allocation } from "../../domain/allocation.js";
import type { DemandForecast } from "../../domain/demand-forecast.js";
import type { PlanningItem } from "../../domain/planning-item.js";
import type { PlanningRun } from "../../domain/planning-run.js";
import type { InventoryRecord, ScheduledReceipt } from "../../domain/records.js";
import type { SafetyStockPolicy } from "../../domain/safety-stock.js";
import type { SupplierCapacityCalendar } from "../../domain/supplier-calendar.js";
import type { SupplyPlan } from "../../domain/supply-plan.js";
import type { LocationCode, SupplierId } from "../../domain/types.js";
import type {
  AllocationRepository,
  DemandForecastRepository,
  InventoryRepository,
  PlanningItemRepository,
  PlanningRunRepository,
  SafetyStockPolicyRepository,
  ScheduledReceiptRepository,
  SupplierCalendarRepository,
  SupplyPlanRepository,
} from "../../application/ports.js";

/**
 * Tenant-partitioned in-memory store. Insertion order is preserved per
 * tenant, which the repos rely on for "latest" queries; the SQL migrations
 * define the equivalent (created_at, id) ordering for Postgres adapters.
 */
class TenantStore<T extends { id: Ulid; tenantId: TenantId }> {
  private readonly byTenant = new Map<string, Map<string, T>>();

  save(entity: T): void {
    let bucket = this.byTenant.get(entity.tenantId as string);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(entity.tenantId as string, bucket);
    }
    // Re-set to keep first-insert order stable (Map preserves original slot).
    bucket.set(entity.id as string, entity);
  }

  find(tenantId: TenantId, id: Ulid): T | null {
    return this.byTenant.get(tenantId as string)?.get(id as string) ?? null;
  }

  delete(tenantId: TenantId, id: Ulid): boolean {
    return this.byTenant.get(tenantId as string)?.delete(id as string) ?? false;
  }

  all(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId as string)?.values() ?? [])];
  }
}

export class InMemoryPlanningItemRepository implements PlanningItemRepository {
  private readonly store = new TenantStore<PlanningItem>();

  async save(item: PlanningItem): Promise<void> {
    this.store.save(item);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<PlanningItem | null> {
    return this.store.find(tenantId, id);
  }

  async findBySku(tenantId: TenantId, sku: string): Promise<PlanningItem | null> {
    return this.store.all(tenantId).find((item) => item.sku === sku) ?? null;
  }

  async listActive(tenantId: TenantId): Promise<PlanningItem[]> {
    return this.store.all(tenantId).filter((item) => item.active);
  }

  async listAll(tenantId: TenantId): Promise<PlanningItem[]> {
    return this.store.all(tenantId);
  }
}

export class InMemoryDemandForecastRepository implements DemandForecastRepository {
  private readonly store = new TenantStore<DemandForecast>();

  async save(forecast: DemandForecast): Promise<void> {
    this.store.save(forecast);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<DemandForecast | null> {
    return this.store.find(tenantId, id);
  }

  async findPublished(tenantId: TenantId, sku: string, location: LocationCode): Promise<DemandForecast | null> {
    return (
      this.store
        .all(tenantId)
        .find((f) => f.status === "PUBLISHED" && f.sku === sku && f.location === location) ?? null
    );
  }

  async list(
    tenantId: TenantId,
    filter?: { sku?: string; location?: LocationCode; status?: string },
  ): Promise<DemandForecast[]> {
    return this.store.all(tenantId).filter(
      (f) =>
        (!filter?.sku || f.sku === filter.sku) &&
        (!filter?.location || f.location === filter.location) &&
        (!filter?.status || f.status === filter.status),
    );
  }
}

export class InMemorySafetyStockPolicyRepository implements SafetyStockPolicyRepository {
  private readonly store = new TenantStore<SafetyStockPolicy>();

  async save(policy: SafetyStockPolicy): Promise<void> {
    this.store.save(policy);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<SafetyStockPolicy | null> {
    return this.store.find(tenantId, id);
  }

  async list(tenantId: TenantId): Promise<SafetyStockPolicy[]> {
    return this.store.all(tenantId);
  }
}

export class InMemoryInventoryRepository implements InventoryRepository {
  /** Keyed by tenant|sku|location; the natural key of the projection. */
  private readonly records = new Map<string, InventoryRecord>();

  private key(tenantId: TenantId, sku: string, location: LocationCode): string {
    return `${tenantId}|${sku}|${location}`;
  }

  async upsert(record: InventoryRecord): Promise<void> {
    this.records.set(this.key(record.tenantId, record.sku, record.location), record);
  }

  async find(tenantId: TenantId, sku: string, location: LocationCode): Promise<InventoryRecord | null> {
    return this.records.get(this.key(tenantId, sku, location)) ?? null;
  }

  async list(tenantId: TenantId, location?: LocationCode): Promise<InventoryRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.tenantId === tenantId && (!location || r.location === location),
    );
  }
}

export class InMemoryScheduledReceiptRepository implements ScheduledReceiptRepository {
  private readonly store = new TenantStore<ScheduledReceipt>();

  async save(receipt: ScheduledReceipt): Promise<void> {
    this.store.save(receipt);
  }

  async delete(tenantId: TenantId, id: Ulid): Promise<boolean> {
    return this.store.delete(tenantId, id);
  }

  async listFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<ScheduledReceipt[]> {
    return this.store.all(tenantId).filter((r) => r.sku === sku && r.location === location);
  }

  async list(tenantId: TenantId, location?: LocationCode): Promise<ScheduledReceipt[]> {
    return this.store.all(tenantId).filter((r) => !location || r.location === location);
  }
}

export class InMemorySupplyPlanRepository implements SupplyPlanRepository {
  private readonly store = new TenantStore<SupplyPlan>();

  async save(plan: SupplyPlan): Promise<void> {
    this.store.save(plan);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<SupplyPlan | null> {
    return this.store.find(tenantId, id);
  }

  async listByRun(tenantId: TenantId, runId: Ulid): Promise<SupplyPlan[]> {
    return this.store.all(tenantId).filter((p) => p.runId === runId);
  }

  async findLatestFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<SupplyPlan | null> {
    const matches = this.store.all(tenantId).filter((p) => p.sku === sku && p.location === location);
    return matches.at(-1) ?? null;
  }

  async list(tenantId: TenantId, filter?: { sku?: string; location?: LocationCode }): Promise<SupplyPlan[]> {
    return this.store.all(tenantId).filter(
      (p) => (!filter?.sku || p.sku === filter.sku) && (!filter?.location || p.location === filter.location),
    );
  }
}

export class InMemoryAllocationRepository implements AllocationRepository {
  private readonly store = new TenantStore<Allocation>();

  async save(allocation: Allocation): Promise<void> {
    this.store.save(allocation);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<Allocation | null> {
    return this.store.find(tenantId, id);
  }

  async listActiveFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<Allocation[]> {
    return this.store
      .all(tenantId)
      .filter((a) => a.status === "ACTIVE" && a.sku === sku && a.location === location);
  }

  async list(
    tenantId: TenantId,
    filter?: { sku?: string; location?: LocationCode; status?: string },
  ): Promise<Allocation[]> {
    return this.store.all(tenantId).filter(
      (a) =>
        (!filter?.sku || a.sku === filter.sku) &&
        (!filter?.location || a.location === filter.location) &&
        (!filter?.status || a.status === filter.status),
    );
  }
}

export class InMemorySupplierCalendarRepository implements SupplierCalendarRepository {
  private readonly store = new TenantStore<SupplierCapacityCalendar>();

  async save(calendar: SupplierCapacityCalendar): Promise<void> {
    this.store.save(calendar);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<SupplierCapacityCalendar | null> {
    return this.store.find(tenantId, id);
  }

  async findFor(tenantId: TenantId, supplierId: SupplierId, sku: string): Promise<SupplierCapacityCalendar | null> {
    const all = this.store.all(tenantId).filter((c) => c.supplierId === supplierId);
    return all.find((c) => c.sku === sku) ?? all.find((c) => c.sku === null) ?? null;
  }

  async list(tenantId: TenantId, supplierId?: SupplierId): Promise<SupplierCapacityCalendar[]> {
    return this.store.all(tenantId).filter((c) => !supplierId || c.supplierId === supplierId);
  }
}

export class InMemoryPlanningRunRepository implements PlanningRunRepository {
  private readonly store = new TenantStore<PlanningRun>();

  async save(run: PlanningRun): Promise<void> {
    this.store.save(run);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<PlanningRun | null> {
    return this.store.find(tenantId, id);
  }

  async list(tenantId: TenantId): Promise<PlanningRun[]> {
    return this.store.all(tenantId);
  }
}
