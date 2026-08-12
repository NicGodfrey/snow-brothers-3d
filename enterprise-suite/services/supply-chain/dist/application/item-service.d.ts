import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { PlanningItem, type CreatePlanningItemInput } from "../domain/planning-item.js";
import type { SupplyChainDeps } from "./ports.js";
export declare class ItemService {
    private readonly deps;
    constructor(deps: SupplyChainDeps);
    createItem(ctx: TenantContext, input: CreatePlanningItemInput): Promise<PlanningItem>;
    getItem(ctx: TenantContext, id: Ulid): Promise<PlanningItem>;
    listItems(ctx: TenantContext): Promise<PlanningItem[]>;
    changeLotSizing(ctx: TenantContext, id: Ulid, rule: unknown): Promise<PlanningItem>;
    replaceBom(ctx: TenantContext, id: Ulid, lines: readonly {
        componentSku: string;
        qtyPer: number;
        scrapPct?: number;
    }[]): Promise<PlanningItem>;
    assignSafetyStockPolicy(ctx: TenantContext, id: Ulid, policyId: Ulid | null): Promise<PlanningItem>;
    deactivateItem(ctx: TenantContext, id: Ulid): Promise<PlanningItem>;
}
//# sourceMappingURL=item-service.d.ts.map