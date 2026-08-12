import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate, LocationCode, SupplierId } from "./types.js";

/**
 * Event catalogue for the supply-chain bounded context. Downstream contexts
 * (procurement, manufacturing, inventory, reporting) subscribe to these via
 * the shared event bus; payloads are intentionally flat and serializable.
 */
export const SupplyChainEvents = {
  ItemCreated: "supplychain.item.created",
  ItemBomChanged: "supplychain.item.bom_changed",
  ForecastPublished: "supplychain.forecast.published",
  ForecastArchived: "supplychain.forecast.archived",
  SafetyStockPolicyChanged: "supplychain.safety_stock_policy.changed",
  PlanningRunStarted: "supplychain.planning_run.started",
  PlanningRunCompleted: "supplychain.planning_run.completed",
  PlanningRunFailed: "supplychain.planning_run.failed",
  SupplyPlanCreated: "supplychain.supply_plan.created",
  PlannedOrderFirmed: "supplychain.planned_order.firmed",
  /** Consumed by procurement (BUY) or manufacturing (MAKE) to create real orders. */
  PlannedOrderReleased: "supplychain.planned_order.released",
  PlannedOrderCancelled: "supplychain.planned_order.cancelled",
  AllocationCreated: "supplychain.allocation.created",
  AllocationCancelled: "supplychain.allocation.cancelled",
  SupplierCapacityChanged: "supplychain.supplier_capacity.changed",
} as const;

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
