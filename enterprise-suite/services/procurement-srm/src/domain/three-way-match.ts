import { money, type Money, type Ulid } from "@enterprise-suite/shared-kernel";
import {
  addQty,
  extendPrice,
  qtyGreater,
  quantity,
  subQty,
  sumQty,
  varianceBps,
  ZERO_QTY,
  type Quantity,
} from "./common.js";
import type { SupplierInvoice } from "./invoice.js";
import type { PurchaseOrder } from "./purchase-order.js";
import type { GoodsReceipt } from "./receipt.js";

/**
 * Exception vocabulary. `blocking` codes stop payment approval until a buyer
 * resolves or waives them; `warning` codes are informational and travel with
 * the invoice for reporting.
 */
export const MATCH_EXCEPTION_CODES = {
  NoPurchaseOrder: "NO_PURCHASE_ORDER",
  PurchaseOrderNotIssued: "PO_NOT_ISSUED",
  SupplierMismatch: "SUPPLIER_MISMATCH",
  CurrencyMismatch: "CURRENCY_MISMATCH",
  DuplicateInvoice: "DUPLICATE_INVOICE",
  LineNotOnPurchaseOrder: "LINE_NOT_ON_PO",
  PriceVarianceOverTolerance: "PRICE_VARIANCE_OVER_TOLERANCE",
  PriceBelowOrder: "PRICE_BELOW_ORDER",
  QuantityExceedsOrdered: "QTY_INVOICED_EXCEEDS_ORDERED",
  QuantityExceedsReceived: "QTY_INVOICED_EXCEEDS_RECEIVED",
  NoReceiptRecorded: "NO_RECEIPT_RECORDED",
  UnmatchedCharge: "UNMATCHED_CHARGE_LINE",
  TotalMismatch: "TOTAL_MISMATCH",
  TaxVariance: "TAX_VARIANCE",
} as const;

export type MatchExceptionCode = (typeof MATCH_EXCEPTION_CODES)[keyof typeof MATCH_EXCEPTION_CODES];

export type MatchSeverity = "blocking" | "warning";

export interface MatchException {
  readonly code: MatchExceptionCode;
  readonly severity: MatchSeverity;
  readonly message: string;
  /** Invoice line number, when the exception is line-scoped. */
  readonly lineNumber?: number;
  readonly details?: Record<string, unknown>;
}

export interface MatchTolerances {
  /** Unit-price drift accepted between invoice and purchase order. */
  readonly priceVarianceBps: number;
  /** Quantity over-invoicing accepted against ordered/received quantity. */
  readonly quantityVarianceBps: number;
  /** Rounding slack between the supplier's stated total and ours, minor units. */
  readonly totalRoundingMinor: number;
  /** When false the match degrades to a two-way (invoice ↔ order) check. */
  readonly requireReceipt: boolean;
}

/**
 * Defaults are a placeholder policy table: a real deployment sources these per
 * supplier / category / spend band. Everything downstream reads the tolerance
 * off the result, so swapping the source changes no other code.
 */
export const DEFAULT_MATCH_TOLERANCES: MatchTolerances = {
  priceVarianceBps: 200,
  quantityVarianceBps: 0,
  totalRoundingMinor: 2,
  requireReceipt: true,
};

export interface LineMatch {
  readonly invoiceLineNumber: number;
  readonly purchaseOrderLineNumber?: number;
  readonly description: string;
  readonly invoicedQuantity: Quantity;
  readonly orderedQuantity?: Quantity;
  readonly receivedQuantity?: Quantity;
  readonly previouslyInvoicedQuantity?: Quantity;
  readonly invoiceUnitPrice: Money;
  readonly orderUnitPrice?: Money;
  readonly priceVarianceBps?: number;
  readonly amountVariance?: Money;
  readonly matched: boolean;
  readonly exceptionCodes: readonly MatchExceptionCode[];
}

export interface MatchSummary {
  readonly orderedValue: Money;
  readonly receivedValue: Money;
  readonly invoicedValue: Money;
  readonly declaredTotal: Money;
  readonly computedTotal: Money;
  readonly totalVariance: Money;
  readonly priceVarianceTotal: Money;
  readonly quantityVarianceTotal: number;
}

