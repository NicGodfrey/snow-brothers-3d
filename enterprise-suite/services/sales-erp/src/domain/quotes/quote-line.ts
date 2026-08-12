import { ConflictError, newId, type Money, type Sku, type Ulid, money } from "../../kernel/index.js";
import type { TaxCategory } from "../pricing/price-list.js";
import { assertValidDiscountPercent } from "../pricing/discount.js";

export interface QuoteLine {
  readonly lineId: Ulid;
  readonly sku: Sku;
  readonly description: string;
  readonly qty: number;
  readonly unitPrice: Money;
  readonly discountPercent: number;
  readonly taxCategory: TaxCategory;
}

export interface QuoteLineInput {
  sku: Sku;
  description: string;
  qty: number;
  unitPriceMinor: number;
  currency: string;
  discountPercent?: number;
  taxCategory?: TaxCategory;
}

export function createQuoteLine(input: QuoteLineInput): QuoteLine {
  if (!Number.isInteger(input.qty) || input.qty < 1) {
    throw new ConflictError(`Line qty must be a positive integer (got ${input.qty})`);
  }
  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
    throw new ConflictError("Line unitPriceMinor must be a non-negative integer");
  }
  const discountPercent = input.discountPercent ?? 0;
  assertValidDiscountPercent(discountPercent);
  return {
    lineId: newId("qline"),
    sku: input.sku,
    description: input.description,
    qty: input.qty,
    unitPrice: money(input.unitPriceMinor, input.currency),
    discountPercent,
    taxCategory: input.taxCategory ?? "standard",
  };
}

export function updateQuoteLine(
  line: QuoteLine,
  patch: { qty?: number; unitPriceMinor?: number; discountPercent?: number; description?: string },
): QuoteLine {
  const qty = patch.qty ?? line.qty;
  if (!Number.isInteger(qty) || qty < 1) {
    throw new ConflictError(`Line qty must be a positive integer (got ${qty})`);
  }
  const unitPriceMinor = patch.unitPriceMinor ?? (line.unitPrice.amountMinor as unknown as number);
  if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new ConflictError("Line unitPriceMinor must be a non-negative integer");
  }
  const discountPercent = patch.discountPercent ?? line.discountPercent;
  assertValidDiscountPercent(discountPercent);
  return {
    ...line,
    qty,
    unitPrice: money(unitPriceMinor, line.unitPrice.currency),
    discountPercent,
    description: patch.description ?? line.description,
  };
}
