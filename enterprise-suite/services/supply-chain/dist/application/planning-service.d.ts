import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { PlanningRun } from "../domain/planning-run.js";
import { type LocationCode } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";
export declare class PlanningService {
    private readonly deps;
    constructor(deps: SupplyChainDeps);
    createRun(ctx: TenantContext, input: {
        name?: string;
        location: LocationCode;
        horizonWeeks: number;
        scope?: unknown;
    }): Promise<PlanningRun>;
    getRun(ctx: TenantContext, id: Ulid): Promise<PlanningRun>;
    listRuns(ctx: TenantContext): Promise<PlanningRun[]>;
    /**
     * Executes multi-level MRP for the run's scope:
     *
     *  1. resolve the item set (scope + full BOM closure) and low-level codes
     *  2. seed independent demand: residual published forecast + active
     *     allocations, per item
     *  3. per LLC level, net each item (gross - scheduled receipts - on-hand,
     *     respecting safety stock and lot-sizing), then explode planned order
     *     releases into component gross requirements for deeper levels
     *  4. persist one SupplyPlan per item and a full audit trail on the run
     *
     * Firmed/released planned orders from each item's previous plan are treated
     * as scheduled receipts, so planner commitments survive regeneration.
     */
    executeRun(ctx: TenantContext, runId: Ulid): Promise<PlanningRun>;
    private plan;
    /** Scope items plus every BOM descendant, active items only. */
    private resolveScope;
    /** Independent demand (residual forecast + allocations) plus exploded dependent demand. */
    private grossRequirements;
    /** Open external receipts plus firmed planned orders from the item's previous plan. */
    private scheduledReceipts;
    private safetyStockFor;
    /**
     * Per-item capacity sanity check: new purchase planned orders vs. the
     * supplier's weekly commitment. Cross-item load is available through the
     * capacity load report; here we only flag weeks where this item alone
     * already exceeds the calendar.
     */
    private checkSupplierCapacity;
    private explodeIntoComponents;
}
//# sourceMappingURL=planning-service.d.ts.map