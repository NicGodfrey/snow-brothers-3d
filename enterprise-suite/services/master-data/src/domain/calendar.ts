import { brand, type Brand } from "@enterprise-suite/shared-kernel";
import { ValidationError } from "./errors.js";

/**
 * Calendar arithmetic for terms and effectivity.
 *
 * Due dates are calendar facts, not instants: "net 30 from 2026-01-31" must
 * land on 2026-03-02 regardless of the server's timezone or the time of day an
 * invoice was cut. Everything here works on `YYYY-MM-DD` strings computed in
 * UTC so the result never shifts under a daylight-saving boundary.
 *
 * Business-day rules are per calendar, and the weekend itself is data: the
 * working week is Friday-Saturday in much of the Gulf and Sunday-only in
 * parts of Asia, so a hard-coded Saturday/Sunday check would quietly produce
 * wrong due dates for those tenants.
 */

export type IsoDate = Brand<string, "IsoDate">;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isoDate(value: string): IsoDate {
  const candidate = value.trim().slice(0, 10);
  if (!DATE_PATTERN.test(candidate) || Number.isNaN(Date.parse(`${candidate}T00:00:00.000Z`))) {
    throw ValidationError.single("date", `"${value}" is not a YYYY-MM-DD date`);
  }
  const [year, month, day] = candidate.split("-").map(Number) as [number, number, number];
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    throw ValidationError.single("date", `"${value}" is not a real calendar date`);
  }
  return brand<string, "IsoDate">(candidate);
}

/** Date part of an ISO timestamp, in UTC. */
export function dateOf(instant: string): IsoDate {
  return isoDate(instant.slice(0, 10));
}

export function todayUtc(now: Date = new Date()): IsoDate {
  return isoDate(now.toISOString().slice(0, 10));
}

function toUtcMs(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function fromUtcMs(ms: number): IsoDate {
  return brand<string, "IsoDate">(new Date(ms).toISOString().slice(0, 10));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw ValidationError.single("days", "must be a whole number of days");
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function maxDate(...dates: readonly IsoDate[]): IsoDate {
  return dates.reduce((best, current) => (current > best ? current : best));
}

export function minDate(...dates: readonly IsoDate[]): IsoDate {
  return dates.reduce((best, current) => (current < best ? current : best));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds months, clamping the day to the target month (Jan 31 + 1m = Feb 28). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = String(date).split("-").map(Number) as [number, number, number];
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return isoDate(
    `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`,
  );
}

export function startOfMonth(date: IsoDate): IsoDate {
  return isoDate(`${String(date).slice(0, 7)}-01`);
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [year, month] = String(date).split("-").map(Number) as [number, number];
  return isoDate(`${String(date).slice(0, 7)}-${String(daysInMonth(year, month)).padStart(2, "0")}`);
}

/** Sets the day of month, clamping past the month's length. */
export function withDayOfMonth(date: IsoDate, day: number): IsoDate {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw ValidationError.single("day", "day of month must be between 1 and 31");
  }
  const [year, month] = String(date).split("-").map(Number) as [number, number];
  const clamped = Math.min(day, daysInMonth(year, month));
  return isoDate(`${String(date).slice(0, 7)}-${String(clamped).padStart(2, "0")}`);
}

/** 0 = Sunday through 6 = Saturday, in UTC. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

export function dayOfMonth(date: IsoDate): number {
  return Number(String(date).slice(8, 10));
}

export type BusinessDayRule = "none" | "next_business_day" | "previous_business_day" | "modified_following";

export const BUSINESS_DAY_RULES: readonly BusinessDayRule[] = [
  "none",
  "next_business_day",
  "previous_business_day",
  "modified_following",
];

export interface HolidayCalendarInput {
  readonly code: string;
  readonly name: string;
  /** Non-working weekdays; defaults to Saturday and Sunday. */
  readonly weekendDays?: readonly number[];
  readonly holidays?: readonly string[];
}

/**
 * A named set of non-working days. Calendars are tenant data (a company keeps
 * one per country or plant) but the arithmetic is pure, so schedules can be
 * recomputed deterministically in tests and in a nightly re-rate.
 */
export class HolidayCalendar {
  readonly code: string;
  readonly name: string;
  readonly weekendDays: ReadonlySet<number>;
  private readonly holidays: Set<string>;

  constructor(input: HolidayCalendarInput) {
    this.code = input.code.trim().toUpperCase();
    this.name = input.name.trim();
    this.weekendDays = new Set(input.weekendDays ?? [0, 6]);
    this.holidays = new Set((input.holidays ?? []).map((h) => String(isoDate(h))));
  }

  static standard(): HolidayCalendar {
    return new HolidayCalendar({ code: "DEFAULT", name: "Mon-Fri, no holidays" });
  }

  addHoliday(date: string): void {
    this.holidays.add(String(isoDate(date)));
  }

  listHolidays(): readonly IsoDate[] {
    return [...this.holidays].sort().map((h) => brand<string, "IsoDate">(h));
  }

  isHoliday(date: IsoDate): boolean {
    return this.holidays.has(String(date));
  }

  isWeekend(date: IsoDate): boolean {
    return this.weekendDays.has(dayOfWeek(date));
  }

  isBusinessDay(date: IsoDate): boolean {
    return !this.isWeekend(date) && !this.isHoliday(date);
  }

  nextBusinessDay(date: IsoDate): IsoDate {
    let cursor = date;
    // A calendar with every day off would loop forever; 400 covers any real one.
    for (let guard = 0; guard < 400; guard += 1) {
      if (this.isBusinessDay(cursor)) return cursor;
      cursor = addDays(cursor, 1);
    }
    throw new ValidationError(`Calendar ${this.code} has no business day within a year of ${date}`);
  }

  previousBusinessDay(date: IsoDate): IsoDate {
    let cursor = date;
    for (let guard = 0; guard < 400; guard += 1) {
      if (this.isBusinessDay(cursor)) return cursor;
      cursor = addDays(cursor, -1);
    }
    throw new ValidationError(`Calendar ${this.code} has no business day within a year of ${date}`);
  }

  /** Moves `count` business days forward (or backward when negative). */
  addBusinessDays(date: IsoDate, count: number): IsoDate {
    const step = count < 0 ? -1 : 1;
    let remaining = Math.abs(count);
    let cursor = date;
    while (remaining > 0) {
      cursor = addDays(cursor, step);
      if (this.isBusinessDay(cursor)) remaining -= 1;
    }
    return cursor;
  }

  /**
   * Applies a rolling convention. `modified_following` rolls forward unless
   * that would cross into the next month, in which case it rolls back — the
   * convention finance uses so a due date never slips into the next period.
   */
  adjust(date: IsoDate, rule: BusinessDayRule): IsoDate {
    switch (rule) {
      case "next_business_day":
        return this.nextBusinessDay(date);
      case "previous_business_day":
        return this.previousBusinessDay(date);
      case "modified_following": {
        const forward = this.nextBusinessDay(date);
        return String(forward).slice(0, 7) === String(date).slice(0, 7)
          ? forward
          : this.previousBusinessDay(date);
      }
      case "none":
      default:
        return date;
    }
  }
}
