import { roundQty } from "./types.js";
/**
 * Classic discrete available-to-promise with backward consumption.
 *
 * ATP exists in bucket 0 (on-hand) and in every bucket with incoming supply.
 * Each ATP bucket absorbs the committed demand from its own bucket up to (but
 * excluding) the next supply bucket. If a segment over-consumes its supply,
 * the deficit is consumed backwards from earlier ATP buckets — earlier supply
 * is already spoken for by later committed demand and must not be promised
 * again. A negative first bucket signals demand that no supply covers.
 */
export function computeAtp(input) {
    const n = input.calendar.weekCount;
    const supply = pad(input.supply, n);
    const demand = pad(input.demand, n);
    supply[0] = roundQty(supply[0] + input.onHand);
    // Segment boundaries: bucket 0 and every bucket with supply.
    const segmentStarts = [0];
    for (let t = 1; t < n; t += 1) {
        if (supply[t] > 0)
            segmentStarts.push(t);
    }
    const atpBySegment = [];
    for (let s = 0; s < segmentStarts.length; s += 1) {
        const from = segmentStarts[s];
        const to = s + 1 < segmentStarts.length ? segmentStarts[s + 1] : n;
        let segmentDemand = 0;
        for (let t = from; t < to; t += 1)
            segmentDemand += demand[t];
        atpBySegment.push(roundQty(supply[from] - segmentDemand));
    }
    // Backward consumption: pull deficits into earlier segments.
    for (let s = atpBySegment.length - 1; s > 0; s -= 1) {
        if (atpBySegment[s] < 0) {
            atpBySegment[s - 1] = roundQty(atpBySegment[s - 1] + atpBySegment[s]);
            atpBySegment[s] = 0;
        }
    }
    const rows = [];
    let cumulative = 0;
    let segment = -1;
    for (let t = 0; t < n; t += 1) {
        if (segment + 1 < segmentStarts.length && segmentStarts[segment + 1] === t)
            segment += 1;
        const atp = segmentStarts[segment] === t ? atpBySegment[segment] : 0;
        cumulative = roundQty(cumulative + atp);
        rows.push({
            weekStart: input.calendar.weekStarts[t],
            supply: supply[t],
            demand: demand[t],
            atp,
            cumulativeAtp: cumulative,
        });
    }
    return rows;
}
/**
 * Simplified capable-to-promise: first consume cumulative ATP at the request
 * date; if short, walk forward to find when ATP alone suffices; finally
 * consider raising new supply against unused supplier capacity, landing no
 * earlier than capacity week + lead time.
 */
export function computeCtp(atpRows, request, options) {
    const requestBucket = lastBucketAtOrBefore(atpRows, request.needDate);
    const atpAtNeed = requestBucket >= 0 ? atpRows[requestBucket].cumulativeAtp : 0;
    if (atpAtNeed >= request.qty) {
        return {
            canPromise: true,
            promiseDate: request.needDate,
            qtyFromAtp: request.qty,
            qtyFromNewSupply: 0,
            detail: `Fully covered by ATP (${roundQty(atpAtNeed)} available by ${request.needDate})`,
        };
    }
    // Later ATP: find the first bucket where cumulative ATP covers the quantity.
    for (let t = Math.max(requestBucket + 1, 0); t < atpRows.length; t += 1) {
        if (atpRows[t].cumulativeAtp >= request.qty) {
            return {
                canPromise: true,
                promiseDate: atpRows[t].weekStart,
                qtyFromAtp: request.qty,
                qtyFromNewSupply: 0,
                detail: `ATP covers the quantity from week ${atpRows[t].weekStart} (later than requested ${request.needDate})`,
            };
        }
    }
    // New supply against unused capacity for the remainder.
    const bestAtp = Math.max(0, atpRows.at(-1)?.cumulativeAtp ?? 0);
    const remainder = roundQty(request.qty - bestAtp);
    let accumulated = 0;
    for (const window of options.capacity) {
        accumulated = roundQty(accumulated + Math.max(0, window.availableQty));
        if (accumulated >= remainder) {
            const supplyArrival = options.addDays(window.weekStart, options.leadTimeDays);
            const promiseDate = maxIso(supplyArrival, request.needDate);
            return {
                canPromise: true,
                promiseDate,
                qtyFromAtp: bestAtp,
                qtyFromNewSupply: remainder,
                detail: `${bestAtp} from ATP plus ${remainder} from new supply; capacity accumulates by week ` +
                    `${window.weekStart}, arriving after ${options.leadTimeDays}d lead time`,
            };
        }
    }
    return {
        canPromise: false,
        promiseDate: null,
        qtyFromAtp: bestAtp,
        qtyFromNewSupply: 0,
        detail: `Cannot promise ${request.qty}: cumulative ATP tops out at ${bestAtp} and supplier capacity ` +
            `covers only ${accumulated} of the remaining ${remainder} within the horizon`,
    };
}
function lastBucketAtOrBefore(rows, date) {
    let index = -1;
    for (let t = 0; t < rows.length; t += 1) {
        if (rows[t].weekStart <= date)
            index = t;
        else
            break;
    }
    return index;
}
function maxIso(a, b) {
    return a >= b ? a : b;
}
function pad(values, length) {
    const out = new Array(length).fill(0);
    for (let i = 0; i < Math.min(values.length, length); i += 1)
        out[i] = roundQty(values[i]);
    return out;
}
//# sourceMappingURL=atp.js.map