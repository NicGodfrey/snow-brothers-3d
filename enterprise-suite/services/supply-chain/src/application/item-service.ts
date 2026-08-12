import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { PlanningItem, type CreatePlanningItemInput } from "../domain/planning-item.js";
import type { SupplyChainDeps } from "./ports.js";

export class ItemService {
  constructor(private readonly deps: SupplyChainDeps) {}

  async createItem(ctx: TenantContext, input: CreatePlanningItemInput): Promise<PlanningItem> {
    const existing = await this.deps.items.findBySku(ctx.tenantId, input.sku?.trim().toUpperCase());
    if (existing) throw new ConflictError(`Item with SKU ${existing.sku} already exists`);
    if (input.safetyStockPolicyId) {
      const policy = await this.deps.policies.findById(ctx.tenantId, input.safetyStockPolicyId);
      if (!policy) throw new NotFoundError("SafetyStockPolicy", input.safetyStockPolicyId);
    }
    const item = PlanningItem.create(ctx.tenantId, input);
    await this.deps.items.save(item);
    await this.deps.outbox.publish(item.pullEvents());
    return item;
  }

  async getItem(ctx: TenantContext, id: Ulid): Promise<PlanningItem> {
    const item = await this.deps.items.findById(ctx.tenantId, id);
    if (!item) throw new NotFoundError("PlanningItem", id);
    return item;
  }

  async listItems(ctx: TenantContext): Promise<PlanningItem[]> {
    return this.deps.items.listAll(ctx.tenantId);
  }

  async changeLotSizing(ctx: TenantContext, id: Ulid, rule: unknown): Promise<PlanningItem> {
    const item = await this.getItem(ctx, id);
    item.changeLotSizing(rule);
    await this.deps.items.save(item);
    return item;
  }

  async replaceBom(
    ctx: TenantContext,
    id: Ulid,
    lines: readonly { componentSku: string; qtyPer: number; scrapPct?: number }[],
  ): Promise<PlanningItem> {
    const item = await this.getItem(ctx, id);
    item.replaceBom(lines);
    await this.deps.items.save(item);
    await this.deps.outbox.publish(item.pullEvents());
    return item;
  }

  async assignSafetyStockPolicy(ctx: TenantContext, id: Ulid, policyId: Ulid | null): Promise<PlanningItem> {
    const item = await this.getItem(ctx, id);
    if (policyId) {
      const policy = await this.deps.policies.findById(ctx.tenantId, policyId);
      if (!policy) throw new NotFoundError("SafetyStockPolicy", policyId);
    }
    item.assignSafetyStockPolicy(policyId);
    await this.deps.items.save(item);
    return item;
  }

  async deactivateItem(ctx: TenantContext, id: Ulid): Promise<PlanningItem> {
    const item = await this.getItem(ctx, id);
    item.deactivate();
    await this.deps.items.save(item);
    return item;
  }
}