export interface MatchResult {
  readonly status: "matched" | "exception";
  readonly matchType: "three_way" | "two_way";
  readonly matchedAt: string;
  readonly tolerances: MatchTolerances;
  readonly lines: readonly LineMatch[];
  readonly exceptions: readonly MatchException[];
  readonly summary: MatchSummary;
}

export interface ThreeWayMatchInput {
  readonly invoice: SupplierInvoice;
  readonly order?: PurchaseOrder;
  /** Only posted receipts count toward the received quantity. */
  readonly receipts?: readonly GoodsReceipt[];
  readonly tolerances?: Partial<MatchTolerances>;
  /** Ids of other invoices sharing this supplier + normalised reference. */
  readonly duplicateInvoiceIds?: readonly Ulid[];
}

/**
 * Runs the invoice ↔ purchase order ↔ goods receipt match.
 *
 * The engine is pure: it reads the three documents and returns a verdict, so
 * it can be replayed for audit or dry-run in a "what if I raise the price
 * tolerance" tool without touching aggregate state.
 *
 * Quantities already invoiced on the purchase order lines are honoured, so a
 * second invoice against the same line cannot re-claim the same receipt.
 */
export function runThreeWayMatch(input: ThreeWayMatchInput): MatchResult {
  const tolerances: MatchTolerances = { ...DEFAULT_MATCH_TOLERANCES, ...input.tolerances };
  const { invoice, order } = input;
  const currency = invoice.currency;
  const exceptions: MatchException[] = [];
  const lines: LineMatch[] = [];

  if ((input.duplicateInvoiceIds ?? []).length > 0) {
    exceptions.push({
      code: MATCH_EXCEPTION_CODES.DuplicateInvoice,
      severity: "blocking",
      message: `Supplier reference ${invoice.supplierInvoiceNumber} is already registered on ${input.duplicateInvoiceIds?.length} other invoice(s)`,
      details: { duplicateInvoiceIds: [...(input.duplicateInvoiceIds ?? [])] },
    });
  }

  if (!order) {
    exceptions.push({
      code: MATCH_EXCEPTION_CODES.NoPurchaseOrder,
      severity: "blocking",
      message: `Invoice ${invoice.invoiceNumber} is not linked to a purchase order`,
    });
    return unmatchable(invoice, tolerances, exceptions, currency);
  }

  if (order.supplierId !== invoice.supplierId) {
    exceptions.push({
      code: MATCH_EXCEPTION_CODES.SupplierMismatch,
      severity: "blocking",
      message: `Invoice supplier ${invoice.supplierId} differs from purchase order supplier ${order.supplierId}`,
      details: { invoiceSupplierId: invoice.supplierId, orderSupplierId: order.supplierId },
    });
  }

  if (order.currency !== currency) {
    // Cross-currency AP needs an FX rate source, which lives in finance-erp;
    // procurement refuses the match rather than guessing a rate.
    exceptions.push({
      code: MATCH_EXCEPTION_CODES.CurrencyMismatch,
      severity: "blocking",
      message: `Invoice is in ${currency} but purchase order ${order.orderNumber} is in ${order.currency}`,
      details: { invoiceCurrency: currency, orderCurrency: order.currency },
    });
    return unmatchable(invoice, tolerances, exceptions, currency);
  }

  if (["draft", "pending_approval"].includes(order.status)) {
    exceptions.push({
      code: MATCH_EXCEPTION_CODES.PurchaseOrderNotIssued,
      severity: "blocking",
      message: `Purchase order ${order.orderNumber} is ${order.status}; it has not been issued to the supplier`,
      details: { orderStatus: order.status },
    });
  }

  const postedReceipts = (input.receipts ?? []).filter(
    (receipt) => receipt.status === "posted" && receipt.purchaseOrderId === order.id,
  );
  const receivedByLine = new Map<number, Quantity>();
  for (const receipt of postedReceipts) {
    for (const receiptLine of receipt.lines) {
      const current = receivedByLine.get(receiptLine.purchaseOrderLineNumber) ?? ZERO_QTY;
      receivedByLine.set(
        receiptLine.purchaseOrderLineNumber,
        addQty(current, receiptLine.netAcceptedQuantity),
      );
    }
  }
  const matchType: MatchResult["matchType"] = tolerances.requireReceipt ? "three_way" : "two_way";

  let priceVarianceTotalMinor = 0;
  let quantityVarianceTotal = 0;
  const invoicedByOrderLine = new Map<number, Quantity>();

  for (const invoiceLine of invoice.lines) {
    const lineExceptions: MatchExceptionCode[] = [];

    if (invoiceLine.chargeType !== "goods") {
      // Freight and misc charges have no order line; they are flagged for a
      // human unless the order explicitly carries a matching charge line.
      const chargeOnOrder = order.lines.some(
        (orderLine) => orderLine.description.toLowerCase() === invoiceLine.description.toLowerCase(),
      );
      if (!chargeOnOrder) {
        lineExceptions.push(MATCH_EXCEPTION_CODES.UnmatchedCharge);
        exceptions.push({
          code: MATCH_EXCEPTION_CODES.UnmatchedCharge,
          severity: "warning",
          message: `${invoiceLine.chargeType} charge "${invoiceLine.description}" is not on purchase order ${order.orderNumber}`,
          lineNumber: invoiceLine.lineNumber,
          details: { amount: invoiceLine.netAmount },
        });
      }
      lines.push({
        invoiceLineNumber: invoiceLine.lineNumber,
        description: invoiceLine.description,
        invoicedQuantity: invoiceLine.quantity,
        invoiceUnitPrice: invoiceLine.unitPrice,
        matched: lineExceptions.length === 0,
        exceptionCodes: lineExceptions,
      });
      continue;
    }

    const orderLine =
      invoiceLine.purchaseOrderLineNumber === undefined
        ? undefined
        : order.lines.find((line) => line.lineNumber === invoiceLine.purchaseOrderLineNumber);

    if (!orderLine) {
      lineExceptions.push(MATCH_EXCEPTION_CODES.LineNotOnPurchaseOrder);
      exceptions.push({
        code: MATCH_EXCEPTION_CODES.LineNotOnPurchaseOrder,
        severity: "blocking",
        message:
          invoiceLine.purchaseOrderLineNumber === undefined
            ? `Invoice line ${invoiceLine.lineNumber} does not reference a purchase order line`
            : `Purchase order ${order.orderNumber} has no line ${invoiceLine.purchaseOrderLineNumber}`,
        lineNumber: invoiceLine.lineNumber,
        details: { purchaseOrderLineNumber: invoiceLine.purchaseOrderLineNumber },
      });
      lines.push({
        invoiceLineNumber: invoiceLine.lineNumber,
        purchaseOrderLineNumber: invoiceLine.purchaseOrderLineNumber,
        description: invoiceLine.description,
        invoicedQuantity: invoiceLine.quantity,
        invoiceUnitPrice: invoiceLine.unitPrice,
        matched: false,
        exceptionCodes: lineExceptions,
      });
      continue;
    }

    // Price check against the discounted order price.
    const orderUnitPrice = orderLine.netUnitPrice;
    const priceVariance = varianceBps(
      invoiceLine.unitPrice.amountMinor,
      orderUnitPrice.amountMinor,
    );
    if (priceVariance > tolerances.priceVarianceBps) {
      lineExceptions.push(MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance);
      exceptions.push({
        code: MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance,
        severity: "blocking",
        message: `Invoice line ${invoiceLine.lineNumber} is priced at ${invoiceLine.unitPrice.amountMinor} against ${orderUnitPrice.amountMinor} on the order (${(priceVariance / 100).toFixed(2)}% over the ${(tolerances.priceVarianceBps / 100).toFixed(2)}% tolerance)`,
        lineNumber: invoiceLine.lineNumber,
        details: {
          invoiceUnitPrice: invoiceLine.unitPrice,
          orderUnitPrice,
          varianceBps: priceVariance,
          toleranceBps: tolerances.priceVarianceBps,
        },
      });
    } else if (priceVariance < -tolerances.priceVarianceBps) {
      lineExceptions.push(MATCH_EXCEPTION_CODES.PriceBelowOrder);
      exceptions.push({
        code: MATCH_EXCEPTION_CODES.PriceBelowOrder,
        severity: "warning",
        message: `Invoice line ${invoiceLine.lineNumber} is cheaper than ordered (${(priceVariance / 100).toFixed(2)}%)`,
        lineNumber: invoiceLine.lineNumber,
        details: { varianceBps: priceVariance },
      });
    }
    priceVarianceTotalMinor +=
      extendPrice(invoiceLine.unitPrice, invoiceLine.quantity).amountMinor -
      extendPrice(orderUnitPrice, invoiceLine.quantity).amountMinor;

    // Quantity checks. Quantity already invoiced on the order line is added to
    // what earlier lines of *this* invoice claimed for the same order line.
    const alreadyInvoiced = addQty(
      orderLine.invoicedQuantity,
      invoicedByOrderLine.get(orderLine.lineNumber) ?? ZERO_QTY,
    );
    const cumulative = addQty(alreadyInvoiced, invoiceLine.quantity);
    const orderedLimit = quantity(orderLine.quantity * (1 + tolerances.quantityVarianceBps / 10_000));
    if (qtyGreater(cumulative, orderedLimit)) {
      lineExceptions.push(MATCH_EXCEPTION_CODES.QuantityExceedsOrdered);
      exceptions.push({
        code: MATCH_EXCEPTION_CODES.QuantityExceedsOrdered,
        severity: "blocking",
        message: `Invoice line ${invoiceLine.lineNumber} takes invoiced quantity on order line ${orderLine.lineNumber} to ${cumulative} ${orderLine.uom} against ${orderLine.quantity} ordered`,
        lineNumber: invoiceLine.lineNumber,
        details: {
          orderedQuantity: orderLine.quantity,
          previouslyInvoiced: alreadyInvoiced,
          invoicedQuantity: invoiceLine.quantity,
        },
      });
    }

    const received = receivedByLine.get(orderLine.lineNumber) ?? ZERO_QTY;
    if (tolerances.requireReceipt) {
      if (received <= 0) {
        lineExceptions.push(MATCH_EXCEPTION_CODES.NoReceiptRecorded);
        exceptions.push({
          code: MATCH_EXCEPTION_CODES.NoReceiptRecorded,
          severity: "blocking",
          message: `No posted receipt covers order line ${orderLine.lineNumber} (${orderLine.description})`,
          lineNumber: invoiceLine.lineNumber,
          details: { purchaseOrderLineNumber: orderLine.lineNumber },
        });
      } else {
        const receivedLimit = quantity(received * (1 + tolerances.quantityVarianceBps / 10_000));
        if (qtyGreater(cumulative, receivedLimit)) {
          lineExceptions.push(MATCH_EXCEPTION_CODES.QuantityExceedsReceived);
          exceptions.push({
            code: MATCH_EXCEPTION_CODES.QuantityExceedsReceived,
            severity: "blocking",
            message: `Invoice line ${invoiceLine.lineNumber} claims ${cumulative} ${orderLine.uom} against ${received} received on order line ${orderLine.lineNumber}`,
            lineNumber: invoiceLine.lineNumber,
            details: {
              receivedQuantity: received,
              previouslyInvoiced: alreadyInvoiced,
              invoicedQuantity: invoiceLine.quantity,
            },
          });
        }
      }
    }

    quantityVarianceTotal += invoiceLine.quantity - Math.min(invoiceLine.quantity, received);
    invoicedByOrderLine.set(
      orderLine.lineNumber,
      addQty(invoicedByOrderLine.get(orderLine.lineNumber) ?? ZERO_QTY, invoiceLine.quantity),
    );

    lines.push({
      invoiceLineNumber: invoiceLine.lineNumber,
      purchaseOrderLineNumber: orderLine.lineNumber,
      description: invoiceLine.description,
      invoicedQuantity: invoiceLine.quantity,
      orderedQuantity: orderLine.quantity,
      receivedQuantity: received,
      previouslyInvoicedQuantity: alreadyInvoiced,
      invoiceUnitPrice: invoiceLine.unitPrice,
      orderUnitPrice,
      priceVarianceBps: priceVariance,
      amountVariance: money(
        extendPrice(invoiceLine.unitPrice, invoiceLine.quantity).amountMinor -
          extendPrice(orderUnitPrice, invoiceLine.quantity).amountMinor,
        currency,
      ),
      matched: lineExceptions.length === 0,
      exceptionCodes: lineExceptions,
    });
  }

  // Header reconciliation: what the supplier printed vs what their own lines add up to.
  const computedTotal = invoice.computedTotal;
  const totalVarianceMinor = invoice.declaredTotal.amountMinor - computedTotal.amountMinor;
  if (Math.abs(totalVarianceMinor) > tolerances.totalRoundingMinor) {
    exceptions.push({
      code: MATCH_EXCEPTION_CODES.TotalMismatch,
      severity: "blocking",
      message: `Invoice header total ${invoice.declaredTotal.amountMinor} does not equal the sum of its lines ${computedTotal.amountMinor}`,
      details: {
        declaredTotal: invoice.declaredTotal,
        computedTotal,
        varianceMinor: totalVarianceMinor,
      },
    });
  }

  if (invoice.declaredTaxTotal) {
    const taxVariance = invoice.declaredTaxTotal.amountMinor - invoice.computedTaxTotal.amountMinor;
    if (Math.abs(taxVariance) > tolerances.totalRoundingMinor) {
      // Tax determination is a stub here: line rates come straight off the
      // invoice, so a mismatch is reported rather than recalculated.
      exceptions.push({
        code: MATCH_EXCEPTION_CODES.TaxVariance,
        severity: "warning",
        message: `Declared tax ${invoice.declaredTaxTotal.amountMinor} differs from the ${invoice.computedTaxTotal.amountMinor} implied by the line rates`,
        details: {
          declaredTaxTotal: invoice.declaredTaxTotal,
          computedTaxTotal: invoice.computedTaxTotal,
          varianceMinor: taxVariance,
        },
      });
    }
  }

  const receivedValueMinor = order.lines.reduce((total, orderLine) => {
    const received = receivedByLine.get(orderLine.lineNumber) ?? ZERO_QTY;
    return total + extendPrice(orderLine.netUnitPrice, received).amountMinor;
  }, 0);

  const summary: MatchSummary = {
    orderedValue: order.netTotal,
    receivedValue: money(receivedValueMinor, currency),
    invoicedValue: invoice.computedNetTotal,
    declaredTotal: invoice.declaredTotal,
    computedTotal,
    totalVariance: money(totalVarianceMinor, currency),
    priceVarianceTotal: money(priceVarianceTotalMinor, currency),
    quantityVarianceTotal: Math.round(quantityVarianceTotal * 1e6) / 1e6,
  };

  return {
    status: exceptions.some((exception) => exception.severity === "blocking") ? "exception" : "matched",
    matchType,
    matchedAt: new Date().toISOString(),
    tolerances,
    lines,
    exceptions,
    summary,
  };
}

