import { NotFoundError } from "@enterprise-suite/shared-kernel";
export class SupplyPlanService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async getPlan(ctx, id) {
        const plan = await this.deps.plans.findById(ctx.tenantId, id);
        if (!plan)
            throw new NotFoundError("SupplyPlan", id);
        return plan;
    }
    async listPlans(ctx, filter) {
        if (filter?.runId)
            return this.deps.plans.listByRun(ctx.tenantId, filter.runId);
        return this.deps.plans.list(ctx.tenantId, filter);
    }
    async firmOrder(ctx, planId, orderId) {
        const plan = await this.getPlan(ctx, planId);
        const order = plan.firmOrder(orderId);
        await this.deps.plans.save(plan);
        await this.deps.outbox.publish(plan.pullEvents());
        return order;
    }
    /**
     * Releasing hands the order to procurement (PURCHASE) or manufacturing
     * (PRODUCTION) via the PlannedOrderReleased event. The downstream context
     * is expected to push a scheduled-receipt projection back once a real
     * order exists.
     */
    async releaseOrder(ctx, planId, orderId) {
        const plan = await this.getPlan(ctx, planId);
        const order = plan.releaseOrder(orderId);
        await this.deps.plans.save(plan);
        await this.deps.outbox.publish(plan.pullEvents());
        return order;
    }
    async cancelOrder(ctx, planId, orderId) {
        const plan = await this.getPlan(ctx, planId);
        const order = plan.cancelOrder(orderId);
        await this.deps.plans.save(plan);
        await this.deps.outbox.publish(plan.pullEvents());
        return order;
    }
}
//# sourceMappingURL=supply-plan-service.js.map