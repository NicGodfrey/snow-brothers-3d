import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoiceLineInput } from "../src/application/matching-service.js";
import { orderLineInput } from "../src/application/purchase-order-service.js";
import { ProcurementEvents } from "../src/domain/events.js";
import type { PurchaseOrder } from "../src/domain/purchase-order.js";
import { MATCH_EXCEPTION_CODES } from "../src/domain/three-way-match.js";
import {
  assertDomainError,
  assertEmitted,
  buildModule,
  d,
  id,
  registerSupplier,
  usd,
  type TestContext,
} from "./helpers.js";

const BUYER = id("user_buyer");
const AP_CLERK = id("user_ap");

/** 20 BOX at 12.00 = 240.00 ordered, issued and ready to receive. */
function issuedOrder(ctx: TestContext, supplierNumber = "SUP-9001"): PurchaseOrder {
  if (ctx.module.approvalService.listPolicies(ctx.tenant, "purchase_order").length === 0) {
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "purchase_order", "USD");
  }
  const supplier = registerSupplier(ctx, { supplierNumber });
  const order = ctx.module.purchaseOrderService.create(ctx.tenant, {
    supplierId: supplier.id,
    buyerId: BUYER,
    shipTo: "Plant 2, dock B",
    lines: [
      orderLineInput({
        description: "Nitrile gloves, box of 100",
        categoryCode: "IND.OFFICE",
        quantity: 20,
        uom: "BOX",
        unitPriceMinor: 1_200,
        currency: "USD",
        needBy: d("2026-04-15"),
      }),
    ],
  });
  ctx.module.purchaseOrderService.submitForApproval(ctx.tenant, order.id);
  ctx.module.purchaseOrderService.issue(ctx.tenant, order.id);
  return order;
}

function receive(ctx: TestContext, order: PurchaseOrder, receivedQuantity: number): void {
  const receipt = ctx.module.receiptService.draft(ctx.tenant, {
    purchaseOrderId: order.id,
    receivedBy: id("user_dock"),
    lines: [
      { purchaseOrderLineNumber: order.lines[0].lineNumber, receivedQuantity },
    ],
  });
  ctx.module.receiptService.post(ctx.tenant, receipt.id);
}

interface InvoiceOptions {
  quantity?: number;
  unitPriceMinor?: number;
  supplierInvoiceNumber?: string;
  declaredTotalMinor?: number;
  purchaseOrderLineNumber?: number;
  freightMinor?: number;
}

function invoiceFor(ctx: TestContext, order: PurchaseOrder, options: InvoiceOptions = {}) {
  const qty = options.quantity ?? 20;
  const unitPriceMinor = options.unitPriceMinor ?? 1_200;
  const freight = options.freightMinor ?? 0;
  const lines = [
    invoiceLineInput({
      description: "Nitrile gloves, box of 100",
      quantity: qty,
      uom: "BOX",
      unitPriceMinor,
      currency: "USD",
      purchaseOrderLineNumber: options.purchaseOrderLineNumber ?? order.lines[0].lineNumber,
    }),
  ];
  if (freight > 0) {
    lines.push(
      invoiceLineInput({
        description: "Expedited freight",
        quantity: 1,
        uom: "EA",
        unitPriceMinor: freight,
        currency: "USD",
        chargeType: "freight",
      }),
    );
  }
  return ctx.module.matchingService.registerAndMatch(ctx.tenant, {
    supplierInvoiceNumber: options.supplierInvoiceNumber ?? "SI-40021",
    supplierId: order.supplierId,
    purchaseOrderId: order.id,
    invoiceDate: d("2026-03-01"),
    declaredTotal: usd(options.declaredTotalMinor ?? qty * unitPriceMinor + freight),
    lines,
  });
}

function codes(result: { exceptions: readonly { code: string }[] }): string[] {
  return result.exceptions.map((exception) => exception.code);
}

