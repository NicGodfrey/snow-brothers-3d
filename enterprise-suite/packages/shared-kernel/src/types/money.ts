import type { Brand } from "./branded.js";

export type CurrencyCode = Brand<string, "CurrencyCode">;
export type MoneyMinor = Brand<number, "MoneyMinor">;

export interface Money {
  readonly amountMinor: MoneyMinor;
  readonly currency: CurrencyCode;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error("Money amount must be integer minor units");
  }
  return {
    amountMinor: amountMinor as MoneyMinor,
    currency: currency.toUpperCase() as CurrencyCode,
  };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error("Currency mismatch");
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function mulMoney(a: Money, factor: number): Money {
  return money(Math.round(a.amountMinor * factor), a.currency);
}
