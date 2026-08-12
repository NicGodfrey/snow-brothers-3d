import {
  addMoney,
  moneyToJSON,
  mulMoney,
  sumMoney,
  zeroMoney,
  type Money,
} from "../../kernel/index.js";
import { applyDiscount } from "../pricing/discount.js";
import { TaxCalculator, type TaxLine } from "../pricing/tax.js";
import type { QuoteLine } from "./quote-line.js";

export interface LineComputation {
  readonly lineId: string;
  readonly gross: Money;
  readonly discount: Money;
  readonly net: Money;
}

export interface DocumentTotals {
  readonly currency: string;
  readonly lines: readonly LineComputation[];
  readonly subtotal: Money;
  readonly discountTotal: Money;
  readonly netTotal: Money;
  readonly taxLines: readonly TaxLine[];
  readonly taxTotal: Money;
  readonly grandTotal: Money;
}

/**
 * Shared pricing math for quotes and orders:
 *   gross = qty * unitPrice
 *   net   = gross - line discount
 *   tax   = per-category tax on nets (region-dependent)
 *   grand = net total + tax total
 */
export function computeTotals(
  lines: readonly QuoteLine[],
  currencyCode: string,
  taxRegion: string,
  taxCalculator: TaxCalculator = new TaxCalculator(),
): DocumentTotals {
  const computations: LineComputation[] = lines.map((line) => {
    const gross = mulMoney(line.unitPrice, line.qty);
    const { net, discount } = applyDiscount(gross, line.discountPercent);
    return { lineId: line.lineId as unknown as string, gross, discount, net };
  });

  const subtotal = sumMoney(
    computations.map((c) => c.gross),
    currencyCode,
  );
  const discountTotal = sumMoney(
    computations.map((c) => c.discount),
    currencyCode,
  );
  const netTotal = sumMoney(
    computations.map((c) => c.net),
    currencyCode,
  );

  const taxLines = taxCalculator.computeTaxLines(
    lines.map((line, i) => ({
      lineId: line.lineId as unknown as string,
      taxCategory: line.taxCategory,
      netAmount: computations[i].net,
    })),
    taxRegion,
    currencyCode,
  );
  const taxTotal = taxLines.reduce((acc, t) => addMoney(acc, t.taxAmount), zeroMoney(currencyCode));

  return {
    currency: currencyCode.toUpperCase(),
    lines: computations,
    subtotal,
    discountTotal,
    netTotal,
    taxLines,
    taxTotal,
    grandTotal: addMoney(netTotal, taxTotal),
  };
}

export function totalsToJSON(t: DocumentTotals): Record<string, unknown> {
  return {
    currency: t.currency,
    lines: t.lines.map((l) => ({
      lineId: l.lineId,
      gross: moneyToJSON(l.gross),
      discount: moneyToJSON(l.discount),
      net: moneyToJSON(l.net),
    })),
    subtotal: moneyToJSON(t.subtotal),
    discountTotal: moneyToJSON(t.discountTotal),
    netTotal: moneyToJSON(t.netTotal),
    taxLines: t.taxLines.map((tl) => ({
      taxCategory: tl.taxCategory,
      ratePercent: tl.ratePercent,
      baseAmount: moneyToJSON(tl.baseAmount),
      taxAmount: moneyToJSON(tl.taxAmount),
    })),
    taxTotal: moneyToJSON(t.taxTotal),
    grandTotal: moneyToJSON(t.grandTotal),
  };
}
