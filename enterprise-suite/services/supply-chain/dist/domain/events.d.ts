import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate, LocationCode, SupplierId } from "./types.js";
/**
 * Event catalogue for the supply-chain bounded context. Downstream contexts
 * (procurement, manufacturing, inventory, reporting) subscribe to these via
 * the shared event bus; payloads are intentionally flat and serializable.
 */
export declare const SupplyChainEvents: {
    readonly ItemCreated: "supplychain.item.created";
    readonly ItemBomChanged: "supplychain.item.bom_changed";
    readonly ForecastPublished: "supplychain.forecast.published";
    readonly ForecastArchived: "supplychain.forecast.archived";
    readonly SafetyStockPolicyChanged: "supplychain.safety_stock_policy.changed";
    readonly PlanningRunStarted: "supplychain.planning_run.started";
    readonly PlanningRunCompleted: "supplychain.planning_run.completed";
    readonly PlanningRunFailed: "supplychain.planning_run.failed";
    readonly SupplyPlanCreated: "supplychain.supply_plan.created";
    readonly PlannedOrderFirmed: "supplychain.planned_order.firmed";
    /** Consumed by procurement (BUY) or manufacturing (MAKE) to create real orders. */
    readonly PlannedOrderReleased: "supplychain.planned_order.released";
    readonly PlannedOrderCancelled: "supplychain.planned_order.cancelled";
    readonly AllocationCreated: "supplychain.allocation.created";
    readonly AllocationCancelled: "supplychain.allocation.cancelled";
    readonly SupplierCapacityChanged: "supplychain.supplier_capacity.changed";
};
export type SupplyChainEventType = (typeof SupplyChainEvents)[keyof typeof SupplyChainEvents];
export interface ForecastPublishedPayload {
    forecastId: Ulid;
    sku: string;
    location: LocationCode;
    totalQty: number;
    horizonStart: IsoDate | null;
    horizonEnd: IsoDate | null;
    entryCount: number;
}
export interface PlanningRunCompletedPayload {
    runId: Ulid;
    location: LocationCode;
    itemsPlanned: number;
    ordersCreated: number;
    exceptionCount: number;
    levelsProcessed: number;
}
export interface PlannedOrderReleasedPayload {
    planId: Ulid;
    orderId: string;
    sku: string;
    location: LocationCode;
    orderType: "PURCHASE" | "PRODUCTION";
    qty: number;
    dueDate: IsoDate;
    releaseDate: IsoDate;
    supplierId: SupplierId | null;
}
export interface AllocationCreatedPayload {
    allocationId: Ulid;
    sku: string;
    location: LocationCode;
    qty: number;
    needDate: IsoDate;
    demandRefType: string;
    demandRef: string;
}
//# sourceMappingURL=events.d.ts.map