import { addDays, addMonths, compareDates, dateOnly, type DateOnly } from "./dates.js";
import { ValidationError } from "./errors.js";

/**
 * Performance periods.
 *
 * Scorecards, SLA measurement windows and spend rollups all need the same
 * notion of "the quarter we are rating", including the ability to walk
 * backwards for a trend. Periods are identified by a sortable code —
 * `2026-03` (month), `2026-Q1` (quarter), `2026` (year) — so a lexical sort is
 * a chronological sort inside a kind.
 */

export type PeriodKind = "month" | "quarter" | "year";

export const PERIOD_KINDS: readonly PeriodKind[] = ["month", "quarter", "year"];

export interface PerformancePeriod {
  readonly kind: PeriodKind;
  readonly code: string;
  readonly year: number;
  /** 1-12 for months, 1-4 for quarters, 1 for years. */
  readonly index: number;
  readonly start: DateOnly;
  readonly end: DateOnly;
}

function monthPeriod(year: number, month: number): PerformancePeriod {
  const start = dateOnly(`${year}-${String(month).padStart(2, "0")}-01`);
  return {
    kind: "month",
    code: `${year}-${String(month).padStart(2, "0")}`,
    year,
    index: month,
    start,
    end: addDays(addMonths(start, 1), -1),
  };
}

function quarterPeriod(year: number, quarter: number): PerformancePeriod {
  const startMonth = (quarter - 1) * 3 + 1;
  const start = dateOnly(`${year}-${String(startMonth).padStart(2, "0")}-01`);
  return {
    kind: "quarter",
    code: `${year}-Q${quarter}`,
    year,
    index: quarter,
    start,
    end: addDays(addMonths(start, 3), -1),
  };
}

function yearPeriod(year: number): PerformancePeriod {
  const start = dateOnly(`${year}-01-01`);
  return {
    kind: "year",
    code: String(year),
    year,
    index: 1,
    start,
    end: dateOnly(`${year}-12-31`),
  };
}

export function makePeriod(kind: PeriodKind, year: number, index: number): PerformancePeriod {
  if (!Number.isInteger(year) || year < 1970 || year > 2200) {
    throw ValidationError.single("year", "must be a plausible calendar year");
  }
  switch (kind) {
    case "month":
      if (index < 1 || index > 12) throw ValidationError.single("index", "month must be 1-12");
      return monthPeriod(year, index);
    case "quarter":
      if (index < 1 || index > 4) throw ValidationError.single("index", "quarter must be 1-4");
      return quarterPeriod(year, index);
    case "year":
      return yearPeriod(year);
  }
}

/** Parses `2026-03`, `2026-Q1` or `2026`. */
export function parsePeriod(code: string): PerformancePeriod {
  const normalized = code.trim().toUpperCase();
  const quarter = /^(\d{4})-Q([1-4])$/.exec(normalized);
  if (quarter) return quarterPeriod(Number(quarter[1]), Number(quarter[2]));
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(normalized);
  if (month) return monthPeriod(Number(month[1]), Number(month[2]));
  const year = /^(\d{4})$/.exec(normalized);
  if (year) return yearPeriod(Number(year[1]));
  throw ValidationError.single("period", `unrecognised period code "${code}" (expected 2026-03, 2026-Q1 or 2026)`);
}

export function periodContaining(date: DateOnly, kind: PeriodKind): PerformancePeriod {
  const [year, month] = date.split("-").map(Number) as [number, number];
  switch (kind) {
    case "month":
      return monthPeriod(year, month);
    case "quarter":
      return quarterPeriod(year, Math.floor((month - 1) / 3) + 1);
    case "year":
      return yearPeriod(year);
  }
}

export function nextPeriod(period: PerformancePeriod): PerformancePeriod {
  switch (period.kind) {
    case "month":
      return period.index === 12 ? monthPeriod(period.year + 1, 1) : monthPeriod(period.year, period.index + 1);
    case "quarter":
      return period.index === 4 ? quarterPeriod(period.year + 1, 1) : quarterPeriod(period.year, period.index + 1);
    case "year":
      return yearPeriod(period.year + 1);
  }
}

export function previousPeriod(period: PerformancePeriod): PerformancePeriod {
  switch (period.kind) {
    case "month":
      return period.index === 1 ? monthPeriod(period.year - 1, 12) : monthPeriod(period.year, period.index - 1);
    case "quarter":
      return period.index === 1 ? quarterPeriod(period.year - 1, 4) : quarterPeriod(period.year, period.index - 1);
    case "year":
      return yearPeriod(period.year - 1);
  }
}

export function comparePeriods(a: PerformancePeriod, b: PerformancePeriod): number {
  if (a.kind !== b.kind) {
    throw ValidationError.single("period", `cannot compare a ${a.kind} period with a ${b.kind} period`);
  }
  return a.year - b.year || a.index - b.index;
}

/** Inclusive series of periods, oldest first. */
export function periodSeries(from: PerformancePeriod, to: PerformancePeriod): PerformancePeriod[] {
  if (comparePeriods(from, to) > 0) {
    throw ValidationError.single("period", `${from.code} is after ${to.code}`);
  }
  const series: PerformancePeriod[] = [];
  let cursor = from;
  // Guard against a pathological range rather than looping forever.
  for (let i = 0; i < 400 && comparePeriods(cursor, to) <= 0; i += 1) {
    series.push(cursor);
    cursor = nextPeriod(cursor);
  }
  return series;
}

/** The last `count` periods ending at (and including) `period`. */
export function trailingPeriods(period: PerformancePeriod, count: number): PerformancePeriod[] {
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw ValidationError.single("count", "must be an integer between 1 and 60");
  }
  const periods: PerformancePeriod[] = [period];
  let cursor = period;
  for (let i = 1; i < count; i += 1) {
    cursor = previousPeriod(cursor);
    periods.unshift(cursor);
  }
  return periods;
}

export function periodIsClosed(period: PerformancePeriod, asOf: DateOnly): boolean {
  return compareDates(asOf, period.end) > 0;
}
