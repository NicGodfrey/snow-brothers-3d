import { AggregateRoot, type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type LotSizingRule } from "./lot-sizing.js";
import { type SupplierId, type UnitOfMeasure } from "./types.js";
export type ProcurementType = "MAKE" | "BUY";
/**
 * Single-level bill-of-material line: producing 1 unit of the parent consumes
 * `qtyPer x (1 + scrapPct)` of the component.
 */
export interface BomLine {
    readonly componentSku: string;
    readonly qtyPer: number;
    /** Expected scrap fraction, 0..0.5 (e.g. 0.02 = 2% extra issued). */
    readonly scrapPct: number;
}
export declare function effectiveQtyPer(line: BomLine): number;
interface PlanningItemProps {
    sku: string;
    description: string;
    uom: UnitOfMeasure;
    procurementType: ProcurementType;
    leadTimeDays: number;
    lotSizing: LotSizingRule;
    safetyStockPolicyId: Ulid | null;
    preferredSupplierId: SupplierId | null;
    standardCost: Money | null;
    bom: readonly BomLine[];
    active: boolean;
}
export interface CreatePlanningItemInput {
    sku: string;
    description: string;
    uom?: string;
    procurementType: ProcurementType;
    leadTimeDays: number;
    lotSizing?: unknown;
    safetyStockPolicyId?: Ulid;
    preferredSupplierId?: string;
    standardCostMinor?: number;
    currency?: string;
    bom?: readonly {
        componentSku: string;
        qtyPer: number;
        scrapPct?: number;
    }[];
}
/**
 * Planning master data for one SKU: procurement type, lead time, lot-sizing
 * rule, safety stock policy reference and single-level BOM. The MRP engine
 * treats MAKE items as producible (their planned orders explode into
 * component demand) and BUY items as supplier-sourced (their planned orders
 * are candidate purchase orders and load supplier capacity).
 */
export declare class PlanningItem extends AggregateRoot<PlanningItemProps> {
    static create(tenantId: TenantId, input: CreatePlanningItemInput): PlanningItem;
    get sku(): string;
    get procurementType(): ProcurementType;
    get leadTimeDays(): number;
    get lotSizing(): LotSizingRule;
    get safetyStockPolicyId(): Ulid | null;
    get preferredSupplierId(): SupplierId | null;
    get standardCost(): Money | null;
    get bom(): readonly BomLine[];
    get active(): boolean;
    changeLotSizing(rule: unknown): void;
    assignSafetyStockPolicy(policyId: Ulid | null): void;
    replaceBom(lines: readonly {
        componentSku: string;
        qtyPer: number;
        scrapPct?: number;
    }[]): void;
    deactivate(): void;
}
export {};
//# sourceMappingURL=planning-item.d.ts.map