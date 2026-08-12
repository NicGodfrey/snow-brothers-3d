import { brand, DomainError, type Brand } from "@enterprise-suite/shared-kernel";

/** Calendar date without time component, always `YYYY-MM-DD`. */
export type IsoDate = Brand<string, "IsoDate">;

/** Wall-clock time without date, always `HH:MM` (24h). */
export type TimeOfDay = Brand<string, "TimeOfDay">;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isoDate(value: string): IsoDate {
  if (!ISO_DATE_RE.test(value)) {
    throw new DomainError(`Invalid ISO date: ${value}`, "INVALID_DATE", 400);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError(`Invalid calendar date: ${value}`, "INVALID_DATE", 400);
  }
  return brand<string, "IsoDate">(value);
}

export function timeOfDay(value: string): TimeOfDay {
  if (!TIME_RE.test(value)) {
    throw new DomainError(`Invalid time of day: ${value}`, "INVALID_TIME", 400);
  }
  return brand<string, "TimeOfDay">(value);
}

export function timeToMinutes(value: TimeOfDay): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** ISO dates compare correctly as strings. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return brand<string, "IsoDate">(d.toISOString().slice(0, 10));
}

function daysInMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

/** Adds months, clamping the day-of-month (e.g. Jan 31 + 1 month = Feb 28/29). */
export function addMonthsClamped(date: IsoDate, months: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  const totalMonths = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(year, month + 1));
  const iso = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return brand<string, "IsoDate">(iso);
}

/** Inclusive count of calendar days between two dates. Returns 0 when end < start. */
export function calendarDaysInclusive(start: IsoDate, end: IsoDate): number {
  if (end < start) return 0;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export function isWeekend(date: IsoDate): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Counts Monday–Friday days in [start, end] inclusive, skipping any date
 * present in `holidays` (set of `YYYY-MM-DD` strings).
 */
export function countWorkingDays(
  start: IsoDate,
  end: IsoDate,
  holidays: ReadonlySet<string> = new Set(),
): number {
  if (end < start) return 0;
  let count = 0;
  let cursor = start;
  while (cursor <= end) {
    if (!isWeekend(cursor) && !holidays.has(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

export function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

/** 1-based month. */
export function monthOf(date: IsoDate): number {
  return Number(date.slice(5, 7));
}

export function firstDayOfMonth(year: number, month1Based: number): IsoDate {
  return isoDate(`${String(year).padStart(4, "0")}-${String(month1Based).padStart(2, "0")}-01`);
}

export function lastDayOfMonth(year: number, month1Based: number): IsoDate {
  const day = daysInMonth(year, month1Based);
  return isoDate(
    `${String(year).padStart(4, "0")}-${String(month1Based).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

/** Rounds to 2 decimal places; used for fractional leave days. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function assertRange(start: IsoDate, end: IsoDate, what: string): void {
  if (end < start) {
    throw new DomainError(`${what}: end date ${end} precedes start date ${start}`, "INVALID_RANGE", 400);
  }
}
