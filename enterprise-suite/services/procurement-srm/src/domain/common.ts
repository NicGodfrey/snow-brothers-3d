import {
  brand,
  money,
  type Brand,
  type Money,
} from "@enterprise-suite/shared-kernel";
import { ValidationError } from "./errors.js";

// ---------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------

/** Calendar date without time component, always `YYYY-MM-DD`. */
export type IsoDate = Brand<string, "IsoDate">;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(value: string): IsoDate {
  if (!ISO_DATE_RE.test(value)) {
    throw ValidationError.single("date", `must be formatted YYYY-MM-DD, got "${value}"`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw ValidationError.single("date", `is not a real calendar date: "${value}"`);
  }
  return brand<string, "IsoDate">(value);
}

/** ISO dates sort correctly as plain strings, which keeps comparisons cheap. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return brand<string, "IsoDate">(d.toISOString().slice(0, 10));
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  const total = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return isoDate(
    `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

/** Signed whole days from `from` to `to` (negative when `to` precedes `from`). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

export function isWithin(date: IsoDate, from: IsoDate, to?: IsoDate): boolean {
  if (date < from) return false;
  return to === undefined || date <= to;
}

export function assertDateOrder(earlier: IsoDate, later: IsoDate, what: string): void {
  if (later < earlier) {
    throw ValidationError.single(what, `end date ${later} precedes start date ${earlier}`);
  }
}

// ---------------------------------------------------------------------------
// Quantities and units of measure
// ---------------------------------------------------------------------------

/**
 * Quantities are decimal (0.5 tonnes, 2.25 hours), so they are stored as
 * numbers rounded to `QTY_SCALE` decimals and always compared with
 * `QTY_EPSILON` to keep binary floating point out of the business rules.
 */
export type Quantity = Brand<number, "Quantity">;

export const QTY_SCALE = 6;
export const QTY_EPSILON = 1e-6;

export function quantity(value: number): Quantity {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw ValidationError.single("quantity", `must be a finite number, got ${String(value)}`);
  }
  if (value < 0) {
    throw ValidationError.single("quantity", `must not be negative, got ${value}`);
  }
  const rounded = Math.round(value * 10 ** QTY_SCALE) / 10 ** QTY_SCALE;
  return brand<number, "Quantity">(rounded);
}

export function positiveQuantity(value: number, field = "quantity"): Quantity {
  const qty = quantity(value);
  if (qty <= QTY_EPSILON) {
    throw ValidationError.single(field, `must be greater than zero, got ${value}`);
  }
  return qty;
}

export const ZERO_QTY: Quantity = brand<number, "Quantity">(0);

export function addQty(a: Quantity, b: Quantity): Quantity {
  return quantity(a + b);
}

export function subQty(a: Quantity, b: Quantity): Quantity {
  return quantity(Math.max(0, a - b));
}

export function qtyEquals(a: Quantity, b: Quantity): boolean {
  return Math.abs(a - b) < QTY_EPSILON;
}

export function qtyGreater(a: Quantity, b: Quantity): boolean {
  return a - b > QTY_EPSILON;
}

export function qtyAtLeast(a: Quantity, b: Quantity): boolean {
  return a - b > -QTY_EPSILON;
}

export function sumQty(values: readonly Quantity[]): Quantity {
  return quantity(values.reduce((total, value) => total + value, 0));
}

/** Unit of measure code, e.g. `EA`, `KG`, `BOX`, `HR`. */
export type UomCode = Brand<string, "UomCode">;

const UOM_RE = /^[A-Z0-9]{1,8}$/;

export function uom(value: string): UomCode {
  const normalized = value.trim().toUpperCase();
  if (!UOM_RE.test(normalized)) {
    throw ValidationError.single("uom", `must be 1-8 alphanumeric characters, got "${value}"`);
  }
  return brand<string, "UomCode">(normalized);
}

// ---------------------------------------------------------------------------
// Rates expressed in basis points
// ---------------------------------------------------------------------------

/**
 * Basis points (1 bp = 0.01%). Used for tax rates, discounts, tolerances and
 * evaluation weights so that no percentage ever becomes a lossy float.
 */
export type Bps = Brand<number, "Bps">;

export const BPS_ONE = 10_000;

export function bps(value: number, field = "rate"): Bps {
  if (!Number.isInteger(value)) {
    throw ValidationError.single(field, `must be an integer number of basis points, got ${value}`);
  }
  if (value < 0 || value > 1_000_000) {
    throw ValidationError.single(field, `must be within [0, 1000000] basis points, got ${value}`);
  }
  return brand<number, "Bps">(value);
}

