/**
 * Time bucketing for the date dimension.
 *
 * Every fact carries an `occurredAt` instant; queries roll those instants up
 * into periods at a requested grain. All arithmetic is UTC — the warehouse
 * stores instants, and tenant-local presentation is a display concern.
 *
 * Period keys are sortable strings, which is what makes them usable as group
 * keys and as ORDER BY values without a separate sort key:
 *
 *   hour     2026-08-12T14
 *   day      2026-08-12
 *   week     2026-W33          (ISO-8601 week, Monday start)
 *   month    2026-08
 *   quarter  2026-Q3
 *   year     2026
 *
 * Week keys sort correctly within a year but a week can straddle a year
 * boundary; `periodStart` always returns the true Monday instant, so range
 * math stays exact even when the key's year differs from the calendar year.
 */
import { brand, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { QueryError } from "./errors.js";

export type TimeGrain = "hour" | "day" | "week" | "month" | "quarter" | "year";

export const TIME_GRAINS: readonly TimeGrain[] = ["hour", "day", "week", "month", "quarter", "year"];

/** Half-open interval [from, toExclusive) — the only interval kind we use. */
export interface TimeRange {
  readonly from: IsoDateTime;
  readonly toExclusive: IsoDateTime;
}

export function isTimeGrain(value: string): value is TimeGrain {
  return (TIME_GRAINS as readonly string[]).includes(value);
}

export function iso(date: Date): IsoDateTime {
  return brand<string, "IsoDateTime">(date.toISOString());
}

/** Parses an instant, accepting date-only strings as UTC midnight. */
export function parseInstant(value: string, field = "instant"): IsoDateTime {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new QueryError(`${field} is not a valid ISO-8601 instant: ${value}`);
  }
  return iso(parsed);
}

export function timeRange(from: string, toExclusive: string): TimeRange {
  const start = parseInstant(from, "from");
  const end = parseInstant(toExclusive, "to");
  if (end <= start) {
    throw new QueryError(`time range end (${end}) must be after start (${start})`);
  }
  return { from: start, toExclusive: end };
}

export function inRange(instant: IsoDateTime, range: TimeRange): boolean {
  return instant >= range.from && instant < range.toExclusive;
}

// ---------------------------------------------------------------------------
// ISO week
// ---------------------------------------------------------------------------

/**
 * ISO-8601 week number and week-numbering year. Week 1 is the week holding
 * the first Thursday of the year, which is why the returned year can differ
 * from the calendar year for the first/last days of a year.
 */
export function isoWeek(date: Date): { readonly year: number; readonly week: number } {
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Shift to the Thursday of the current ISO week (Sunday counts as day 7).
  const dayOfWeek = thursday.getUTCDay() === 0 ? 7 : thursday.getUTCDay();
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayOfWeek);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
  return { year, week };
}

/** Monday 00:00:00Z of the ISO week containing `date`. */
function isoWeekStart(date: Date): Date {
  const dayOfWeek = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (dayOfWeek - 1)),
  );
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/** Truncates an instant down to the start of its bucket at `grain`. */
export function bucketStart(instant: IsoDateTime, grain: TimeGrain): IsoDateTime {
  const d = new Date(instant);
  switch (grain) {
    case "hour":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())));
    case "day":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
    case "week":
      return iso(isoWeekStart(d));
    case "month":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    case "quarter":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
    case "year":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
  }
}

