import type { PlanningCalendar } from "./calendar.js";
import { type IsoDate } from "./types.js";
export interface AtpRow {
    readonly weekStart: IsoDate;
    readonly supply: number;
    readonly demand: number;
    /**
     * Discrete ATP of this bucket after backward consumption: the quantity of
     * this bucket's supply still promisable to new demand.
     */
    readonly atp: number;
    /** Running total promisable up to and including this bucket. */
    readonly cumulativeAtp: number;
}
export interface AtpInput {
    readonly calendar: PlanningCalendar;
    readonly onHand: number;
    /** Scheduled receipts + firmed/released planned orders, bucketized. */
    readonly supply: readonly number[];
    /** Committed demand only (active allocations), bucketized. Forecast is excluded. */
    readonly demand: readonly number[];
}
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
export declare function computeAtp(input: AtpInput): AtpRow[];
export interface CtpRequest {
    readonly qty: number;
    readonly needDate: IsoDate;
}
export interface CapacityWindow {
    readonly weekStart: IsoDate;
    /** Unused supplier capacity in that week. */
    readonly availableQty: number;
}
export interface CtpResult {
    readonly canPromise: boolean;
    /** Earliest date the full quantity can be committed, if promisable. */
    readonly promiseDate: IsoDate | null;
    readonly qtyFromAtp: number;
    readonly qtyFromNewSupply: number;
    readonly detail: string;
}
/**
 * Simplified capable-to-promise: first consume cumulative ATP at the request
 * date; if short, walk forward to find when ATP alone suffices; finally
 * consider raising new supply against unused supplier capacity, landing no
 * earlier than capacity week + lead time.
 */
export declare function computeCtp(atpRows: readonly AtpRow[], request: CtpRequest, options: {
    readonly leadTimeDays: number;
    readonly capacity: readonly CapacityWindow[];
    readonly addDays: (date: IsoDate, days: number) => IsoDate;
}): CtpResult;
//# sourceMappingURL=atp.d.ts.map