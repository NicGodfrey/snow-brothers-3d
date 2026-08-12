import type { Money } from "@enterprise-suite/shared-kernel";
import type { KpiDescriptor, ModuleKey } from "./module.js";

/**
 * KPI values as they travel from a module client to a dashboard tile.
 *
 * Money keeps integer minor units all the way to the view; formatting happens
 * once, here, so a tile and a module header never disagree on rounding.
 */

export type KpiValue =
  | { readonly kind: "count"; readonly value: number }
  | { readonly kind: "money"; readonly value: Money }
  | { readonly kind: "percent"; readonly value: number }
  | { readonly kind: "days"; readonly value: number };

export interface Kpi {
  readonly key: string;
  readonly label: string;
  readonly value: KpiValue;
  /** Change versus the comparison window, as a ratio (0.12 = +12%). */
  readonly delta?: number;
  readonly polarity: KpiDescriptor["polarity"];
}

export type TileStatus = "ok" | "degraded" | "forbidden";

export interface DashboardTile {
  readonly module: ModuleKey;
  readonly label: string;
  readonly mark: string;
  readonly accent: string;
  readonly path: string;
  readonly status: TileStatus;
  readonly kpis: readonly Kpi[];
  /** Set when `status` is not `ok`; safe to show to the user. */
  readonly message?: string;
  readonly latencyMs?: number;
}

export interface Dashboard {
  readonly generatedAt: string;
  readonly tenantId: string;
  readonly tiles: readonly DashboardTile[];
  readonly degradedModules: readonly ModuleKey[];
  /** Count metrics from every module, keyed for `NavItem.countKey`. */
  readonly counts: Readonly<Record<string, number>>;
}

const MINOR_UNITS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
};

export function minorUnitDigits(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

export function formatMoney(value: Money, locale = "en-US"): string {
  const digits = minorUnitDigits(value.currency);
  const major = value.amountMinor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}

export function formatKpi(value: KpiValue, locale = "en-US"): string {
  switch (value.kind) {
    case "count":
      return new Intl.NumberFormat(locale).format(value.value);
    case "money":
      return formatMoney(value.value, locale);
    case "percent":
      return `${(value.value * 100).toFixed(1)}%`;
    case "days":
      return `${value.value.toFixed(1)} d`;
  }
}

export function formatDelta(delta: number | undefined, locale = "en-US"): string | undefined {
  if (delta === undefined) return undefined;
  const formatted = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(delta);
  return formatted;
}

/** Whether a delta should read as good, bad or neutral for this KPI. */
export function deltaSentiment(kpi: Kpi): "positive" | "negative" | "neutral" {
  if (kpi.delta === undefined || kpi.delta === 0 || kpi.polarity === "neutral") return "neutral";
  const improving = kpi.polarity === "up-good" ? kpi.delta > 0 : kpi.delta < 0;
  return improving ? "positive" : "negative";
}
