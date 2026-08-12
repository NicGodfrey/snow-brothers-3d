import { type PlanningCalendar } from "./calendar.js";
import { type LotSizingRule } from "./lot-sizing.js";
import { type IsoDate } from "./types.js";
/** One row of the classic MRP grid for a single weekly bucket. */
export interface MrpRow {
    readonly weekStart: IsoDate;
    readonly grossRequirement: number;
    readonly scheduledReceipts: number;
    readonly plannedReceipts: number;
    /** Projected on-hand at the END of the bucket, after all flows. */
    readonly projectedOnHand: number;
    readonly netRequirement: number;
}
export type MrpExceptionCode = "RELEASE_PAST_DUE" | "BELOW_SAFETY_STOCK" | "SHORTAGE" | "EXPEDITE_RECEIPT" | "EXCESS_RECEIPT" | "LOT_MAX_EXCEEDED" | "SUPPLIER_CAPACITY_OVERLOAD";
export interface MrpException {
    readonly code: MrpExceptionCode;
    readonly severity: "WARNING" | "ERROR";
    readonly weekStart: IsoDate | null;
    readonly message: string;
}
export interface PlannedOrderProposal {
    /** Bucket index the material must be available in. */
    readonly dueIndex: number;
    readonly dueDate: IsoDate;
    /** Order start, offset by lead time; clamped into the horizon. */
    readonly releaseDate: IsoDate;
    /** Bucket index of the (clamped) release, used for BOM explosion. */
    readonly releaseIndex: number;
    readonly qty: number;
    readonly pastDue: boolean;
}
export interface NetItemInput {
    readonly sku: string;
    readonly calendar: PlanningCalendar;
    readonly onHand: number;
    readonly safetyStock: number;
    readonly leadTimeDays: number;
    readonly lotSizing: LotSizingRule;
    /** Index-aligned with calendar.weekStarts. */
    readonly grossRequirements: readonly number[];
    readonly scheduledReceipts: readonly number[];
}
export interface NetItemResult {
    readonly sku: string;
    readonly rows: readonly MrpRow[];
    readonly plannedOrders: readonly PlannedOrderProposal[];
    readonly exceptions: readonly MrpException[];
}
/**
 * Time-phased MRP netting for one item.
 *
 * For each bucket, availability is last bucket's projected on-hand plus
 * scheduled receipts. When availability minus gross demand would fall below
 * safety stock, the shortfall becomes a net requirement; lot-sizing turns it
 * into a planned receipt in the same bucket, and the order release is offset
 * backwards by the item lead time. PERIOD_ORDER_QTY additionally pulls in
 * the shortfalls of the next `periods - 1` buckets so a single order covers
 * the whole window.
 */
export declare function netItem(input: NetItemInput): NetItemResult;
//# sourceMappingURL=mrp.d.ts.map