import { locationCode } from "../../domain/types.js";
export function registerSupplyPlanRoutes(router, module) {
    router.get("/supply-plans", async (req) => {
        const plans = await module.supplyPlans.listPlans(req.ctx, {
            runId: req.query.runId,
            sku: req.query.sku?.toUpperCase(),
            location: req.query.location ? locationCode(req.query.location) : undefined,
        });
        return {
            status: 200,
            body: {
                plans: plans.map((plan) => ({
                    id: plan.id,
                    runId: plan.runId,
                    sku: plan.sku,
                    location: plan.location,
                    stats: plan.stats,
                    exceptionCount: plan.exceptions.length,
                })),
            },
        };
    });
    router.get("/supply-plans/:id", async (req) => {
        const plan = await module.supplyPlans.getPlan(req.ctx, req.params.id);
        return { status: 200, body: plan.toJSON() };
    });
    router.post("/supply-plans/:id/orders/:orderId/firm", async (req) => {
        const order = await module.supplyPlans.firmOrder(req.ctx, req.params.id, req.params.orderId);
        return { status: 200, body: order };
    });
    router.post("/supply-plans/:id/orders/:orderId/release", async (req) => {
        const order = await module.supplyPlans.releaseOrder(req.ctx, req.params.id, req.params.orderId);
        return { status: 200, body: order };
    });
    router.post("/supply-plans/:id/orders/:orderId/cancel", async (req) => {
        const order = await module.supplyPlans.cancelOrder(req.ctx, req.params.id, req.params.orderId);
        return { status: 200, body: order };
    });
}
//# sourceMappingURL=supply-plans.js.map