/** The sortable group key for the bucket containing `instant`. */
export function periodKey(instant: IsoDateTime, grain: TimeGrain): string {
  const d = new Date(instant);
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  switch (grain) {
    case "hour":
      return `${yyyy}-${mm}-${dd}T${String(d.getUTCHours()).padStart(2, "0")}`;
    case "day":
      return `${yyyy}-${mm}-${dd}`;
    case "week": {
      const { year, week } = isoWeek(d);
      return `${String(year).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
    }
    case "month":
      return `${yyyy}-${mm}`;
    case "quarter":
      return `${yyyy}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case "year":
      return yyyy;
  }
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Human-facing label for a period key, e.g. "Aug 2026", "W33 2026". */
export function periodLabel(key: string, grain: TimeGrain): string {
  switch (grain) {
    case "hour": {
      const [date, hour] = key.split("T");
      return `${date} ${hour}:00 UTC`;
    }
    case "day":
      return key;
    case "week": {
      const [year, week] = key.split("-W");
      return `W${week} ${year}`;
    }
    case "month": {
      const [year, month] = key.split("-");
      return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
    }
    case "quarter": {
      const [year, quarter] = key.split("-");
      return `${quarter} ${year}`;
    }
    case "year":
      return key;
  }
}

/** Inverse of {@link periodKey}: the instant a period key starts at. */
export function periodStart(key: string, grain: TimeGrain): IsoDateTime {
  switch (grain) {
    case "hour":
      return parseInstant(`${key}:00:00.000Z`, "period");
    case "day":
      return parseInstant(key, "period");
    case "week": {
      const [yearPart, weekPart] = key.split("-W");
      const year = Number(yearPart);
      const week = Number(weekPart);
      if (!Number.isInteger(year) || !Number.isInteger(week)) {
        throw new QueryError(`invalid week period key: ${key}`);
      }
      // Jan 4th is always in ISO week 1.
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const week1Monday = isoWeekStart(jan4);
      return iso(new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000));
    }
    case "month":
      return parseInstant(`${key}-01`, "period");
    case "quarter": {
      const [yearPart, quarterPart] = key.split("-Q");
      const month = (Number(quarterPart) - 1) * 3;
      if (!Number.isInteger(month) || month < 0 || month > 9) {
        throw new QueryError(`invalid quarter period key: ${key}`);
      }
      return iso(new Date(Date.UTC(Number(yearPart), month, 1)));
    }
    case "year":
      return parseInstant(`${key}-01-01`, "period");
  }
}

// ---------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------

/** Adds `count` grain units to an instant (calendar-aware, day-clamped). */
export function addPeriods(instant: IsoDateTime, grain: TimeGrain, count: number): IsoDateTime {
  const d = new Date(instant);
  switch (grain) {
    case "hour":
      return iso(new Date(d.getTime() + count * 3_600_000));
    case "day":
      return iso(new Date(d.getTime() + count * 86_400_000));
    case "week":
      return iso(new Date(d.getTime() + count * 7 * 86_400_000));
    case "month":
      return iso(addMonths(d, count));
    case "quarter":
      return iso(addMonths(d, count * 3));
    case "year":
      return iso(addMonths(d, count * 12));
  }
}

/** Month arithmetic that clamps to the last valid day (Jan 31 + 1m = Feb 28). */
function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), daysInTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Whole grain units spanned by a range (rounded up, minimum 1). */
export function countPeriods(range: TimeRange, grain: TimeGrain): number {
  const from = new Date(range.from);
  const to = new Date(range.toExclusive);
  switch (grain) {
    case "hour":
      return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 3_600_000));
    case "day":
      return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
    case "week":
      return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (7 * 86_400_000)));
    case "month":
    case "quarter":
    case "year": {
      const months =
        (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
      const divisor = grain === "month" ? 1 : grain === "quarter" ? 3 : 12;
      return Math.max(1, Math.ceil(months / divisor));
    }
  }
}

export type ComparisonMode = "previous-period" | "previous-year";

/**
 * The comparison window for a range: either the immediately preceding window
 * of the same length (in grain units) or the same window one year earlier.
 */
export function comparisonRange(range: TimeRange, grain: TimeGrain, mode: ComparisonMode): TimeRange {
  if (mode === "previous-year") {
    return {
      from: addPeriods(range.from, "year", -1),
      toExclusive: addPeriods(range.toExclusive, "year", -1),
    };
  }
  const units = countPeriods(range, grain);
  return {
    from: addPeriods(range.from, grain, -units),
    toExclusive: addPeriods(range.toExclusive, grain, -units),
  };
}

/**
 * Every period key in a range, including empty ones. Dense series matter for
 * charts: a gap-free x-axis is the difference between "no orders on Tuesday"
 * and "Tuesday is missing".
 */
export function enumeratePeriods(range: TimeRange, grain: TimeGrain, limit = 1000): string[] {
  const keys: string[] = [];
  let cursor = bucketStart(range.from, grain);
  while (cursor < range.toExclusive) {
    keys.push(periodKey(cursor, grain));
    cursor = addPeriods(cursor, grain, 1);
    if (keys.length >= limit) break;
  }
  return keys;
}

/** Trailing window ending at (and including) the bucket holding `anchor`. */
export function trailingRange(anchor: IsoDateTime, grain: TimeGrain, periods: number): TimeRange {
  if (!Number.isInteger(periods) || periods < 1) {
    throw new QueryError(`trailing window must be a positive integer, got ${periods}`);
  }
  const currentStart = bucketStart(anchor, grain);
  return {
    from: addPeriods(currentStart, grain, -(periods - 1)),
    toExclusive: addPeriods(currentStart, grain, 1),
  };
}
