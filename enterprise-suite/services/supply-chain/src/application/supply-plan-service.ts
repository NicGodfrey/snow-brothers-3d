import { NotFoundError, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { PlannedOrder, SupplyPlan } from "../domain/supply-plan.js";
import type { LocationCode } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";

export class SupplyPlanService {
  constructor(private readonly deps: SupplyChainDeps) {}

  async getPlan(ctx: TenantContext, id: Ulid): Promise<SupplyPlan> {
    const plan = await this.deps.plans.findById(ctx.tenantId, id);
    if (!plan) throw new NotFoundError("SupplyPlan", id);
    return plan;
  }

  async listPlans(
    ctx: TenantContext,
    filter?: { runId?: Ulid; sku?: string; location?: LocationCode },
  ): Promise<SupplyPlan[]> {
    if (filter?.runId) return this.deps.plans.listByRun(ctx.tenantId, filter.runId);
    return this.deps.plans.list(ctx.tenantId, filter);
  }

  async firmOrder(ctx: TenantContext, planId: Ulid, orderId: string): Promise<PlannedOrder> {
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
  async releaseOrder(ctx: TenantContext, planId: Ulid, orderId: string): Promise<PlannedOrder> {
    const plan = await this.getPlan(ctx, planId);
    const order = plan.releaseOrder(orderId);
    await this.deps.plans.save(plan);
    await this.deps.outbox.publish(plan.pullEvents());
    return order;
  }

  async cancelOrder(ctx: TenantContext, planId: Ulid, orderId: string): Promise<PlannedOrder> {
    const plan = await this.getPlan(ctx, planId);
    const order = plan.cancelOrder(orderId);
    await this.deps.plans.save(plan);
    await this.deps.outbox.publish(plan.pullEvents());
    return order;
  }
}
