import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import { ValidationError } from "./errors.js";

/**
 * Date arithmetic used across the context: contract terms and renewals,
 * certification validity and renewal windows, MDF fiscal periods and claim
 * deadlines. Everything is ISO-8601 UTC; there is no local-time notion in the
 * partner domain because programs are defined per fiscal calendar, not per
 * office.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseIso(value: string, field = "date"): IsoDateTime {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw ValidationError.single(field, "must be an ISO-8601 date-time");
  }
  return new Date(parsed).toISOString() as IsoDateTime;
}

export function toEpoch(value: IsoDateTime | string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw ValidationError.single("date", "must be an ISO-8601 date-time");
  return parsed;
}

export function isBefore(a: IsoDateTime | string, b: IsoDateTime | string): boolean {
  return toEpoch(a) < toEpoch(b);
}

export function isAfter(a: IsoDateTime | string, b: IsoDateTime | string): boolean {
  return toEpoch(a) > toEpoch(b);
}

export function addDays(value: IsoDateTime | string, days: number): IsoDateTime {
  return new Date(toEpoch(value) + days * DAY_MS).toISOString() as IsoDateTime;
}

/**
 * Calendar-month addition that clamps overflow (Jan 31 + 1 month = Feb 28/29),
 * which is what contract terms and certification validity expect.
 */
export function addMonths(value: IsoDateTime | string, months: number): IsoDateTime {
  const date = new Date(toEpoch(value));
  const day = date.getUTCDate();
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTargetMonth));
  return target.toISOString() as IsoDateTime;
}

export function daysBetween(from: IsoDateTime | string, to: IsoDateTime | string): number {
  return Math.round((toEpoch(to) - toEpoch(from)) / DAY_MS);
}

export function monthsBetween(from: IsoDateTime | string, to: IsoDateTime | string): number {
  const a = new Date(toEpoch(from));
  const b = new Date(toEpoch(to));
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

export interface DateRange {
  readonly from: IsoDateTime;
  readonly to?: IsoDateTime;
}

/** Half-open window: `from` inclusive, `to` exclusive; open-ended when `to` is absent. */
export function withinRange(range: DateRange, at: IsoDateTime | string): boolean {
  const instant = toEpoch(at);
  if (instant < toEpoch(range.from)) return false;
  return range.to === undefined || instant < toEpoch(range.to);
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  const aFrom = toEpoch(a.from);
  const aTo = a.to === undefined ? Number.POSITIVE_INFINITY : toEpoch(a.to);
  const bFrom = toEpoch(b.from);
  const bTo = b.to === undefined ? Number.POSITIVE_INFINITY : toEpoch(b.to);
  return aFrom < bTo && bFrom < aTo;
}

export function assertOrderedRange(from: IsoDateTime, to: IsoDateTime | undefined, field: string): void {
  if (to !== undefined && toEpoch(to) <= toEpoch(from)) {
    throw ValidationError.single(field, "end must be after start");
  }
}

/**
 * Fiscal period label, e.g. `FY26-Q1`. Programs are budgeted per period and a
 * partner's MDF accrual is computed against the period's revenue.
 */
export interface FiscalPeriod {
  readonly code: string;
  readonly fiscalYear: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
}

const PERIOD_PATTERN = /^FY(\d{2})-Q([1-4])$/;

/**
 * Builds a fiscal period from its label. `fiscalYearStartMonth` is 1-based
 * (1 = calendar year, 2 = February start, ...), so a February-start FY26 Q1
 * runs 2025-02-01 → 2025-05-01.
 */
export function fiscalPeriod(code: string, fiscalYearStartMonth = 1): FiscalPeriod {
  const match = PERIOD_PATTERN.exec(code.trim().toUpperCase());
  if (!match) {
    throw ValidationError.single("period", 'must look like "FY26-Q3"');
  }
  if (!Number.isInteger(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) {
    throw ValidationError.single("fiscalYearStartMonth", "must be an integer between 1 and 12");
  }
  const fiscalYear = 2000 + Number(match[1]);
  const quarter = Number(match[2]) as 1 | 2 | 3 | 4;
  // A fiscal year that does not start in January is named after the calendar
  // year it ends in, which is the convention most channel programs use.
  const startCalendarYear = fiscalYearStartMonth === 1 ? fiscalYear : fiscalYear - 1;
  const start = new Date(
    Date.UTC(startCalendarYear, fiscalYearStartMonth - 1 + (quarter - 1) * 3, 1),
  ).toISOString() as IsoDateTime;
  const end = addMonths(start, 3);
  return { code: code.trim().toUpperCase(), fiscalYear, quarter, start, end };
}

export function periodContains(period: FiscalPeriod, at: IsoDateTime | string): boolean {
  return withinRange({ from: period.start, to: period.end }, at);
}
