import { type Brand } from "@enterprise-suite/shared-kernel";
/** Calendar date without time component, always `YYYY-MM-DD`. */
export type IsoDate = Brand<string, "IsoDate">;
/** Wall-clock time without date, always `HH:MM` (24h). */
export type TimeOfDay = Brand<string, "TimeOfDay">;
export declare function isoDate(value: string): IsoDate;
export declare function timeOfDay(value: string): TimeOfDay;
export declare function timeToMinutes(value: TimeOfDay): number;
/** ISO dates compare correctly as strings. */
export declare function compareDates(a: IsoDate, b: IsoDate): number;
export declare function addDays(date: IsoDate, days: number): IsoDate;
/** Adds months, clamping the day-of-month (e.g. Jan 31 + 1 month = Feb 28/29). */
export declare function addMonthsClamped(date: IsoDate, months: number): IsoDate;
/** Inclusive count of calendar days between two dates. Returns 0 when end < start. */
export declare function calendarDaysInclusive(start: IsoDate, end: IsoDate): number;
export declare function isWeekend(date: IsoDate): boolean;
/**
 * Counts Monday–Friday days in [start, end] inclusive, skipping any date
 * present in `holidays` (set of `YYYY-MM-DD` strings).
 */
export declare function countWorkingDays(start: IsoDate, end: IsoDate, holidays?: ReadonlySet<string>): number;
export declare function yearOf(date: IsoDate): number;
/** 1-based month. */
export declare function monthOf(date: IsoDate): number;
export declare function firstDayOfMonth(year: number, month1Based: number): IsoDate;
export declare function lastDayOfMonth(year: number, month1Based: number): IsoDate;
/** Rounds to 2 decimal places; used for fractional leave days. */
export declare function round2(value: number): number;
export declare function assertRange(start: IsoDate, end: IsoDate, what: string): void;
//# sourceMappingURL=common.d.ts.map