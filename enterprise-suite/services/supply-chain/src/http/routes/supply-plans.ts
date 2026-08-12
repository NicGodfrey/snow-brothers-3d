import type { Ulid } from "@enterprise-suite/shared-kernel";
import { locationCode } from "../../domain/types.js";
import type { SupplyChainModule } from "../../infrastructure/module.js";
import type { Router } from "../router.js";

export function registerSupplyPlanRoutes(router: Router, module: SupplyChainModule): void {
  router.get("/supply-plans", async (req) => {
    const plans = await module.supplyPlans.listPlans(req.ctx, {
      runId: req.query.runId as Ulid | undefined,
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
    const plan = await module.supplyPlans.getPlan(req.ctx, req.params.id as Ulid);
    return { status: 200, body: plan.toJSON() };
  });

  router.post("/supply-plans/:id/orders/:orderId/firm", async (req) => {
    const order = await module.supplyPlans.firmOrder(req.ctx, req.params.id as Ulid, req.params.orderId);
    return { status: 200, body: order };
  });

  router.post("/supply-plans/:id/orders/:orderId/release", async (req) => {
    const order = await module.supplyPlans.releaseOrder(req.ctx, req.params.id as Ulid, req.params.orderId);
    return { status: 200, body: order };
  });

  router.post("/supply-plans/:id/orders/:orderId/cancel", async (req) => {
    const order = await module.supplyPlans.cancelOrder(req.ctx, req.params.id as Ulid, req.params.orderId);
    return { status: 200, body: order };
  });
}
