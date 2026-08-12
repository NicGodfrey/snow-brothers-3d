import { brand, money, type Brand, type Money } from "@enterprise-suite/shared-kernel";
import { CurrencyError } from "./errors.js";

/**
 * Currencies (ISO 4217) and money arithmetic.
 *
 * Amounts move through the suite as integer minor units plus a code, so the
 * only place decimals appear is at the boundary. That boundary needs real
 * rules: currencies do not all have two decimals (JPY has none, TND has
 * three), some have cash-rounding increments that differ from their
 * accounting precision (CHF settles to 0.05), and splitting an amount across
 * lines must not invent or lose minor units.
 */

export type IsoCurrencyCode = Brand<string, "IsoCurrencyCode">;

export interface CurrencyDefinition {
  readonly code: IsoCurrencyCode;
  readonly numeric: string;
  readonly name: string;
  readonly symbol: string;
  /** Decimal places in the accounting representation. */
  readonly minorUnits: number;
  /**
   * Smallest cash increment in minor units. Larger than 1 where the smallest
   * coin was withdrawn (CHF 5 rappen, SEK 1 krona).
   */
  readonly cashIncrementMinor: number;
}

function currency(
  code: string,
  numeric: string,
  name: string,
  symbol: string,
  minorUnits = 2,
  cashIncrementMinor = 1,
): CurrencyDefinition {
  return {
    code: brand<string, "IsoCurrencyCode">(code),
    numeric,
    name,
    symbol,
    minorUnits,
    cashIncrementMinor,
  };
}

export const ISO_CURRENCIES: readonly CurrencyDefinition[] = [
  currency("AED", "784", "UAE Dirham", "د.إ"),
  currency("ARS", "032", "Argentine Peso", "$"),
  currency("AUD", "036", "Australian Dollar", "A$", 2, 5),
  currency("BGN", "975", "Bulgarian Lev", "лв"),
  currency("BHD", "048", "Bahraini Dinar", ".د.ب", 3),
  currency("BRL", "986", "Brazilian Real", "R$"),
  currency("CAD", "124", "Canadian Dollar", "C$", 2, 5),
  currency("CHF", "756", "Swiss Franc", "CHF", 2, 5),
  currency("CLP", "152", "Chilean Peso", "$", 0),
  currency("CNY", "156", "Chinese Yuan", "¥"),
  currency("COP", "170", "Colombian Peso", "$"),
  currency("CZK", "203", "Czech Koruna", "Kč"),
  currency("DKK", "208", "Danish Krone", "kr", 2, 50),
  currency("EGP", "818", "Egyptian Pound", "£"),
  currency("EUR", "978", "Euro", "€"),
  currency("GBP", "826", "Pound Sterling", "£"),
  currency("HKD", "344", "Hong Kong Dollar", "HK$"),
  currency("HUF", "348", "Hungarian Forint", "Ft", 2, 500),
  currency("IDR", "360", "Indonesian Rupiah", "Rp"),
  currency("ILS", "376", "Israeli New Shekel", "₪", 2, 10),
  currency("INR", "356", "Indian Rupee", "₹"),
  currency("ISK", "352", "Icelandic Krona", "kr", 0),
  currency("JOD", "400", "Jordanian Dinar", "د.ا", 3),
  currency("JPY", "392", "Japanese Yen", "¥", 0),
  currency("KES", "404", "Kenyan Shilling", "KSh"),
  currency("KRW", "410", "South Korean Won", "₩", 0),
  currency("KWD", "414", "Kuwaiti Dinar", "د.ك", 3),
  currency("MXN", "484", "Mexican Peso", "$"),
  currency("MYR", "458", "Malaysian Ringgit", "RM", 2, 5),
  currency("NGN", "566", "Nigerian Naira", "₦"),
  currency("NOK", "578", "Norwegian Krone", "kr"),
  currency("NZD", "554", "New Zealand Dollar", "NZ$", 2, 10),
  currency("OMR", "512", "Omani Rial", "ر.ع.", 3),
  currency("PHP", "608", "Philippine Peso", "₱"),
  currency("PLN", "985", "Polish Zloty", "zł"),
  currency("RON", "946", "Romanian Leu", "lei"),
  currency("RUB", "643", "Russian Ruble", "₽"),
  currency("SAR", "682", "Saudi Riyal", "ر.س"),
  currency("SEK", "752", "Swedish Krona", "kr", 2, 100),
  currency("SGD", "702", "Singapore Dollar", "S$"),
  currency("THB", "764", "Thai Baht", "฿"),
  currency("TND", "788", "Tunisian Dinar", "د.ت", 3),
  currency("TRY", "949", "Turkish Lira", "₺"),
  currency("TWD", "901", "New Taiwan Dollar", "NT$"),
  currency("UAH", "980", "Ukrainian Hryvnia", "₴"),
  currency("USD", "840", "US Dollar", "$"),
  currency("VND", "704", "Vietnamese Dong", "₫", 0),
  currency("ZAR", "710", "South African Rand", "R"),
];

