import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { PlanningItem } from "../domain/planning-item.js";
export class ItemService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async createItem(ctx, input) {
        const existing = await this.deps.items.findBySku(ctx.tenantId, input.sku?.trim().toUpperCase());
        if (existing)
            throw new ConflictError(`Item with SKU ${existing.sku} already exists`);
        if (input.safetyStockPolicyId) {
            const policy = await this.deps.policies.findById(ctx.tenantId, input.safetyStockPolicyId);
            if (!policy)
                throw new NotFoundError("SafetyStockPolicy", input.safetyStockPolicyId);
        }
        const item = PlanningItem.create(ctx.tenantId, input);
        await this.deps.items.save(item);
        await this.deps.outbox.publish(item.pullEvents());
        return item;
    }
    async getItem(ctx, id) {
        const item = await this.deps.items.findById(ctx.tenantId, id);
        if (!item)
            throw new NotFoundError("PlanningItem", id);
        return item;
    }
    async listItems(ctx) {
        return this.deps.items.listAll(ctx.tenantId);
    }
    async changeLotSizing(ctx, id, rule) {
        const item = await this.getItem(ctx, id);
        item.changeLotSizing(rule);
        await this.deps.items.save(item);
        return item;
    }
    async replaceBom(ctx, id, lines) {
        const item = await this.getItem(ctx, id);
        item.replaceBom(lines);
        await this.deps.items.save(item);
        await this.deps.outbox.publish(item.pullEvents());
        return item;
    }
    async assignSafetyStockPolicy(ctx, id, policyId) {
        const item = await this.getItem(ctx, id);
        if (policyId) {
            const policy = await this.deps.policies.findById(ctx.tenantId, policyId);
            if (!policy)
                throw new NotFoundError("SafetyStockPolicy", policyId);
        }
        item.assignSafetyStockPolicy(policyId);
        await this.deps.items.save(item);
        return item;
    }
    async deactivateItem(ctx, id) {
        const item = await this.getItem(ctx, id);
        item.deactivate();
        await this.deps.items.save(item);
        return item;
    }
}
//# sourceMappingURL=item-service.js.map