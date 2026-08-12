import type { IsoDateTime, Money, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import {
  isoCurrencyCode,
  moneyFromMinor,
  requireCurrency,
  roundWith,
  type IsoCurrencyCode,
  type RoundingMode,
} from "./currency.js";
import { CurrencyError, FxRateUnavailableError, ValidationError } from "./errors.js";

/**
 * Foreign exchange rates.
 *
 * A rate is effective-dated and typed: the spot rate used to price an order,
 * the monthly average used to translate a P&L and the budget rate used for
 * planning are all different numbers for the same pair on the same day, and
 * mixing them is a reporting bug. Rates also carry a quotation unit, because
 * low-value currencies are quoted per 100 or per 1000 units rather than per 1.
 *
 * Lookup order is direct quote, then inverse of the opposite quote, then
 * triangulation through a pivot currency. The resolution records which path
 * was taken so downstream postings can show their working.
 */

export type FxRateType = "spot" | "daily" | "monthly-average" | "budget" | "hedge" | "statutory";

export const FX_RATE_TYPES: readonly FxRateType[] = [
  "spot",
  "daily",
  "monthly-average",
  "budget",
  "hedge",
  "statutory",
];

export interface FxRate {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly base: IsoCurrencyCode;
  readonly quote: IsoCurrencyCode;
  /** `unit` base units buy `rate` quote units. */
  readonly rate: number;
  readonly unit: number;
  readonly rateType: FxRateType;
  readonly validFrom: IsoDateTime;
  readonly validTo?: IsoDateTime;
  readonly source: string;
  readonly createdAt: IsoDateTime;
}

export interface FxRateInput {
  readonly base: string;
  readonly quote: string;
  readonly rate: number;
  readonly unit?: number;
  readonly rateType?: FxRateType;
  readonly validFrom: string;
  readonly validTo?: string;
  readonly source?: string;
}

export function fxPairKey(base: string, quote: string, rateType: FxRateType): string {
  return `${base.toUpperCase()}/${quote.toUpperCase()}#${rateType}`;
}

export function validateFxRateInput(input: FxRateInput): void {
  const base = requireCurrency(input.base).code;
  const quote = requireCurrency(input.quote).code;
  if (base === quote) {
    throw new CurrencyError(`A rate cannot quote ${base} against itself`);
  }
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    throw ValidationError.single("rate", "must be a positive finite number");
  }
  if (input.unit !== undefined && (!Number.isInteger(input.unit) || input.unit <= 0)) {
    throw ValidationError.single("unit", "quotation unit must be a positive integer");
  }
  if (Number.isNaN(Date.parse(input.validFrom))) {
    throw ValidationError.single("validFrom", "must be an ISO timestamp");
  }
  if (input.validTo !== undefined) {
    if (Number.isNaN(Date.parse(input.validTo))) {
      throw ValidationError.single("validTo", "must be an ISO timestamp");
    }
    if (Date.parse(input.validTo) <= Date.parse(input.validFrom)) {
      throw ValidationError.single("validTo", "must be after validFrom");
    }
  }
  if (input.rateType !== undefined && !FX_RATE_TYPES.includes(input.rateType)) {
    throw ValidationError.single("rateType", `must be one of [${FX_RATE_TYPES.join(", ")}]`);
  }
}

export type FxPath = "identity" | "direct" | "inverse" | "triangulated";

export interface FxLeg {
  readonly base: IsoCurrencyCode;
  readonly quote: IsoCurrencyCode;
  /** Effective multiplier for this leg, already normalized for quotation unit. */
  readonly factor: number;
  readonly rateId?: Ulid;
  readonly inverted: boolean;
  readonly validFrom?: IsoDateTime;
}

export interface FxResolution {
  readonly base: IsoCurrencyCode;
  readonly quote: IsoCurrencyCode;
  readonly rateType: FxRateType;
  readonly asOf: string;
  /** Multiply a base amount by this to get the quote amount. */
  readonly factor: number;
  readonly path: FxPath;
  readonly legs: readonly FxLeg[];
}

export interface FxLookupOptions {
  readonly rateType?: FxRateType;
  readonly asOf?: string;
  /**
   * Currencies to triangulate through, in preference order. Defaults to the
   * tenant's functional currency followed by the market majors.
   */
  readonly pivots?: readonly string[];
  /** Rejects inverse and triangulated resolution when true. */
  readonly directOnly?: boolean;
}

const DEFAULT_PIVOTS = ["USD", "EUR"];

function effectiveAt(rate: FxRate, at: number): boolean {
  if (Date.parse(rate.validFrom) > at) return false;
  return rate.validTo === undefined || Date.parse(rate.validTo) > at;
}

/**
 * An immutable view over a tenant's rates for lookup. Services build one per
 * request from the repository; it does no I/O so the resolution logic stays
 * unit-testable.
 */
export class FxRateTable {
  private readonly byPair = new Map<string, FxRate[]>();

  constructor(rates: readonly FxRate[] = []) {
    for (const rate of rates) this.add(rate);
  }

  add(rate: FxRate): void {
    const key = fxPairKey(String(rate.base), String(rate.quote), rate.rateType);
    const bucket = this.byPair.get(key);
    if (bucket) {
      bucket.push(rate);
      // Newest first so lookup can stop at the first effective row.
      bucket.sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
    } else {
      this.byPair.set(key, [rate]);
    }
  }

