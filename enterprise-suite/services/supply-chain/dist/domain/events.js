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
};
//# sourceMappingURL=events.js.map