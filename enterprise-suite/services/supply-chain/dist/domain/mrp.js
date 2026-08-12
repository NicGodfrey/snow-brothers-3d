import { addDays } from "./calendar.js";
import { applyLotSizing, coverageLookaheadPeriods, } from "./lot-sizing.js";
import { roundQty } from "./types.js";
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
export function netItem(input) {
    const { calendar, safetyStock, lotSizing } = input;
    const n = calendar.weekCount;
    const gross = padTo(input.grossRequirements, n);
    const scheduled = padTo(input.scheduledReceipts, n);
    const rows = [];
    const plannedOrders = [];
    const exceptions = [];
    const leadTimeBuckets = Math.ceil(input.leadTimeDays / 7);
    let onHand = input.onHand;
    for (let t = 0; t < n; t += 1) {
        const available = roundQty(onHand + scheduled[t]);
        const shortfall = roundQty(gross[t] + safetyStock - available);
        let netRequirement = 0;
        let plannedReceipt = 0;
        if (shortfall > 0) {
            netRequirement = shortfall;
            const lookahead = coverageLookaheadPeriods(lotSizing);
            const need = netRequirement + futureShortfalls(gross, scheduled, safetyStock, t, lookahead);
            const decision = applyLotSizing(lotSizing, need);
            plannedReceipt = decision.qty;
            for (const warning of decision.warnings) {
                exceptions.push({
                    code: "LOT_MAX_EXCEEDED",
                    severity: "WARNING",
                    weekStart: calendar.weekStarts[t],
                    message: `${input.sku}: ${warning}`,
                });
            }
            plannedOrders.push(buildProposal(input, calendar, t, plannedReceipt, leadTimeBuckets, exceptions));
        }
        onHand = roundQty(available + plannedReceipt - gross[t]);
        rows.push({
            weekStart: calendar.weekStarts[t],
            grossRequirement: gross[t],
            scheduledReceipts: scheduled[t],
            plannedReceipts: plannedReceipt,
            projectedOnHand: onHand,
            netRequirement,
        });
    }
    detectStockExceptions(input, rows, exceptions);
    detectReceiptTimingExceptions(input, rows, scheduled, exceptions);
    return { sku: input.sku, rows, plannedOrders, exceptions };
}
/**
 * Additional quantity needed to keep projected on-hand at safety stock for
 * buckets (t, t + lookahead], assuming the order at t brings stock exactly to
 * safety stock and no further orders are placed inside the window.
 */
function futureShortfalls(gross, scheduled, safetyStock, t, lookahead) {
    let extra = 0;
    let onHand = safetyStock;
    const end = Math.min(gross.length - 1, t + lookahead);
    for (let u = t + 1; u <= end; u += 1) {
        onHand = roundQty(onHand + scheduled[u] - gross[u]);
        if (onHand < safetyStock) {
            extra = roundQty(extra + (safetyStock - onHand));
            onHand = safetyStock;
        }
    }
    return extra;
}
function buildProposal(input, calendar, dueIndex, qty, leadTimeBuckets, exceptions) {
    const dueDate = calendar.weekStarts[dueIndex];
    const idealRelease = addDays(dueDate, -input.leadTimeDays);
    const releaseIndexRaw = dueIndex - leadTimeBuckets;
    const pastDue = releaseIndexRaw < 0;
    const releaseIndex = Math.max(0, releaseIndexRaw);
    const releaseDate = pastDue ? calendar.weekStarts[0] : idealRelease;
    if (pastDue) {
        exceptions.push({
            code: "RELEASE_PAST_DUE",
            severity: "ERROR",
            weekStart: dueDate,
            message: `${input.sku}: order of ${qty} due ${dueDate} requires release on ${idealRelease}, ` +
                `before the planning horizon starts (${calendar.start}). Expedite or reschedule demand.`,
        });
    }
    return { dueIndex, dueDate, releaseDate, releaseIndex, qty, pastDue };
}
function detectStockExceptions(input, rows, exceptions) {
    for (const row of rows) {
        if (row.projectedOnHand < 0) {
            exceptions.push({
                code: "SHORTAGE",
                severity: "ERROR",
                weekStart: row.weekStart,
                message: `${input.sku}: projected on-hand ${row.projectedOnHand} in week ${row.weekStart} is negative even after planning`,
            });
        }
        else if (input.safetyStock > 0 && roundQty(row.projectedOnHand) < input.safetyStock) {
            exceptions.push({
                code: "BELOW_SAFETY_STOCK",
                severity: "WARNING",
                weekStart: row.weekStart,
                message: `${input.sku}: projected on-hand ${row.projectedOnHand} in week ${row.weekStart} is below safety stock ${input.safetyStock}`,
            });
        }
    }
}
/**
 * Action messages about existing scheduled receipts:
 * - EXPEDITE_RECEIPT: a shortage occurs while a receipt sits in a later bucket
 * - EXCESS_RECEIPT:   a receipt arrives although on-hand never dips below
 *                     safety stock through the rest of the horizon without it
 */
function detectReceiptTimingExceptions(input, rows, scheduled, exceptions) {
    const firstProblemIndex = rows.findIndex((row) => row.projectedOnHand < 0 || (input.safetyStock > 0 && row.projectedOnHand < input.safetyStock));
    if (firstProblemIndex >= 0) {
        for (let u = firstProblemIndex + 1; u < scheduled.length; u += 1) {
            if (scheduled[u] > 0) {
                exceptions.push({
                    code: "EXPEDITE_RECEIPT",
                    severity: "WARNING",
                    weekStart: input.calendar.weekStarts[u],
                    message: `${input.sku}: scheduled receipt of ${scheduled[u]} in week ${input.calendar.weekStarts[u]} ` +
                        `could be expedited to cover the shortfall in week ${input.calendar.weekStarts[firstProblemIndex]}`,
                });
                break; // one actionable message is enough
            }
        }
    }
    for (let t = 0; t < rows.length; t += 1) {
        if (scheduled[t] <= 0)
            continue;
        const minOnHandWithoutReceipt = minProjectedOnHandExcluding(rows, t, scheduled[t]);
        if (minOnHandWithoutReceipt >= input.safetyStock) {
            exceptions.push({
                code: "EXCESS_RECEIPT",
                severity: "WARNING",
                weekStart: input.calendar.weekStarts[t],
                message: `${input.sku}: scheduled receipt of ${scheduled[t]} in week ${input.calendar.weekStarts[t]} ` +
                    `is not needed to maintain safety stock; consider cancelling or pushing out`,
            });
        }
    }
}
function minProjectedOnHandExcluding(rows, receiptIndex, receiptQty) {
    let min = Number.POSITIVE_INFINITY;
    for (let t = receiptIndex; t < rows.length; t += 1) {
        const adjusted = roundQty(rows[t].projectedOnHand - receiptQty);
        if (adjusted < min)
            min = adjusted;
    }
    return min;
}
function padTo(values, length) {
    const out = new Array(length).fill(0);
    for (let i = 0; i < Math.min(values.length, length); i += 1)
        out[i] = roundQty(values[i]);
    return out;
}
//# sourceMappingURL=mrp.js.map