  all(): readonly FxRate[] {
    return [...this.byPair.values()].flat();
  }

  /** The rate quoted for exactly this pair and type, effective on the date. */
  direct(base: string, quote: string, rateType: FxRateType, asOf: string): FxRate | undefined {
    const at = Date.parse(asOf);
    const bucket = this.byPair.get(fxPairKey(base, quote, rateType)) ?? [];
    return bucket.find((rate) => effectiveAt(rate, at));
  }

  /** Full history for a pair, newest first. */
  history(base: string, quote: string, rateType: FxRateType): readonly FxRate[] {
    return this.byPair.get(fxPairKey(base, quote, rateType)) ?? [];
  }

  private leg(rate: FxRate, inverted: boolean): FxLeg {
    const factor = inverted ? rate.unit / rate.rate : rate.rate / rate.unit;
    return {
      base: inverted ? rate.quote : rate.base,
      quote: inverted ? rate.base : rate.quote,
      factor,
      rateId: rate.id,
      inverted,
      validFrom: rate.validFrom,
    };
  }

  /** Direct quote or the inverse of the opposite quote, whichever exists. */
  private oneLeg(base: string, quote: string, rateType: FxRateType, asOf: string): FxLeg | undefined {
    const forward = this.direct(base, quote, rateType, asOf);
    if (forward) return this.leg(forward, false);
    const backward = this.direct(quote, base, rateType, asOf);
    return backward ? this.leg(backward, true) : undefined;
  }

  resolve(baseCode: string, quoteCode: string, options: FxLookupOptions = {}): FxResolution {
    const base = isoCurrencyCode(baseCode);
    const quote = isoCurrencyCode(quoteCode);
    const rateType = options.rateType ?? "spot";
    const asOf = options.asOf ?? new Date().toISOString();

    if (base === quote) {
      return { base, quote, rateType, asOf, factor: 1, path: "identity", legs: [] };
    }

    const forward = this.direct(String(base), String(quote), rateType, asOf);
    if (forward) {
      const leg = this.leg(forward, false);
      return { base, quote, rateType, asOf, factor: leg.factor, path: "direct", legs: [leg] };
    }

    if (!options.directOnly) {
      const backward = this.direct(String(quote), String(base), rateType, asOf);
      if (backward) {
        const leg = this.leg(backward, true);
        return { base, quote, rateType, asOf, factor: leg.factor, path: "inverse", legs: [leg] };
      }

      const pivots = (options.pivots ?? DEFAULT_PIVOTS)
        .map((code) => String(isoCurrencyCode(code)))
        .filter((code) => code !== String(base) && code !== String(quote));
      for (const pivot of pivots) {
        const first = this.oneLeg(String(base), pivot, rateType, asOf);
        if (!first) continue;
        const second = this.oneLeg(pivot, String(quote), rateType, asOf);
        if (!second) continue;
        return {
          base,
          quote,
          rateType,
          asOf,
          factor: first.factor * second.factor,
          path: "triangulated",
          legs: [first, second],
        };
      }
    }
    throw new FxRateUnavailableError(String(base), String(quote), asOf, rateType);
  }

  factor(base: string, quote: string, options: FxLookupOptions = {}): number {
    return this.resolve(base, quote, options).factor;
  }
}

export interface FxConversion {
  readonly from: Money;
  readonly to: Money;
  readonly resolution: FxResolution;
  /** Unrounded quote amount in minor units, kept for audit and reconciliation. */
  readonly rawMinor: number;
}

/**
 * Converts money between currencies.
 *
 * Minor-unit scales differ per currency, so the amount is taken to a decimal,
 * multiplied by the resolved factor, then re-scaled to the target currency's
 * precision — converting 1000 JPY (0 decimals) to USD (2 decimals) has to
 * change scale, not just multiply.
 */
export function convertMoney(
  table: FxRateTable,
  value: Money,
  targetCurrency: string,
  options: FxLookupOptions & { readonly rounding?: RoundingMode } = {},
): FxConversion {
  const source = requireCurrency(String(value.currency));
  const target = requireCurrency(targetCurrency);
  const resolution = table.resolve(String(source.code), String(target.code), options);
  const scale = 10 ** (target.minorUnits - source.minorUnits);
  const rawMinor = value.amountMinor * resolution.factor * scale;
  const rounded = roundWith(rawMinor, options.rounding ?? "half-even");
  return {
    from: value,
    to: moneyFromMinor(rounded, String(target.code)),
    resolution,
    rawMinor,
  };
}

/**
 * Rate a currency triplet the way a revaluation run needs it: the same amount
 * expressed in transaction, functional and reporting currency.
 */
export interface TriangulatedAmounts {
  readonly transaction: Money;
  readonly functional: Money;
  readonly reporting: Money;
}

export function expressInAll(
  table: FxRateTable,
  value: Money,
  functionalCurrency: string,
  reportingCurrency: string,
  options: FxLookupOptions & { readonly rounding?: RoundingMode } = {},
): TriangulatedAmounts {
  return {
    transaction: value,
    functional: convertMoney(table, value, functionalCurrency, options).to,
    reporting: convertMoney(table, value, reportingCurrency, options).to,
  };
}
