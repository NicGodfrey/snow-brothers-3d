import { brand, DomainError } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "./types.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isoDate(value: string): IsoDate {
  if (!ISO_DATE_RE.test(value)) {
    throw new DomainError(`Invalid ISO date: ${value}`, "VALIDATION");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError(`Invalid ISO date: ${value}`, "VALIDATION");
  }
  return brand<string, "IsoDate">(value);
}

export function toUtcDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromUtcDate(date: Date): IsoDate {
  return brand<string, "IsoDate">(date.toISOString().slice(0, 10));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** Whole days from `a` to `b`; positive when `b` is after `a`. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / MS_PER_DAY);
}

/** Monday of the ISO week containing `date`. */
export function startOfIsoWeek(date: IsoDate): IsoDate {
  const d = toUtcDate(date);
  const dayOfWeek = d.getUTCDay(); // 0 = Sunday
  const back = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDays(date, -back);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareDates(a, b) >= 0 ? a : b;
}

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

export function makeWeeklyCalendar(anchor: IsoDate, weekCount: number): PlanningCalendar {
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 104) {
    throw new DomainError("Planning horizon must be between 1 and 104 weeks", "VALIDATION");
  }
  const start = startOfIsoWeek(anchor);
  const weekStarts: IsoDate[] = [];
  for (let i = 0; i < weekCount; i += 1) {
    weekStarts.push(addDays(start, i * 7));
  }
  return { start, end: addDays(start, weekCount * 7), weekCount, weekStarts };
}

/**
 * Bucket index for a date: -1 before the horizon, `weekCount` at or beyond
 * its end. Callers decide how to treat out-of-horizon values.
 */
export function bucketIndexOf(calendar: PlanningCalendar, date: IsoDate): number {
  const days = diffDays(calendar.start, date);
  if (days < 0) return -1;
  const index = Math.floor(days / 7);
  return index >= calendar.weekCount ? calendar.weekCount : index;
}

/** Bucket index clamped into the horizon (past-due collapses into bucket 0). */
export function clampedBucketIndexOf(calendar: PlanningCalendar, date: IsoDate): number {
  const raw = bucketIndexOf(calendar, date);
  if (raw < 0) return 0;
  return Math.min(raw, calendar.weekCount - 1);
}

/** Sums dated quantities into an index-aligned array of bucket totals. */
export function bucketize(
  calendar: PlanningCalendar,
  entries: readonly { date: IsoDate; qty: number }[],
  options?: { includePastDueInFirstBucket?: boolean },
): number[] {
  const totals = new Array<number>(calendar.weekCount).fill(0);
  for (const entry of entries) {
    const raw = bucketIndexOf(calendar, entry.date);
    if (raw >= calendar.weekCount) continue; // beyond horizon: ignore
    if (raw < 0 && !options?.includePastDueInFirstBucket) continue;
    const index = Math.max(0, raw);
    totals[index] += entry.qty;
  }
  return totals;
}