function unmatchable(
  invoice: SupplierInvoice,
  tolerances: MatchTolerances,
  exceptions: readonly MatchException[],
  currency: string,
): MatchResult {
  const zero = money(0, currency);
  return {
    status: "exception",
    matchType: "two_way",
    matchedAt: new Date().toISOString(),
    tolerances,
    lines: invoice.lines.map((line) => ({
      invoiceLineNumber: line.lineNumber,
      purchaseOrderLineNumber: line.purchaseOrderLineNumber,
      description: line.description,
      invoicedQuantity: line.quantity,
      invoiceUnitPrice: line.unitPrice,
      matched: false,
      exceptionCodes: [],
    })),
    exceptions: [...exceptions],
    summary: {
      orderedValue: zero,
      receivedValue: zero,
      invoicedValue: invoice.computedNetTotal,
      declaredTotal: invoice.declaredTotal,
      computedTotal: invoice.computedTotal,
      totalVariance: money(
        invoice.declaredTotal.amountMinor - invoice.computedTotal.amountMinor,
        currency,
      ),
      priceVarianceTotal: zero,
      quantityVarianceTotal: 0,
    },
  };
}

/** Convenience predicate used by services and routes. */
export function hasBlocking(result: MatchResult): boolean {
  return result.exceptions.some((exception) => exception.severity === "blocking");
}

/** Total accepted quantity for an order line across posted receipts. */
export function receivedQuantityForLine(
  receipts: readonly GoodsReceipt[],
  purchaseOrderId: Ulid,
  purchaseOrderLineNumber: number,
): Quantity {
  return sumQty(
    receipts
      .filter((receipt) => receipt.status === "posted" && receipt.purchaseOrderId === purchaseOrderId)
      .flatMap((receipt) =>
        receipt.lines
          .filter((line) => line.purchaseOrderLineNumber === purchaseOrderLineNumber)
          .map((line) => line.netAcceptedQuantity),
      ),
  );
}

/** Quantity still awaiting an invoice on an order line. */
export function uninvoicedQuantity(received: Quantity, invoiced: Quantity): Quantity {
  return subQty(received, invoiced);
}