describe("three-way match", () => {
  it("matches an invoice that agrees with the order and the receipt", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);

    const { invoice, result } = invoiceFor(ctx, order);

    assert.equal(result.status, "matched");
    assert.equal(result.matchType, "three_way");
    assert.deepEqual(codes(result), []);
    assert.equal(invoice.status, "matched");
    assert.equal(result.summary.invoicedValue.amountMinor, 24_000);
    assert.equal(result.summary.receivedValue.amountMinor, 24_000);
    assert.equal(result.summary.totalVariance.amountMinor, 0);
    assertEmitted(ctx.module, ProcurementEvents.InvoiceMatched);
  });

  it("derives payment terms and due date from the order", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice } = invoiceFor(ctx, order);
    assert.equal(invoice.dueDate, "2026-03-31", "30 day terms off the 1 March invoice date");
  });

  it("accepts price drift inside the order tolerance and blocks beyond it", () => {
    const ctx = buildModule();
    const withinTolerance = issuedOrder(ctx);
    receive(ctx, withinTolerance, 20);
    // Order tolerance is 200bp: 12.24 against 12.00 is exactly 2%.
    const ok = invoiceFor(ctx, withinTolerance, { unitPriceMinor: 1_224 });
    assert.equal(ok.result.status, "matched");

    const overpriced = issuedOrder(ctx, "SUP-9002");
    receive(ctx, overpriced, 20);
    const bad = invoiceFor(ctx, overpriced, {
      unitPriceMinor: 1_300,
      supplierInvoiceNumber: "SI-40022",
    });
    assert.equal(bad.result.status, "exception");
    assert.deepEqual(codes(bad.result), [MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance]);
    assert.equal(bad.result.summary.priceVarianceTotal.amountMinor, 2_000);
    assert.equal(bad.invoice.status, "exception");
    assertEmitted(ctx.module, ProcurementEvents.InvoiceMatchExceptionRaised);
  });

  it("flags a price below the order as a warning that does not block payment", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice, result } = invoiceFor(ctx, order, { unitPriceMinor: 1_000 });

    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.PriceBelowOrder]);
    assert.equal(result.exceptions[0].severity, "warning");
    assert.equal(result.status, "matched");
    assert.equal(invoice.status, "matched");
  });

  it("blocks an invoice for more than was received", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 12);
    const { result } = invoiceFor(ctx, order, { quantity: 20 });

    assert.equal(result.status, "exception");
    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.QuantityExceedsReceived]);
    assert.equal(result.lines[0].receivedQuantity, 12);
    assert.equal(result.lines[0].matched, false);
  });

  it("blocks an invoice for more than was ordered", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 21); // inside the 500bp over-receipt tolerance
    const { result } = invoiceFor(ctx, order, { quantity: 21 });

    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.QuantityExceedsOrdered]);
  });

  it("blocks when nothing has been received and passes on a two-way match", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const threeWay = invoiceFor(ctx, order);
    assert.deepEqual(codes(threeWay.result), [MATCH_EXCEPTION_CODES.NoReceiptRecorded]);

    const twoWay = ctx.module.matchingService.match(ctx.tenant, threeWay.invoice.id, {
      requireReceipt: false,
    });
    assert.equal(twoWay.result.matchType, "two_way");
    assert.equal(twoWay.result.status, "matched");
    assert.equal(twoWay.invoice.status, "matched");
  });

  it("only counts posted receipts", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    ctx.module.receiptService.draft(ctx.tenant, {
      purchaseOrderId: order.id,
      receivedBy: id("user_dock"),
      lines: [{ purchaseOrderLineNumber: order.lines[0].lineNumber, receivedQuantity: 20 }],
    });
    const { result } = invoiceFor(ctx, order);
    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.NoReceiptRecorded]);
  });

  it("reports an invoice line that names a purchase order line that does not exist", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { result } = invoiceFor(ctx, order, { purchaseOrderLineNumber: 999 });

    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.LineNotOnPurchaseOrder]);
    assert.equal(result.lines[0].purchaseOrderLineNumber, 999);
  });

  it("warns about a freight charge that is not on the order", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { result } = invoiceFor(ctx, order, { freightMinor: 4_500 });

    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.UnmatchedCharge]);
    assert.equal(result.exceptions[0].severity, "warning");
    assert.equal(result.status, "matched");
    assert.equal(result.summary.invoicedValue.amountMinor, 28_500);
  });

  it("reconciles the printed header total against the sum of the lines", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { result } = invoiceFor(ctx, order, { declaredTotalMinor: 25_000 });

    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.TotalMismatch]);
    assert.equal(result.summary.totalVariance.amountMinor, 1_000);
  });

  it("tolerates rounding slack on the header total", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { result } = invoiceFor(ctx, order, { declaredTotalMinor: 24_002 });
    assert.deepEqual(codes(result), []);
  });

  it("catches a second invoice carrying the same supplier reference", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    invoiceFor(ctx, order);

    const second = ctx.module.matchingService.registerAndMatch(ctx.tenant, {
      supplierInvoiceNumber: "si 40021", // same reference once normalised
      supplierId: order.supplierId,
      purchaseOrderId: order.id,
      invoiceDate: d("2026-03-02"),
      declaredTotal: usd(24_000),
      lines: [
        invoiceLineInput({
          description: "Nitrile gloves, box of 100",
          quantity: 20,
          uom: "BOX",
          unitPriceMinor: 1_200,
          currency: "USD",
          purchaseOrderLineNumber: order.lines[0].lineNumber,
        }),
      ],
    });
    assert.ok(codes(second.result).includes(MATCH_EXCEPTION_CODES.DuplicateInvoice));
  });

  it("cannot match an invoice with no purchase order", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const { invoice, result } = ctx.module.matchingService.registerAndMatch(ctx.tenant, {
      supplierInvoiceNumber: "SI-90001",
      supplierId: supplier.id,
      invoiceDate: d("2026-03-01"),
      declaredTotal: usd(5_000),
      currency: "USD",
      lines: [
        invoiceLineInput({
          description: "Consultancy",
          quantity: 1,
          uom: "EA",
          unitPriceMinor: 5_000,
          currency: "USD",
        }),
      ],
    });
    assert.deepEqual(codes(result), [MATCH_EXCEPTION_CODES.NoPurchaseOrder]);
    assert.equal(result.matchType, "two_way");
    assert.equal(invoice.status, "exception");
  });

  it("refuses to link an order belonging to another supplier", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const other = registerSupplier(ctx, { supplierNumber: "SUP-9100" });
    const invoice = ctx.module.matchingService.register(ctx.tenant, {
      supplierInvoiceNumber: "SI-77000",
      supplierId: other.id,
      invoiceDate: d("2026-03-01"),
      declaredTotal: usd(24_000),
      currency: "USD",
    });
    assertDomainError(
      () => ctx.module.matchingService.linkPurchaseOrder(ctx.tenant, invoice.id, order.id),
      "VALIDATION",
    );
  });
});

