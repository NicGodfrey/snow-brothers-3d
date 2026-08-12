import { money, type Money } from "@enterprise-suite/shared-kernel";
import { CurrencyMismatchError, ValidationError } from "./errors.js";

/**
 * Money helpers for channel maths.
 *
 * Everything stays in integer minor units and one currency. There is no FX in
 * this context on purpose: a partner's commission and a customer's order value
 * are quoted in the same currency, and cross-currency roll-ups are bucketed by
 * currency in the analytics layer rather than silently converted.
 */

export const BPS_DENOMINATOR = 10_000;

export function zeroMoney(currency: string): Money {
  return money(0, currency);
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0;
}

export function assertSameCurrency(a: Money, b: Money, context: string): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency, context);
  }
}

export function assertPositiveMoney(value: Money, field: string): Money {
  if (value.amountMinor <= 0) throw ValidationError.single(field, "must be greater than zero");
  return value;
}

export function assertNonNegativeMoney(value: Money, field: string): Money {
  if (value.amountMinor < 0) throw ValidationError.single(field, "must not be negative");
  return value;
}

export function sumMoney(values: readonly Money[], currency?: string): Money {
  if (values.length === 0) {
    if (!currency) throw ValidationError.single("values", "cannot sum an empty list without a currency");
    return zeroMoney(currency);
  }
  const target = currency ?? values[0]!.currency;
  let total = 0;
  for (const value of values) {
    if (value.currency !== target.toUpperCase()) {
      throw new CurrencyMismatchError(target, value.currency, "sumMoney");
    }
    total += value.amountMinor;
  }
  return money(total, target);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "subtractMoney");
  return money(a.amountMinor - b.amountMinor, a.currency);
}

/** Half-up rounding to whole minor units, applied once per call. */
export function applyBps(value: Money, bps: number): Money {
  assertBps(bps, "bps");
  return money(Math.round((value.amountMinor * bps) / BPS_DENOMINATOR), value.currency);
}

/** The remainder after a bps deduction: list price minus discount. */
export function deductBps(value: Money, bps: number): Money {
  return subtractMoney(value, applyBps(value, bps));
}

export function assertBps(bps: number, field: string): number {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw ValidationError.single(field, "must be an integer between 0 and 10000 basis points");
  }
  return bps;
}

/**
 * Effective discount of `net` against `list`, in basis points, rounded to the
 * nearest whole bp. A net above list yields 0 rather than a negative discount;
 * uplifts are a pricing exception this context does not model.
 */
export function discountBpsOf(list: Money, net: Money): number {
  assertSameCurrency(list, net, "discountBpsOf");
  if (list.amountMinor <= 0) return 0;
  const raw = ((list.amountMinor - net.amountMinor) / list.amountMinor) * BPS_DENOMINATOR;
  return raw <= 0 ? 0 : Math.round(raw);
}

export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw ValidationError.single("quantity", "must be a non-negative number");
  }
  return money(Math.round(value.amountMinor * quantity), value.currency);
}

export function maxMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "maxMoney");
  return a.amountMinor >= b.amountMinor ? a : b;
}

/** Probability-weighted value used across the pipeline roll-ups. */
export function weightMoney(value: Money, probabilityPercent: number): Money {
  if (!Number.isFinite(probabilityPercent) || probabilityPercent < 0 || probabilityPercent > 100) {
    throw ValidationError.single("probability", "must be between 0 and 100");
  }
  return money(Math.round((value.amountMinor * probabilityPercent) / 100), value.currency);
}

export function formatMoney(value: Money): string {
  const sign = value.amountMinor < 0 ? "-" : "";
  const abs = Math.abs(value.amountMinor);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  return `${sign}${major}.${minor} ${value.currency}`;
}