const BY_CODE = new Map(ISO_CURRENCIES.map((c) => [String(c.code), c]));
const BY_NUMERIC = new Map(ISO_CURRENCIES.map((c) => [c.numeric, c]));

export function findCurrency(code: string): CurrencyDefinition | undefined {
  const normalized = code.trim().toUpperCase();
  return BY_CODE.get(normalized) ?? BY_NUMERIC.get(normalized);
}

export function requireCurrency(code: string): CurrencyDefinition {
  const found = findCurrency(code);
  if (!found) throw new CurrencyError(`Unknown currency "${code}"`);
  return found;
}

export function isoCurrencyCode(code: string): IsoCurrencyCode {
  return requireCurrency(code).code;
}

export type RoundingMode = "half-up" | "half-even" | "half-down" | "ceil" | "floor" | "trunc";

export const ROUNDING_MODES: readonly RoundingMode[] = [
  "half-up",
  "half-even",
  "half-down",
  "ceil",
  "floor",
  "trunc",
];

/**
 * Rounds to an integer under the given mode. `half-even` (banker's rounding)
 * is the default for FX conversion because it does not bias a long series of
 * conversions upward the way `half-up` does.
 */
export function roundWith(value: number, mode: RoundingMode = "half-up"): number {
  if (Number.isInteger(value)) return value;
  const floor = Math.floor(value);
  const fraction = value - floor;
  switch (mode) {
    case "ceil":
      return Math.ceil(value);
    case "floor":
      return floor;
    case "trunc":
      return Math.trunc(value);
    case "half-down":
      return fraction > 0.5 ? floor + 1 : floor;
    case "half-even":
      if (fraction !== 0.5) return fraction > 0.5 ? floor + 1 : floor;
      return floor % 2 === 0 ? floor : floor + 1;
    case "half-up":
    default:
      // Symmetric around zero: -2.5 rounds to -3, matching accounting practice.
      return value < 0 ? -Math.round(-value) : Math.round(value);
  }
}

/** Decimal amount -> integer minor units for the currency's precision. */
export function toMinorUnits(
  amount: number,
  currencyCode: string,
  mode: RoundingMode = "half-up",
): number {
  const definition = requireCurrency(currencyCode);
  if (!Number.isFinite(amount)) {
    throw new CurrencyError(`Amount must be a finite number, got ${amount}`);
  }
  return roundWith(amount * 10 ** definition.minorUnits, mode);
}

export function fromMinorUnits(amountMinor: number, currencyCode: string): number {
  const definition = requireCurrency(currencyCode);
  return amountMinor / 10 ** definition.minorUnits;
}

export function makeMoney(
  amount: number,
  currencyCode: string,
  mode: RoundingMode = "half-up",
): Money {
  const definition = requireCurrency(currencyCode);
  return money(toMinorUnits(amount, String(definition.code), mode), String(definition.code));
}

export function moneyFromMinor(amountMinor: number, currencyCode: string): Money {
  const definition = requireCurrency(currencyCode);
  if (!Number.isInteger(amountMinor)) {
    throw new CurrencyError(`Minor units must be an integer, got ${amountMinor}`);
  }
  return money(amountMinor, String(definition.code));
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, String(a.currency));
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor === b.amountMinor ? 0 : a.amountMinor < b.amountMinor ? -1 : 1;
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0;
}

