import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { SafetyStockPolicy, type SafetyStockContext } from "../domain/safety-stock.js";
import type { SupplyChainDeps } from "./ports.js";
export declare class SafetyStockService {
    private readonly deps;
    constructor(deps: SupplyChainDeps);
    createPolicy(ctx: TenantContext, input: {
        name: string;
        description?: string;
        method: unknown;
    }): Promise<SafetyStockPolicy>;
    getPolicy(ctx: TenantContext, id: Ulid): Promise<SafetyStockPolicy>;
    listPolicies(ctx: TenantContext): Promise<SafetyStockPolicy[]>;
    changeMethod(ctx: TenantContext, id: Ulid, method: unknown): Promise<SafetyStockPolicy>;
    /**
     * Stateless what-if: compute the safety stock a method would yield for a
     * given demand profile, without touching any policy. Used by planners to
     * tune service levels before committing.
     */
    preview(input: {
        method: unknown;
        weeklyDemandSeries: readonly number[];
        leadTimeDays: number;
    }): {
        safetyStock: number;
        context: SafetyStockContext;
    };
}
//# sourceMappingURL=safety-stock-service.d.ts.map