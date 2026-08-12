import { brand, DomainError } from "@enterprise-suite/shared-kernel";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isoDate(value) {
    if (!ISO_DATE_RE.test(value)) {
        throw new DomainError(`Invalid ISO date: ${value}`, "INVALID_DATE", 400);
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new DomainError(`Invalid calendar date: ${value}`, "INVALID_DATE", 400);
    }
    return brand(value);
}
export function timeOfDay(value) {
    if (!TIME_RE.test(value)) {
        throw new DomainError(`Invalid time of day: ${value}`, "INVALID_TIME", 400);
    }
    return brand(value);
}
export function timeToMinutes(value) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
}
/** ISO dates compare correctly as strings. */
export function compareDates(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
export function addDays(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return brand(d.toISOString().slice(0, 10));
}
function daysInMonth(year, month1Based) {
    return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}
/** Adds months, clamping the day-of-month (e.g. Jan 31 + 1 month = Feb 28/29). */
export function addMonthsClamped(date, months) {
    const d = new Date(`${date}T00:00:00Z`);
    const totalMonths = d.getUTCMonth() + months;
    const year = d.getUTCFullYear() + Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    const day = Math.min(d.getUTCDate(), daysInMonth(year, month + 1));
    const iso = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return brand(iso);
}
/** Inclusive count of calendar days between two dates. Returns 0 when end < start. */
export function calendarDaysInclusive(start, end) {
    if (end < start)
        return 0;
    const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
    return Math.round(ms / 86_400_000) + 1;
}
export function isWeekend(date) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return dow === 0 || dow === 6;
}
/**
 * Counts Monday–Friday days in [start, end] inclusive, skipping any date
 * present in `holidays` (set of `YYYY-MM-DD` strings).
 */
export function countWorkingDays(start, end, holidays = new Set()) {
    if (end < start)
        return 0;
    let count = 0;
    let cursor = start;
    while (cursor <= end) {
        if (!isWeekend(cursor) && !holidays.has(cursor))
            count += 1;
        cursor = addDays(cursor, 1);
    }
    return count;
}
export function yearOf(date) {
    return Number(date.slice(0, 4));
}
/** 1-based month. */
export function monthOf(date) {
    return Number(date.slice(5, 7));
}
export function firstDayOfMonth(year, month1Based) {
    return isoDate(`${String(year).padStart(4, "0")}-${String(month1Based).padStart(2, "0")}-01`);
}
export function lastDayOfMonth(year, month1Based) {
    const day = daysInMonth(year, month1Based);
    return isoDate(`${String(year).padStart(4, "0")}-${String(month1Based).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}
/** Rounds to 2 decimal places; used for fractional leave days. */
export function round2(value) {
    return Math.round(value * 100) / 100;
}
export function assertRange(start, end, what) {
    if (end < start) {
        throw new DomainError(`${what}: end date ${end} precedes start date ${start}`, "INVALID_RANGE", 400);
    }
}
//# sourceMappingURL=common.js.map