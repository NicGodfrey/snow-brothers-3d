import { money, type Money } from "@enterprise-suite/shared-kernel";
import { CurrencyMismatchError, ValidationError } from "./errors.js";

/**
 * Money helpers on top of the shared kernel's integer-minor-unit Money.
 *
 * PRM never converts between currencies: a budget, its allocations, the fund
 * requests drawn against it and the claims that settle it all live in one
 * currency, and mixing is a domain error rather than a silent FX guess.
 */

export function zero(currency: string): Money {
  return money(0, currency);
}

export function assertSameCurrency(expected: Money, actual: Money): void {
  if (expected.currency !== actual.currency) {
    throw new CurrencyMismatchError(expected.currency, actual.currency);
  }
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sum(values: readonly Money[], currency: string): Money {
  let total = 0;
  for (const value of values) {
    if (value.currency !== currency.toUpperCase()) {
      throw new CurrencyMismatchError(currency.toUpperCase(), value.currency);
    }
    total += value.amountMinor;
  }
  return money(total, currency);
}

export function isNegative(value: Money): boolean {
  return value.amountMinor < 0;
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0;
}

/** a >= b, currencies must match. */
export function gte(a: Money, b: Money): boolean {
  assertSameCurrency(a, b);
  return a.amountMinor >= b.amountMinor;
}

/** a > b, currencies must match. */
export function gt(a: Money, b: Money): boolean {
  assertSameCurrency(a, b);
  return a.amountMinor > b.amountMinor;
}

export function minMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amountMinor <= b.amountMinor ? a : b;
}

/** Basis points of an amount, rounded half-up to the minor unit. */
export function applyBps(value: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw ValidationError.single("bps", "must be an integer between 0 and 10000");
  }
  return money(Math.round((value.amountMinor * bps) / 10_000), value.currency);
}

/** Parses `{amountMinor, currency}` shaped input into Money with clear errors. */
export function parseMoney(input: unknown, field = "amount"): Money {
  if (input === null || typeof input !== "object") {
    throw ValidationError.single(field, "must be an object { amountMinor, currency }");
  }
  const record = input as Record<string, unknown>;
  const amountMinor = record["amountMinor"];
  const currency = record["currency"];
  if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor)) {
    throw ValidationError.single(`${field}.amountMinor`, "must be an integer number of minor units");
  }
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    throw ValidationError.single(`${field}.currency`, "must be a 3-letter ISO currency code");
  }
  return money(amountMinor, currency);
}

export function requirePositive(value: Money, field: string): Money {
  if (value.amountMinor <= 0) {
    throw ValidationError.single(field, "must be greater than zero");
  }
  return value;
}

export function requireNonNegative(value: Money, field: string): Money {
  if (value.amountMinor < 0) {
    throw ValidationError.single(field, "must not be negative");
  }
  return value;
}

export function formatMoney(value: Money, minorPerMajor = 100): string {
  const sign = value.amountMinor < 0 ? "-" : "";
  const abs = Math.abs(value.amountMinor);
  const major = Math.floor(abs / minorPerMajor);
  const minor = String(abs % minorPerMajor).padStart(String(minorPerMajor - 1).length, "0");
  return `${sign}${major}.${minor} ${value.currency}`;
}
