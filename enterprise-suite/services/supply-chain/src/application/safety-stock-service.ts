import { NotFoundError, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import {
  computeSafetyStock,
  parseSafetyStockMethod,
  SafetyStockPolicy,
  weeklyStdDev,
  type SafetyStockContext,
} from "../domain/safety-stock.js";
import type { SupplyChainDeps } from "./ports.js";

export class SafetyStockService {
  constructor(private readonly deps: SupplyChainDeps) {}

  async createPolicy(
    ctx: TenantContext,
    input: { name: string; description?: string; method: unknown },
  ): Promise<SafetyStockPolicy> {
    const policy = SafetyStockPolicy.create(ctx.tenantId, {
      name: input.name,
      description: input.description,
      method: parseSafetyStockMethod(input.method),
    });
    await this.deps.policies.save(policy);
    await this.deps.outbox.publish(policy.pullEvents());
    return policy;
  }

  async getPolicy(ctx: TenantContext, id: Ulid): Promise<SafetyStockPolicy> {
    const policy = await this.deps.policies.findById(ctx.tenantId, id);
    if (!policy) throw new NotFoundError("SafetyStockPolicy", id);
    return policy;
  }

  async listPolicies(ctx: TenantContext): Promise<SafetyStockPolicy[]> {
    return this.deps.policies.list(ctx.tenantId);
  }

  async changeMethod(ctx: TenantContext, id: Ulid, method: unknown): Promise<SafetyStockPolicy> {
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
  preview(input: { method: unknown; weeklyDemandSeries: readonly number[]; leadTimeDays: number }): {
    safetyStock: number;
    context: SafetyStockContext;
  } {
    const method = parseSafetyStockMethod(input.method);
    const series = input.weeklyDemandSeries ?? [];
    const avg = series.length > 0 ? series.reduce((s, v) => s + v, 0) / series.length : 0;
    const context: SafetyStockContext = {
      avgWeeklyDemand: avg,
      weeklyDemandStdDev: weeklyStdDev(series),
      leadTimeDays: input.leadTimeDays,
    };
    return { safetyStock: computeSafetyStock(method, context), context };
  }
}