export const ZERO_BPS: Bps = brand<number, "Bps">(0);

export function bpsToPercent(value: Bps): number {
  return Math.round(value) / 100;
}

/** Applies a basis-point rate to a money amount, rounding half away from zero. */
export function applyBps(amount: Money, rate: Bps): Money {
  return money(roundHalfAway((amount.amountMinor * rate) / BPS_ONE), amount.currency);
}

/**
 * Relative difference of `actual` against `baseline`, in basis points.
 * A zero baseline yields 0 when actual is also zero, otherwise the maximum
 * rate so callers treat "something priced against nothing" as a full variance.
 */
export function varianceBps(actual: number, baseline: number): number {
  if (baseline === 0) return actual === 0 ? 0 : 1_000_000;
  return Math.round(((actual - baseline) / Math.abs(baseline)) * BPS_ONE);
}

// ---------------------------------------------------------------------------
// Money helpers layered on the shared kernel
// ---------------------------------------------------------------------------

export function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function zeroMoney(currency: string): Money {
  return money(0, currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negateMoney(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

export function absMoney(a: Money): Money {
  return money(Math.abs(a.amountMinor), a.currency);
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor - b.amountMinor;
}

export function isZeroMoney(a: Money): boolean {
  return a.amountMinor === 0;
}

export function sumMoney(values: readonly Money[], currency: string): Money {
  return values.reduce((total, value) => {
    assertSameCurrency(total, value);
    return money(total.amountMinor + value.amountMinor, total.currency);
  }, zeroMoney(currency));
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw ValidationError.single(
      "currency",
      `currency mismatch: ${a.currency} vs ${b.currency}`,
    );
  }
}

/**
 * Extended (line) price: unit price × quantity, rounded to minor units.
 * Rounding happens once per line, never per fractional unit, which is what
 * both supplier invoices and the match engine expect.
 */
export function extendPrice(unitPrice: Money, qty: Quantity): Money {
  return money(roundHalfAway(unitPrice.amountMinor * qty), unitPrice.currency);
}

/** Unit price implied by an extended amount; used when suppliers quote totals. */
export function unitPriceFrom(extended: Money, qty: Quantity): Money {
  if (qty <= QTY_EPSILON) {
    throw ValidationError.single("quantity", "cannot derive a unit price from a zero quantity");
  }
  return money(roundHalfAway(extended.amountMinor / qty), extended.currency);
}

export function currencyCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw ValidationError.single("currency", `must be a 3-letter ISO code, got "${value}"`);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Small shared vocabulary
// ---------------------------------------------------------------------------

/** Incoterms 2020 three-letter codes accepted on orders and quotes. */
export const INCOTERMS = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
] as const;

export type Incoterm = (typeof INCOTERMS)[number];

export function incoterm(value: string): Incoterm {
  const normalized = value.trim().toUpperCase();
  if (!INCOTERMS.includes(normalized as Incoterm)) {
    throw ValidationError.single("incoterm", `must be one of ${INCOTERMS.join(", ")}`);
  }
  return normalized as Incoterm;
}

/** Net payment terms in days; `0` means due on receipt. */
export function paymentTermsDays(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 365) {
    throw ValidationError.single("paymentTermsDays", `must be an integer in [0, 365], got ${value}`);
  }
  return value;
}

export type DocumentType =
  | "requisition"
  | "purchase_order"
  | "invoice"
  | "blanket_agreement";

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  "requisition",
  "purchase_order",
  "invoice",
  "blanket_agreement",
];

/** Free-text codes (cost centre, category, GL account) are normalised alike. */
export function code(value: string, field: string, maxLength = 40): string {
  const normalized = value.trim().toUpperCase();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw ValidationError.single(field, `must be 1-${maxLength} characters, got "${value}"`);
  }
  if (!/^[A-Z0-9][A-Z0-9._\-/]*$/.test(normalized)) {
    throw ValidationError.single(
      field,
      `must start alphanumeric and contain only A-Z 0-9 . _ - /, got "${value}"`,
    );
  }
  return normalized;
}

export function requiredText(value: string, field: string, minLength = 1, maxLength = 2000): string {
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw ValidationError.single(field, `must be at least ${minLength} characters`);
  }
  if (trimmed.length > maxLength) {
    throw ValidationError.single(field, `must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
