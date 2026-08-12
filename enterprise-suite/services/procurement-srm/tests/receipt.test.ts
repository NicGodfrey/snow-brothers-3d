import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderLineInput } from "../src/application/purchase-order-service.js";
import { ProcurementEvents } from "../src/domain/events.js";
import type { PurchaseOrder } from "../src/domain/purchase-order.js";
import {
  assertDomainError,
  assertEmitted,
  buildModule,
  d,
  id,
  registerSupplier,
  type TestContext,
} from "./helpers.js";

const RECEIVER = id("user_dock");

function issuedOrder(ctx: TestContext): PurchaseOrder {
  if (ctx.module.approvalService.listPolicies(ctx.tenant, "purchase_order").length === 0) {
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "purchase_order", "USD");
  }
  const supplier = registerSupplier(ctx);
  const order = ctx.module.purchaseOrderService.create(ctx.tenant, {
    supplierId: supplier.id,
    buyerId: id("user_buyer"),
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

function draftReceipt(ctx: TestContext, order: PurchaseOrder, receivedQuantity: number) {
  return ctx.module.receiptService.draft(ctx.tenant, {
    purchaseOrderId: order.id,
    receivedBy: RECEIVER,
    deliveryNoteReference: "DN-8891",
    lines: [
      {
        purchaseOrderLineNumber: order.lines[0].lineNumber,
        receivedQuantity,
      },
    ],
  });
}

describe("goods receipts", () => {
  it("copies unit of measure and description off the order line", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const receipt = draftReceipt(ctx, order, 20);
    assert.equal(receipt.lines[0].uom, "BOX");
    assert.equal(receipt.lines[0].description, order.lines[0].description);
  });

  it("cannot receive against an order that has not been issued", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const draft = ctx.module.purchaseOrderService.create(ctx.tenant, {
      supplierId: supplier.id,
      buyerId: id("user_buyer"),
      shipTo: "Plant 2",
      lines: [
        orderLineInput({
          description: "Gloves",
          categoryCode: "IND.OFFICE",
          quantity: 20,
          uom: "BOX",
          unitPriceMinor: 1_200,
          currency: "USD",
          needBy: d("2026-04-15"),
        }),
      ],
    });
    assertDomainError(() => draftReceipt(ctx, draft, 5), "INVALID_STATE");
  });

  it("leaves the order untouched until the receipt is posted", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    draftReceipt(ctx, order, 20);
    assert.equal(order.lines[0].receivedQuantity, 0);
    assert.equal(order.status, "issued");
  });

  it("posting applies quantity to the order and closes it when complete", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const receipt = draftReceipt(ctx, order, 20);
    ctx.module.receiptService.post(ctx.tenant, receipt.id);

    assert.equal(receipt.status, "posted");
    assert.equal(order.lines[0].receivedQuantity, 20);
    assert.equal(order.lines[0].outstandingQuantity, 0);
    assert.equal(order.status, "received");
    assertEmitted(ctx.module, ProcurementEvents.ReceiptPosted);
  });

  it("a partial delivery leaves the order partially received", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const receipt = draftReceipt(ctx, order, 12);
    ctx.module.receiptService.post(ctx.tenant, receipt.id);
    assert.equal(order.status, "partially_received");
    assert.equal(order.lines[0].outstandingQuantity, 8);
  });

  it("accepts a small over-delivery inside tolerance and refuses a large one", () => {
    const ctx = buildModule();
    const withinTolerance = issuedOrder(ctx);
    // Default tolerance is 500bp, so 21 boxes against 20 is fine.
    const ok = draftReceipt(ctx, withinTolerance, 21);
    ctx.module.receiptService.post(ctx.tenant, ok.id);
    assert.equal(withinTolerance.lines[0].receivedQuantity, 21);

    const strict = issuedOrder(ctx);
    const tooMany = draftReceipt(ctx, strict, 30);
    assertDomainError(
      () => ctx.module.receiptService.post(ctx.tenant, tooMany.id),
      "TOLERANCE_EXCEEDED",
    );
    assert.equal(strict.lines[0].receivedQuantity, 0, "a rejected post leaves nothing applied");
  });

  it("inspection moves quantity from accepted to rejected without changing what arrived", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const receipt = ctx.module.receiptService.draft(ctx.tenant, {
      purchaseOrderId: order.id,
      receivedBy: RECEIVER,
      lines: [
        {
          purchaseOrderLineNumber: order.lines[0].lineNumber,
          receivedQuantity: 20,
          inspectionRequired: true,
        },
      ],
    });
    const line = ctx.module.receiptService.recordInspection(ctx.tenant, receipt.id, {
      lineId: receipt.lines[0].id,
      outcome: "partial",
      rejectedQuantity: 3,
      reason: "Torn packaging",
      inspectorId: id("user_qa"),
    });
    assert.equal(line.receivedQuantity, 20);
    assert.equal(line.acceptedQuantity, 17);
    assert.equal(line.rejectedQuantity, 3);

    ctx.module.receiptService.post(ctx.tenant, receipt.id);
    assert.equal(order.lines[0].acceptedQuantity, 17);
    assert.equal(order.lines[0].outstandingQuantity, 3);
  });

  it("reversing a posted receipt backs the quantity off the order", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const receipt = draftReceipt(ctx, order, 20);
    ctx.module.receiptService.post(ctx.tenant, receipt.id);
    ctx.module.receiptService.reverse(ctx.tenant, receipt.id, "Delivered to the wrong plant");

    assert.equal(receipt.status, "reversed");
    assert.equal(order.lines[0].receivedQuantity, 0);
    assert.equal(order.status, "issued");
  });

  it("cannot reverse a receipt that was never posted", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const receipt = draftReceipt(ctx, order, 20);
    assertDomainError(
      () => ctx.module.receiptService.reverse(ctx.tenant, receipt.id, "Mistake"),
      "INVALID_STATE",
    );
  });

  it("a return to vendor credits the order line back", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const receipt = draftReceipt(ctx, order, 20);
    ctx.module.receiptService.post(ctx.tenant, receipt.id);

    ctx.module.receiptService.returnToVendor(ctx.tenant, receipt.id, {
      lineId: receipt.lines[0].id,
      quantity: 5,
      reason: "Failed incoming inspection at the line",
      rmaReference: "RMA-771",
    });
    assert.equal(receipt.lines[0].netAcceptedQuantity, 15);
    assert.equal(order.lines[0].acceptedQuantity, 15);
    assert.equal(order.lines[0].outstandingQuantity, 5);
  });

  it("measures on-time delivery against the promised date", () => {
    const ctx = buildModule("2026-04-10");
    const order = issuedOrder(ctx);
    const supplierId = order.supplierId;
    const onTimeReceipt = draftReceipt(ctx, order, 10);
    ctx.module.receiptService.post(ctx.tenant, onTimeReceipt.id);
    assert.deepEqual(ctx.module.receiptService.onTimeDeliveryBps(ctx.tenant, supplierId), {
      onTime: 1,
      total: 1,
      bps: 10_000,
    });

    ctx.clock.set(d("2026-04-25"));
    const lateReceipt = draftReceipt(ctx, order, 10);
    ctx.module.receiptService.post(ctx.tenant, lateReceipt.id);
    assert.deepEqual(ctx.module.receiptService.onTimeDeliveryBps(ctx.tenant, supplierId), {
      onTime: 1,
      total: 2,
      bps: 5_000,
    });
  });
});
