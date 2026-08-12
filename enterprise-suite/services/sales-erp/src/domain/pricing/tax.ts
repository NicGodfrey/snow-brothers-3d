import { percentOf, sumMoney, type Money } from "../../kernel/index.js";
import type { TaxCategory } from "./price-list.js";

export interface TaxRateTable {
  readonly region: string;
  readonly rates: Readonly<Record<TaxCategory, number>>;
}

/** Percent rates per region and category; extend per deployment. */
export const DEFAULT_TAX_TABLES: readonly TaxRateTable[] = [
  { region: "DE", rates: { standard: 19, reduced: 7, zero: 0, exempt: 0 } },
  { region: "FR", rates: { standard: 20, reduced: 5.5, zero: 0, exempt: 0 } },
  { region: "GB", rates: { standard: 20, reduced: 5, zero: 0, exempt: 0 } },
  { region: "US", rates: { standard: 8.5, reduced: 8.5, zero: 0, exempt: 0 } },
];

const FALLBACK: TaxRateTable = { region: "*", rates: { standard: 0, reduced: 0, zero: 0, exempt: 0 } };

export interface TaxableLine {
  readonly lineId: string;
  readonly taxCategory: TaxCategory;
  readonly netAmount: Money;
}

export interface TaxLine {
  readonly taxCategory: TaxCategory;
  readonly ratePercent: number;
  readonly baseAmount: Money;
  readonly taxAmount: Money;
}

export class TaxCalculator {
  private readonly byRegion: Map<string, TaxRateTable>;

  constructor(tables: readonly TaxRateTable[] = DEFAULT_TAX_TABLES) {
    this.byRegion = new Map(tables.map((t) => [t.region.toUpperCase(), t]));
  }

  rateFor(region: string, category: TaxCategory): number {
    const table = this.byRegion.get(region.toUpperCase()) ?? FALLBACK;
    return table.rates[category];
  }

  /** Groups lines by (category, rate) and computes one tax line per group. */
  computeTaxLines(lines: readonly TaxableLine[], region: string, currencyCode: string): TaxLine[] {
    const groups = new Map<TaxCategory, TaxableLine[]>();
    for (const line of lines) {
      const bucket = groups.get(line.taxCategory);
      if (bucket) bucket.push(line);
      else groups.set(line.taxCategory, [line]);
    }
    const result: TaxLine[] = [];
    for (const [category, grouped] of groups) {
      const rate = this.rateFor(region, category);
      const base = sumMoney(
        grouped.map((l) => l.netAmount),
        currencyCode,
      );
      result.push({
        taxCategory: category,
        ratePercent: rate,
        baseAmount: base,
        taxAmount: percentOf(base, rate),
      });
    }
    return result.sort((a, b) => a.taxCategory.localeCompare(b.taxCategory));
  }

  totalTax(lines: readonly TaxableLine[], region: string, currencyCode: string): Money {
    return sumMoney(
      this.computeTaxLines(lines, region, currencyCode).map((t) => t.taxAmount),
      currencyCode,
    );
  }
}