describe("invoice exception handling", () => {
  it("waiving the last blocking exception clears the invoice for payment", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice } = invoiceFor(ctx, order, { unitPriceMinor: 1_300 });

    assertDomainError(
      () => ctx.module.matchingService.approveForPayment(ctx.tenant, invoice.id, AP_CLERK),
      "INVALID_STATE",
    );

    ctx.module.matchingService.resolveException(ctx.tenant, invoice.id, {
      code: MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance,
      lineNumber: 1,
      action: "waived",
      note: "Steel surcharge agreed with the category manager",
      resolvedBy: BUYER,
    });
    assert.equal(invoice.status, "matched");
    assert.equal(invoice.openExceptions.length, 0);

    ctx.module.matchingService.approveForPayment(ctx.tenant, invoice.id, AP_CLERK);
    assert.equal(invoice.status, "approved_for_payment");
    assert.equal(invoice.approvedBy, AP_CLERK);
    assertEmitted(ctx.module, ProcurementEvents.InvoiceApprovedForPayment);
  });

  it("a waived exception stays waived when the match is re-run", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice } = invoiceFor(ctx, order, { unitPriceMinor: 1_300 });
    ctx.module.matchingService.resolveException(ctx.tenant, invoice.id, {
      code: MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance,
      lineNumber: 1,
      action: "waived",
      note: "Approved by the category manager",
      resolvedBy: BUYER,
    });

    const rerun = ctx.module.matchingService.match(ctx.tenant, invoice.id);
    assert.ok(codes(rerun.result).includes(MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance));
    assert.equal(rerun.invoice.openExceptions.length, 0, "resolved exceptions do not reopen");
    assert.equal(rerun.invoice.status, "matched");
  });

  it("re-matching after the receipt arrives clears the blocking exception", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const { invoice } = invoiceFor(ctx, order);
    assert.equal(invoice.status, "exception");

    receive(ctx, order, 20);
    const rerun = ctx.module.matchingService.match(ctx.tenant, invoice.id);
    assert.deepEqual(codes(rerun.result), []);
    assert.equal(rerun.invoice.status, "matched");
  });

  it("cannot resolve an exception that is not open", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice } = invoiceFor(ctx, order);
    assertDomainError(
      () =>
        ctx.module.matchingService.resolveException(ctx.tenant, invoice.id, {
          code: MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance,
          action: "waived",
          note: "Nothing to waive",
          resolvedBy: BUYER,
        }),
      "VALIDATION",
    );
  });

  it("holding an invoice parks it until it is released", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice } = invoiceFor(ctx, order);

    ctx.module.matchingService.hold(ctx.tenant, invoice.id, "Supplier bank details under review");
    assert.equal(invoice.status, "on_hold");
    assertDomainError(
      () => ctx.module.matchingService.approveForPayment(ctx.tenant, invoice.id, AP_CLERK),
      "INVALID_STATE",
    );

    ctx.module.matchingService.release(ctx.tenant, invoice.id);
    assert.equal(invoice.status, "matched");
    ctx.module.matchingService.approveForPayment(ctx.tenant, invoice.id, AP_CLERK);
    assert.equal(invoice.status, "approved_for_payment");
  });

  it("groups the open exceptions into a work queue with counts by code", () => {
    const ctx = buildModule();
    const noReceipt = issuedOrder(ctx);
    invoiceFor(ctx, noReceipt);
    const overpriced = issuedOrder(ctx, "SUP-9002");
    receive(ctx, overpriced, 20);
    invoiceFor(ctx, overpriced, { unitPriceMinor: 1_300, supplierInvoiceNumber: "SI-40099" });

    const queue = ctx.module.matchingService.exceptionQueue(ctx.tenant);
    assert.equal(queue.length, 2);
    const stats = ctx.module.matchingService.exceptionStatistics(ctx.tenant);
    assert.deepEqual(stats.map((entry) => entry.code).sort(), [
      MATCH_EXCEPTION_CODES.NoReceiptRecorded,
      MATCH_EXCEPTION_CODES.PriceVarianceOverTolerance,
    ]);
    assert.ok(stats.every((entry) => entry.count === 1));
  });

  it("lists invoices past their due date until they are approved", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice } = invoiceFor(ctx, order);
    assert.deepEqual(ctx.module.matchingService.overdue(ctx.tenant), []);

    ctx.clock.set(d("2026-05-01"));
    assert.deepEqual(
      ctx.module.matchingService.overdue(ctx.tenant).map((entry) => entry.id),
      [invoice.id],
    );

    ctx.module.matchingService.approveForPayment(ctx.tenant, invoice.id, AP_CLERK);
    assert.deepEqual(ctx.module.matchingService.overdue(ctx.tenant), []);
  });
});

