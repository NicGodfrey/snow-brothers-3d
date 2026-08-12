/**
 * Lot-sizing policies supported by the MRP engine.
 *
 * - LOT_FOR_LOT      order exactly the net requirement of the bucket
 * - FIXED_ORDER_QTY  order in multiples of a fixed lot (e.g. pallet, batch)
 * - MIN_MAX          respect a minimum order quantity, optional rounding
 *                    multiple and optional maximum lot size
 * - PERIOD_ORDER_QTY one order covering the net requirements of the next
 *                    `periods` buckets (classic POQ)
 */
export type LotSizingRule = {
    readonly type: "LOT_FOR_LOT";
} | {
    readonly type: "FIXED_ORDER_QTY";
    readonly fixedQty: number;
} | {
    readonly type: "MIN_MAX";
    readonly minQty: number;
    readonly multiple?: number;
    readonly maxQty?: number;
} | {
    readonly type: "PERIOD_ORDER_QTY";
    readonly periods: number;
};
export declare function parseLotSizingRule(input: unknown): LotSizingRule;
export interface LotSizeDecision {
    /** Quantity to order (>= requested need). */
    readonly qty: number;
    /** Non-fatal remarks, e.g. a MIN_MAX cap that had to be exceeded. */
    readonly warnings: readonly string[];
}
/**
 * Applies a lot-sizing rule to a computed need. `need` must already include
 * any period-order-quantity lookahead (the netting engine owns that logic
 * because it depends on the projected on-hand trajectory).
 */
export declare function applyLotSizing(rule: LotSizingRule, need: number): LotSizeDecision;
/** How many buckets ahead (beyond the current one) an order should cover. */
export declare function coverageLookaheadPeriods(rule: LotSizingRule): number;
//# sourceMappingURL=lot-sizing.d.ts.map