import {
  money,
  newId,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { addMonths, fiscalPeriod, isBefore, parseIso } from "./dates.js";
import { ValidationError } from "./errors.js";
import { requireNonNegative, sum } from "./money.js";

/**
 * Partner performance snapshots.
 *
 * PRM does not own bookings — sales-erp and channel-prm do. What PRM keeps is
 * a per-period snapshot of the numbers the channel program is scored on, fed
 * in through an integration event or a periodic job. Tier evaluation reads a
 * trailing window of these snapshots, which makes tiering reproducible: the
 * same window and the same snapshots always produce the same tier.
 */

export type PerformanceSource = "sales_erp" | "channel_prm" | "manual" | "import";

export const PERFORMANCE_SOURCES: readonly PerformanceSource[] = [
  "sales_erp",
  "channel_prm",
  "manual",
  "import",
];

export interface PerformanceSnapshot {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly partnerId: Ulid;
  readonly period: string;
  readonly periodStart: IsoDateTime;
  readonly periodEnd: IsoDateTime;
  readonly bookedRevenue: Money;
  readonly dealsRegistered: number;
  readonly dealsWon: number;
  readonly newLogos: number;
  readonly source: PerformanceSource;
  readonly recordedAt: IsoDateTime;
}

export interface RecordPerformanceInput {
  readonly partnerId: Ulid;
  readonly period: string;
  readonly fiscalYearStartMonth?: number;
  readonly bookedRevenue: Money;
  readonly dealsRegistered?: number;
  readonly dealsWon?: number;
  readonly newLogos?: number;
  readonly source?: PerformanceSource;
  readonly at: IsoDateTime;
}

function nonNegativeInt(value: number | undefined, field: string): number {
  const resolved = value ?? 0;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw ValidationError.single(field, "must be a non-negative integer");
  }
  return resolved;
}

export function recordPerformanceSnapshot(
  tenantId: TenantId,
  input: RecordPerformanceInput,
): PerformanceSnapshot {
  const period = fiscalPeriod(input.period, input.fiscalYearStartMonth ?? 1);
  requireNonNegative(input.bookedRevenue, "bookedRevenue");
  const dealsRegistered = nonNegativeInt(input.dealsRegistered, "dealsRegistered");
  const dealsWon = nonNegativeInt(input.dealsWon, "dealsWon");
  if (dealsWon > dealsRegistered) {
    throw ValidationError.single("dealsWon", "cannot exceed dealsRegistered");
  }
  const source = input.source ?? "manual";
  if (!PERFORMANCE_SOURCES.includes(source)) {
    throw ValidationError.single("source", `must be one of [${PERFORMANCE_SOURCES.join(", ")}]`);
  }
  return {
    id: newId("perf"),
    tenantId,
    partnerId: input.partnerId,
    period: period.code,
    periodStart: period.start,
    periodEnd: period.end,
    bookedRevenue: input.bookedRevenue,
    dealsRegistered,
    dealsWon,
    newLogos: nonNegativeInt(input.newLogos, "newLogos"),
    source,
    recordedAt: parseIso(input.at, "at"),
  };
}

export interface TrailingPerformance {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly periods: readonly string[];
  readonly bookedRevenue: Money;
  readonly dealsRegistered: number;
  readonly dealsWon: number;
  readonly newLogos: number;
  readonly winRate: number;
}

/**
 * Aggregates the snapshots whose period *starts* inside the trailing window
 * ending at `at`. Periods are the unit of account: a quarter either counts in
 * full or not at all, which keeps the number stable within a quarter instead
 * of drifting daily.
 */
export function trailingPerformance(
  snapshots: readonly PerformanceSnapshot[],
  at: IsoDateTime,
  currency: string,
  months = 12,
): TrailingPerformance {
  const from = addMonths(at, -months);
  const inWindow = snapshots
    .filter((s) => !isBefore(s.periodStart, from) && isBefore(s.periodStart, at))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const normalizedCurrency = currency.toUpperCase();
  const revenue = inWindow.length
    ? sum(
        inWindow.map((s) => s.bookedRevenue),
        normalizedCurrency,
      )
    : money(0, normalizedCurrency);
  const dealsRegistered = inWindow.reduce((total, s) => total + s.dealsRegistered, 0);
  const dealsWon = inWindow.reduce((total, s) => total + s.dealsWon, 0);
  return {
    from,
    to: at,
    periods: inWindow.map((s) => s.period),
    bookedRevenue: revenue,
    dealsRegistered,
    dealsWon,
    newLogos: inWindow.reduce((total, s) => total + s.newLogos, 0),
    winRate: dealsRegistered === 0 ? 0 : Math.round((dealsWon / dealsRegistered) * 100) / 100,
  };
}
