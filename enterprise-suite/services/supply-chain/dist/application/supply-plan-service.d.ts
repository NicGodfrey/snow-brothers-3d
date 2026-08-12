import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { PlannedOrder, SupplyPlan } from "../domain/supply-plan.js";
import type { LocationCode } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";
export declare class SupplyPlanService {
    private readonly deps;
    constructor(deps: SupplyChainDeps);
    getPlan(ctx: TenantContext, id: Ulid): Promise<SupplyPlan>;
    listPlans(ctx: TenantContext, filter?: {
        runId?: Ulid;
        sku?: string;
        location?: LocationCode;
    }): Promise<SupplyPlan[]>;
    firmOrder(ctx: TenantContext, planId: Ulid, orderId: string): Promise<PlannedOrder>;
    /**
     * Releasing hands the order to procurement (PURCHASE) or manufacturing
     * (PRODUCTION) via the PlannedOrderReleased event. The downstream context
     * is expected to push a scheduled-receipt projection back once a real
     * order exists.
     */
    releaseOrder(ctx: TenantContext, planId: Ulid, orderId: string): Promise<PlannedOrder>;
    cancelOrder(ctx: TenantContext, planId: Ulid, orderId: string): Promise<PlannedOrder>;
}
//# sourceMappingURL=supply-plan-service.d.ts.map