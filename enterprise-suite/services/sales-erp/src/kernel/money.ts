import type { Brand } from "./brand.js";

export type CurrencyCode = Brand<string, "CurrencyCode">;
export type MoneyMinor = Brand<number, "MoneyMinor">;

/** Integer minor units + ISO currency, per ARCHITECTURE.md. */
export interface Money {
  readonly amountMinor: MoneyMinor;
  readonly currency: CurrencyCode;
}

export function currency(code: string): CurrencyCode {
  return code.toUpperCase() as CurrencyCode;
}

export function money(amountMinor: number, currencyCode: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error("Money amount must be integer minor units");
  }
  return {
    amountMinor: amountMinor as MoneyMinor,
    currency: currency(currencyCode),
  };
}

export function zeroMoney(currencyCode: string): Money {
  return money(0, currencyCode);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function mulMoney(a: Money, factor: number): Money {
  return money(Math.round(a.amountMinor * factor), a.currency);
}

/** percent is expressed as e.g. 7.5 for 7.5%. Rounds half away from zero at minor-unit precision. */
export function percentOf(a: Money, percent: number): Money {
  const raw = (a.amountMinor * percent) / 100;
  const rounded = Math.sign(raw) * Math.round(Math.abs(raw));
  return money(rounded, a.currency);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function moneyGte(a: Money, b: Money): boolean {
  return compareMoney(a, b) >= 0;
}

export function sumMoney(items: readonly Money[], currencyCode: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), zeroMoney(currencyCode));
}

export function moneyToJSON(m: Money): { amountMinor: number; currency: string } {
  return { amountMinor: m.amountMinor as unknown as number, currency: m.currency as unknown as string };
}