export function negate(value: Money): Money {
  return money(-value.amountMinor, String(value.currency));
}

export function absMoney(value: Money): Money {
  return money(Math.abs(value.amountMinor), String(value.currency));
}

/** Rounds to the currency's cash increment (CHF 1.03 -> CHF 1.05). */
export function roundToCash(value: Money, mode: RoundingMode = "half-up"): Money {
  const definition = requireCurrency(String(value.currency));
  if (definition.cashIncrementMinor <= 1) return value;
  const steps = roundWith(value.amountMinor / definition.cashIncrementMinor, mode);
  return money(steps * definition.cashIncrementMinor, String(value.currency));
}

/**
 * Splits an amount across weights without losing minor units.
 *
 * Each share gets the floor of its exact portion, then the remaining units are
 * handed out one at a time in descending remainder order (largest-remainder
 * apportionment). The shares always sum back to the input, which is what
 * makes it safe for invoice line allocation and instalment schedules.
 */
export function allocate(value: Money, weights: readonly number[]): readonly Money[] {
  if (weights.length === 0) throw new CurrencyError("allocate requires at least one weight");
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new CurrencyError("allocate weights must be finite and non-negative");
  }
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) throw new CurrencyError("allocate weights must sum to more than zero");

  const sign = value.amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(value.amountMinor);
  const exact = weights.map((w) => (magnitude * w) / totalWeight);
  const base = exact.map((portion) => Math.floor(portion));
  let remainder = magnitude - base.reduce((sum, portion) => sum + portion, 0);

  const order = exact
    .map((portion, index) => ({ index, fraction: portion - Math.floor(portion) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of order) {
    if (remainder <= 0) break;
    base[index] = base[index]! + 1;
    remainder -= 1;
  }
  return base.map((amountMinor) => money(sign * amountMinor, String(value.currency)));
}

/** Splits evenly into `parts`, distributing the leftover units one per share. */
export function split(value: Money, parts: number): readonly Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new CurrencyError(`split requires a positive integer part count, got ${parts}`);
  }
  return allocate(value, Array.from({ length: parts }, () => 1));
}

/** Applies a percentage (e.g. a 2% discount) with explicit rounding. */
export function percentOf(value: Money, percent: number, mode: RoundingMode = "half-up"): Money {
  if (!Number.isFinite(percent)) throw new CurrencyError("percent must be a finite number");
  return money(roundWith((value.amountMinor * percent) / 100, mode), String(value.currency));
}

/** Fixed-format rendering: grouped integer part, currency precision, ISO code. */
export function formatMoney(
  value: Money,
  options: { readonly withSymbol?: boolean; readonly groupSeparator?: string; readonly decimalSeparator?: string } = {},
): string {
  const definition = requireCurrency(String(value.currency));
  const groupSeparator = options.groupSeparator ?? ",";
  const decimalSeparator = options.decimalSeparator ?? ".";
  const negative = value.amountMinor < 0;
  const raw = Math.abs(value.amountMinor).toString().padStart(definition.minorUnits + 1, "0");
  const integerPart = raw.slice(0, raw.length - definition.minorUnits) || "0";
  const fractionPart = definition.minorUnits > 0 ? raw.slice(raw.length - definition.minorUnits) : "";
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  const body = fractionPart ? `${grouped}${decimalSeparator}${fractionPart}` : grouped;
  const suffix = options.withSymbol ? definition.symbol : String(definition.code);
  return `${negative ? "-" : ""}${body} ${suffix}`;
}

/** Per-tenant enablement of an ISO currency, with an optional display override. */
export interface TenantCurrency {
  readonly code: IsoCurrencyCode;
  readonly enabled: boolean;
  /** Exactly one tenant currency is the reporting/functional currency. */
  readonly isFunctional: boolean;
  readonly roundingMode: RoundingMode;
  readonly displaySymbol?: string;
}
