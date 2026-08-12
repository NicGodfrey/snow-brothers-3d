import { NotFoundError } from "@enterprise-suite/shared-kernel";
import { computeSafetyStock, parseSafetyStockMethod, SafetyStockPolicy, weeklyStdDev, } from "../domain/safety-stock.js";
export class SafetyStockService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async createPolicy(ctx, input) {
        const policy = SafetyStockPolicy.create(ctx.tenantId, {
            name: input.name,
            description: input.description,
            method: parseSafetyStockMethod(input.method),
        });
        await this.deps.policies.save(policy);
        await this.deps.outbox.publish(policy.pullEvents());
        return policy;
    }
    async getPolicy(ctx, id) {
        const policy = await this.deps.policies.findById(ctx.tenantId, id);
        if (!policy)
            throw new NotFoundError("SafetyStockPolicy", id);
        return policy;
    }
    async listPolicies(ctx) {
        return this.deps.policies.list(ctx.tenantId);
    }
    async changeMethod(ctx, id, method) {
        const policy = await this.getPolicy(ctx, id);
        policy.changeMethod(parseSafetyStockMethod(method));
        await this.deps.policies.save(policy);
        await this.deps.outbox.publish(policy.pullEvents());
        return policy;
    }
    /**
     * Stateless what-if: compute the safety stock a method would yield for a
     * given demand profile, without touching any policy. Used by planners to
     * tune service levels before committing.
     */
    preview(input) {
        const method = parseSafetyStockMethod(input.method);
        const series = input.weeklyDemandSeries ?? [];
        const avg = series.length > 0 ? series.reduce((s, v) => s + v, 0) / series.length : 0;
        const context = {
            avgWeeklyDemand: avg,
            weeklyDemandStdDev: weeklyStdDev(series),
            leadTimeDays: input.leadTimeDays,
        };
        return { safetyStock: computeSafetyStock(method, context), context };
    }
}
//# sourceMappingURL=safety-stock-service.js.map