import { ConflictError, newId, type Money, type Sku, type Ulid, money } from "../../kernel/index.js";
import type { TaxCategory } from "../pricing/price-list.js";
import { assertValidDiscountPercent } from "../pricing/discount.js";
import type { QuoteLine } from "../quotes/quote-line.js";

export interface OrderLine {
  readonly lineId: Ulid;
  readonly sku: Sku;
  readonly description: string;
  readonly qty: number;
  readonly unitPrice: Money;
  readonly discountPercent: number;
  readonly taxCategory: TaxCategory;
  readonly qtyAllocated: number;
  readonly qtyShipped: number;
}

export interface OrderLineInput {
  sku: Sku;
  description: string;
  qty: number;
  unitPriceMinor: number;
  currency: string;
  discountPercent?: number;
  taxCategory?: TaxCategory;
}

export function createOrderLine(input: OrderLineInput): OrderLine {
  if (!Number.isInteger(input.qty) || input.qty < 1) {
    throw new ConflictError(`Order line qty must be a positive integer (got ${input.qty})`);
  }
  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
    throw new ConflictError("Order line unitPriceMinor must be a non-negative integer");
  }
  const discountPercent = input.discountPercent ?? 0;
  assertValidDiscountPercent(discountPercent);
  return {
    lineId: newId("oline"),
    sku: input.sku,
    description: input.description,
    qty: input.qty,
    unitPrice: money(input.unitPriceMinor, input.currency),
    discountPercent,
    taxCategory: input.taxCategory ?? "standard",
    qtyAllocated: 0,
    qtyShipped: 0,
  };
}

export function orderLineFromQuoteLine(line: QuoteLine): OrderLine {
  return {
    lineId: newId("oline"),
    sku: line.sku,
    description: line.description,
    qty: line.qty,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    taxCategory: line.taxCategory,
    qtyAllocated: 0,
    qtyShipped: 0,
  };
}

/** Order lines share pricing math with quote lines via this projection. */
export function asQuoteLine(line: OrderLine): QuoteLine {
  return {
    lineId: line.lineId,
    sku: line.sku,
    description: line.description,
    qty: line.qty,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    taxCategory: line.taxCategory,
  };
}

export function isFullyAllocated(line: OrderLine): boolean {
  return line.qtyAllocated >= line.qty;
}

export function isFullyShipped(line: OrderLine): boolean {
  return line.qtyShipped >= line.qty;
}
