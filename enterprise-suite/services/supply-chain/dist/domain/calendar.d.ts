import type { IsoDate } from "./types.js";
export declare function isoDate(value: string): IsoDate;
export declare function toUtcDate(date: IsoDate): Date;
export declare function fromUtcDate(date: Date): IsoDate;
export declare function addDays(date: IsoDate, days: number): IsoDate;
/** Whole days from `a` to `b`; positive when `b` is after `a`. */
export declare function diffDays(a: IsoDate, b: IsoDate): number;
/** Monday of the ISO week containing `date`. */
export declare function startOfIsoWeek(date: IsoDate): IsoDate;
export declare function compareDates(a: IsoDate, b: IsoDate): number;
export declare function maxDate(a: IsoDate, b: IsoDate): IsoDate;
/**
 * Weekly time-bucket calendar used by MRP, ATP and capacity planning.
 * Bucket 0 starts at the Monday of the week containing `anchor`; every
 * bucket covers 7 days.
 */
export interface PlanningCalendar {
    readonly start: IsoDate;
    /** Exclusive end of the horizon. */
    readonly end: IsoDate;
    readonly weekCount: number;
    /** Monday of each bucket, index-aligned with MRP row arrays. */
    readonly weekStarts: readonly IsoDate[];
}
export declare function makeWeeklyCalendar(anchor: IsoDate, weekCount: number): PlanningCalendar;
/**
 * Bucket index for a date: -1 before the horizon, `weekCount` at or beyond
 * its end. Callers decide how to treat out-of-horizon values.
 */
export declare function bucketIndexOf(calendar: PlanningCalendar, date: IsoDate): number;
/** Bucket index clamped into the horizon (past-due collapses into bucket 0). */
export declare function clampedBucketIndexOf(calendar: PlanningCalendar, date: IsoDate): number;
/** Sums dated quantities into an index-aligned array of bucket totals. */
export declare function bucketize(calendar: PlanningCalendar, entries: readonly {
    date: IsoDate;
    qty: number;
}[], options?: {
    includePastDueInFirstBucket?: boolean;
}): number[];
//# sourceMappingURL=calendar.d.ts.map