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
import type { AllocationRepository, DemandForecastRepository, InventoryRepository, PlanningItemRepository, PlanningRunRepository, SafetyStockPolicyRepository, ScheduledReceiptRepository, SupplierCalendarRepository, SupplyPlanRepository } from "../../application/ports.js";
export declare class InMemoryPlanningItemRepository implements PlanningItemRepository {
    private readonly store;
    save(item: PlanningItem): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<PlanningItem | null>;
    findBySku(tenantId: TenantId, sku: string): Promise<PlanningItem | null>;
    listActive(tenantId: TenantId): Promise<PlanningItem[]>;
    listAll(tenantId: TenantId): Promise<PlanningItem[]>;
}
export declare class InMemoryDemandForecastRepository implements DemandForecastRepository {
    private readonly store;
    save(forecast: DemandForecast): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<DemandForecast | null>;
    findPublished(tenantId: TenantId, sku: string, location: LocationCode): Promise<DemandForecast | null>;
    list(tenantId: TenantId, filter?: {
        sku?: string;
        location?: LocationCode;
        status?: string;
    }): Promise<DemandForecast[]>;
}
export declare class InMemorySafetyStockPolicyRepository implements SafetyStockPolicyRepository {
    private readonly store;
    save(policy: SafetyStockPolicy): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<SafetyStockPolicy | null>;
    list(tenantId: TenantId): Promise<SafetyStockPolicy[]>;
}
export declare class InMemoryInventoryRepository implements InventoryRepository {
    /** Keyed by tenant|sku|location; the natural key of the projection. */
    private readonly records;
    private key;
    upsert(record: InventoryRecord): Promise<void>;
    find(tenantId: TenantId, sku: string, location: LocationCode): Promise<InventoryRecord | null>;
    list(tenantId: TenantId, location?: LocationCode): Promise<InventoryRecord[]>;
}
export declare class InMemoryScheduledReceiptRepository implements ScheduledReceiptRepository {
    private readonly store;
    save(receipt: ScheduledReceipt): Promise<void>;
    delete(tenantId: TenantId, id: Ulid): Promise<boolean>;
    listFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<ScheduledReceipt[]>;
    list(tenantId: TenantId, location?: LocationCode): Promise<ScheduledReceipt[]>;
}
export declare class InMemorySupplyPlanRepository implements SupplyPlanRepository {
    private readonly store;
    save(plan: SupplyPlan): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<SupplyPlan | null>;
    listByRun(tenantId: TenantId, runId: Ulid): Promise<SupplyPlan[]>;
    findLatestFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<SupplyPlan | null>;
    list(tenantId: TenantId, filter?: {
        sku?: string;
        location?: LocationCode;
    }): Promise<SupplyPlan[]>;
}
export declare class InMemoryAllocationRepository implements AllocationRepository {
    private readonly store;
    save(allocation: Allocation): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<Allocation | null>;
    listActiveFor(tenantId: TenantId, sku: string, location: LocationCode): Promise<Allocation[]>;
    list(tenantId: TenantId, filter?: {
        sku?: string;
        location?: LocationCode;
        status?: string;
    }): Promise<Allocation[]>;
}
export declare class InMemorySupplierCalendarRepository implements SupplierCalendarRepository {
    private readonly store;
    save(calendar: SupplierCapacityCalendar): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<SupplierCapacityCalendar | null>;
    findFor(tenantId: TenantId, supplierId: SupplierId, sku: string): Promise<SupplierCapacityCalendar | null>;
    list(tenantId: TenantId, supplierId?: SupplierId): Promise<SupplierCapacityCalendar[]>;
}
export declare class InMemoryPlanningRunRepository implements PlanningRunRepository {
    private readonly store;
    save(run: PlanningRun): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<PlanningRun | null>;
    list(tenantId: TenantId): Promise<PlanningRun[]>;
}
//# sourceMappingURL=memory-repos.d.ts.map