describe("invoiced quantity write-back", () => {
  it("approval records the invoiced quantity on the order line", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { invoice } = invoiceFor(ctx, order);

    assert.equal(
      ctx.module.matchingService.goodsReceivedNotInvoiced(ctx.tenant, order.id).amountMinor,
      24_000,
      "everything received is still uninvoiced before approval",
    );

    ctx.module.matchingService.approveForPayment(ctx.tenant, invoice.id, AP_CLERK);
    assert.equal(order.lines[0].invoicedQuantity, 20);
    assert.equal(order.lines[0].uninvoicedQuantity, 0);
    assert.equal(
      ctx.module.matchingService.goodsReceivedNotInvoiced(ctx.tenant, order.id).amountMinor,
      0,
    );
  });

  it("a second invoice cannot claim quantity the first one already took", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const first = invoiceFor(ctx, order, { quantity: 12, supplierInvoiceNumber: "SI-1" });
    ctx.module.matchingService.approveForPayment(ctx.tenant, first.invoice.id, AP_CLERK);

    const withinBalance = invoiceFor(ctx, order, { quantity: 8, supplierInvoiceNumber: "SI-2" });
    assert.deepEqual(codes(withinBalance.result), []);
    assert.equal(withinBalance.result.lines[0].previouslyInvoicedQuantity, 12);

    const overClaim = invoiceFor(ctx, order, { quantity: 9, supplierInvoiceNumber: "SI-3" });
    assert.deepEqual(codes(overClaim.result).sort(), [
      MATCH_EXCEPTION_CODES.QuantityExceedsOrdered,
      MATCH_EXCEPTION_CODES.QuantityExceedsReceived,
    ]);
  });

  it("splits one invoice across two lines of the same order line", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    receive(ctx, order, 20);
    const { result } = ctx.module.matchingService.registerAndMatch(ctx.tenant, {
      supplierInvoiceNumber: "SI-SPLIT",
      supplierId: order.supplierId,
      purchaseOrderId: order.id,
      invoiceDate: d("2026-03-01"),
      declaredTotal: usd(24_000),
      lines: [
        invoiceLineInput({
          description: "Nitrile gloves, box of 100",
          quantity: 15,
          uom: "BOX",
          unitPriceMinor: 1_200,
          currency: "USD",
          purchaseOrderLineNumber: order.lines[0].lineNumber,
        }),
        invoiceLineInput({
          description: "Nitrile gloves, box of 100 (balance)",
          quantity: 5,
          uom: "BOX",
          unitPriceMinor: 1_200,
          currency: "USD",
          purchaseOrderLineNumber: order.lines[0].lineNumber,
        }),
      ],
    });
    assert.deepEqual(codes(result), []);
    assert.equal(result.lines[1].previouslyInvoicedQuantity, 15, "the second line sees the first");
  });
});
