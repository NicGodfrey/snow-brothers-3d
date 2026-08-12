import { AggregateRoot, type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { MrpException, MrpRow } from "./mrp.js";
import type { IsoDate, LocationCode, SupplierId } from "./types.js";
export type PlannedOrderType = "PURCHASE" | "PRODUCTION";
export type PlannedOrderStatus = "PLANNED" | "FIRMED" | "RELEASED" | "CANCELLED";
/**
 * A time-phased supply proposal produced by MRP.
 *
 * - PLANNED   regenerated freely by the next planning run
 * - FIRMED    pinned by a planner; the next run treats it as a scheduled
 *             receipt instead of re-deriving it
 * - RELEASED  handed off to procurement (PURCHASE) or manufacturing
 *             (PRODUCTION); becomes a real order outside this context
 * - CANCELLED removed from consideration
 */
export interface PlannedOrder {
    readonly orderId: string;
    readonly orderType: PlannedOrderType;
    readonly sku: string;
    readonly qty: number;
    readonly dueDate: IsoDate;
    readonly releaseDate: IsoDate;
    readonly status: PlannedOrderStatus;
    readonly supplierId: SupplierId | null;
    readonly estimatedCost: Money | null;
    readonly pastDue: boolean;
}
export interface SupplyPlanStats {
    readonly totalGrossRequirement: number;
    readonly totalPlannedQty: number;
    readonly orderCount: number;
    readonly exceptionCount: number;
    readonly endingOnHand: number;
}
interface SupplyPlanProps {
    runId: Ulid;
    sku: string;
    location: LocationCode;
    horizonStart: IsoDate;
    weekCount: number;
    safetyStock: number;
    rows: readonly MrpRow[];
    orders: readonly PlannedOrder[];
    exceptions: readonly MrpException[];
    stats: SupplyPlanStats;
}
export interface CreateSupplyPlanInput {
    runId: Ulid;
    sku: string;
    location: LocationCode;
    horizonStart: IsoDate;
    weekCount: number;
    safetyStock: number;
    rows: readonly MrpRow[];
    exceptions: readonly MrpException[];
    orders: readonly {
        orderType: PlannedOrderType;
        qty: number;
        dueDate: IsoDate;
        releaseDate: IsoDate;
        supplierId: SupplierId | null;
        unitCost: Money | null;
        pastDue: boolean;
    }[];
}
/**
 * The persisted result of netting one item at one location in one planning
 * run: the full MRP grid, generated planned orders and exception messages.
 * Order lifecycle transitions happen here so the invariants (no firming a
 * released order, etc.) live with the data they protect.
 */
export declare class SupplyPlan extends AggregateRoot<SupplyPlanProps> {
    static create(tenantId: TenantId, input: CreateSupplyPlanInput): SupplyPlan;
    get runId(): Ulid;
    get sku(): string;
    get location(): LocationCode;
    get rows(): readonly MrpRow[];
    get orders(): readonly PlannedOrder[];
    get exceptions(): readonly MrpException[];
    get stats(): SupplyPlanStats;
    /** Orders the next planning run must respect as committed supply. */
    firmedOrders(): readonly PlannedOrder[];
    firmOrder(orderId: string): PlannedOrder;
    releaseOrder(orderId: string): PlannedOrder;
    cancelOrder(orderId: string): PlannedOrder;
    private getOrder;
    private transition;
}
export {};
//# sourceMappingURL=supply-plan.d.ts.map