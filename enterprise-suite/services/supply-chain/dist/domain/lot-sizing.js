import { DomainError } from "@enterprise-suite/shared-kernel";
import { assertIntInRange, assertQty, roundQty } from "./types.js";
export function parseLotSizingRule(input) {
    if (typeof input !== "object" || input === null) {
        throw new DomainError("Lot sizing rule must be an object", "VALIDATION");
    }
    const raw = input;
    switch (raw.type) {
        case "LOT_FOR_LOT":
            return { type: "LOT_FOR_LOT" };
        case "FIXED_ORDER_QTY":
            return { type: "FIXED_ORDER_QTY", fixedQty: assertQty("fixedQty", raw.fixedQty, { allowZero: false }) };
        case "MIN_MAX": {
            const minQty = assertQty("minQty", raw.minQty, { allowZero: false });
            const multiple = raw.multiple === undefined ? undefined : assertQty("multiple", raw.multiple, { allowZero: false });
            const maxQty = raw.maxQty === undefined ? undefined : assertQty("maxQty", raw.maxQty, { allowZero: false });
            if (maxQty !== undefined && maxQty < minQty) {
                throw new DomainError("maxQty must be >= minQty", "VALIDATION");
            }
            return { type: "MIN_MAX", minQty, multiple, maxQty };
        }
        case "PERIOD_ORDER_QTY":
            return { type: "PERIOD_ORDER_QTY", periods: assertIntInRange("periods", raw.periods, 1, 52) };
        default:
            throw new DomainError(`Unknown lot sizing type: ${String(raw.type)}`, "VALIDATION");
    }
}
function roundUpToMultiple(value, multiple) {
    return roundQty(Math.ceil(roundQty(value / multiple) - 1e-9) * multiple);
}
/**
 * Applies a lot-sizing rule to a computed need. `need` must already include
 * any period-order-quantity lookahead (the netting engine owns that logic
 * because it depends on the projected on-hand trajectory).
 */
export function applyLotSizing(rule, need) {
    if (need <= 0)
        return { qty: 0, warnings: [] };
    switch (rule.type) {
        case "LOT_FOR_LOT":
        case "PERIOD_ORDER_QTY":
            return { qty: roundQty(need), warnings: [] };
        case "FIXED_ORDER_QTY":
            return { qty: roundUpToMultiple(need, rule.fixedQty), warnings: [] };
        case "MIN_MAX": {
            let qty = Math.max(need, rule.minQty);
            if (rule.multiple !== undefined)
                qty = roundUpToMultiple(qty, rule.multiple);
            const warnings = [];
            if (rule.maxQty !== undefined && qty > rule.maxQty) {
                if (need > rule.maxQty) {
                    // Cannot honour the cap without leaving a shortage; order the need
                    // and let planners resolve via the exception raised by the engine.
                    warnings.push(`Net requirement ${roundQty(need)} exceeds maximum lot size ${rule.maxQty}`);
                    qty = rule.multiple !== undefined ? roundUpToMultiple(need, rule.multiple) : need;
                }
                else {
                    qty = rule.maxQty;
                }
            }
            return { qty: roundQty(qty), warnings };
        }
    }
}
/** How many buckets ahead (beyond the current one) an order should cover. */
export function coverageLookaheadPeriods(rule) {
    return rule.type === "PERIOD_ORDER_QTY" ? rule.periods - 1 : 0;
}
//# sourceMappingURL=lot-sizing.js.map