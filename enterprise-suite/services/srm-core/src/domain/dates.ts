import type { Brand, IsoDateTime } from "@enterprise-suite/shared-kernel";
import { ValidationError } from "./errors.js";

/**
 * Calendar-day arithmetic.
 *
 * Certification expiry, contract effectivity, audit validity and CAPA due
 * dates are *calendar* facts: "expires 2026-03-31" means the whole day, in
 * every timezone the supplier operates in. Storing them as instants invites
 * off-by-one-day bugs, so SRM keeps a separate `DateOnly` brand (`YYYY-MM-DD`)
 * and does all arithmetic in UTC midnight.
 */

export type DateOnly = Brand<string, "DateOnly">;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  // Rejects 2026-02-30 and friends, which Date happily rolls over.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dateOnly(value: string, field = "date"): DateOnly {
  if (!isDateOnly(value)) {
    throw ValidationError.single(field, `must be a calendar date (YYYY-MM-DD), got "${value}"`);
  }
  return value as DateOnly;
}

/** Calendar day of an instant, in UTC. */
export function toDateOnly(instant: IsoDateTime | string): DateOnly {
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) throw ValidationError.single("instant", `invalid timestamp "${instant}"`);
  return new Date(parsed).toISOString().slice(0, 10) as DateOnly;
}

/** Start-of-day instant, used when a domain event needs a timestamp. */
export function startOfDay(date: DateOnly): IsoDateTime {
  return `${date}T00:00:00.000Z` as IsoDateTime;
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10) as DateOnly;
}

export function addMonths(date: DateOnly, months: number): DateOnly {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months;
  const year = y + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  // Clamp so that "2026-01-31 + 1 month" lands on 2026-02-28, not 2026-03-03.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10) as DateOnly;
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

export function compareDates(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: DateOnly, b: DateOnly): DateOnly {
  return a >= b ? a : b;
}

export function minDate(a: DateOnly, b: DateOnly): DateOnly {
  return a <= b ? a : b;
}

export interface DateWindow {
  readonly from: DateOnly;
  /** Inclusive end; `undefined` means open-ended. */
  readonly to?: DateOnly;
}

export function windowContains(window: DateWindow, date: DateOnly): boolean {
  if (compareDates(date, window.from) < 0) return false;
  return window.to === undefined || compareDates(date, window.to) <= 0;
}

/** Inclusive overlap test; open-ended windows extend to infinity. */
export function windowsOverlap(a: DateWindow, b: DateWindow): boolean {
  const aEndsBeforeB = a.to !== undefined && compareDates(a.to, b.from) < 0;
  const bEndsBeforeA = b.to !== undefined && compareDates(b.to, a.from) < 0;
  return !aEndsBeforeB && !bEndsBeforeA;
}

export function assertWindow(window: DateWindow, field = "window"): void {
  if (window.to !== undefined && compareDates(window.to, window.from) < 0) {
    throw ValidationError.single(field, `end date ${window.to} precedes start date ${window.from}`);
  }
}
