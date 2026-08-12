import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderLineInput } from "../src/application/purchase-order-service.js";
import { lineInput } from "../src/application/requisition-service.js";
import { ProcurementEvents } from "../src/domain/events.js";
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

function draftOrder(ctx: TestContext, supplierId = registerSupplier(ctx).id) {
  return ctx.module.purchaseOrderService.create(ctx.tenant, {
    supplierId,
    buyerId: BUYER,
    shipTo: "Plant 2, dock B",
    lines: [
      orderLineInput({
        description: "Nitrile gloves, box of 100",
        categoryCode: "IND.OFFICE",
        quantity: 100,
        uom: "BOX",
        unitPriceMinor: 1_200,
        currency: "USD",
        needBy: d("2026-04-15"),
        taxBps: 2_000,
      }),
    ],
  });
}

/** Draft → approved → issued, using the default policy's auto-approve band. */
function issuedOrder(ctx: TestContext, supplierId?: ReturnType<typeof id>) {
  ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "purchase_order", "USD");
  const order = ctx.module.purchaseOrderService.create(ctx.tenant, {
    supplierId: supplierId ?? registerSupplier(ctx).id,
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

describe("purchase orders", () => {
  it("computes net, tax and grand totals from the lines", () => {
    const ctx = buildModule();
    const order = draftOrder(ctx);
    assert.deepEqual(order.netTotal, usd(120_000));
    assert.deepEqual(order.taxTotal, usd(24_000));
    assert.deepEqual(order.grandTotal, usd(144_000));
  });

  it("inherits currency, incoterm and payment terms from the supplier", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const order = draftOrder(ctx, supplier.id);
    assert.equal(order.currency, "USD");
    assert.equal(order.paymentTermsDays, supplier.paymentTermsDays);
  });

  it("refuses to raise an order against a blocked supplier", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    ctx.module.supplierDirectory.block(ctx.tenant, supplier.id, "Sanctions screening");
    assertDomainError(() => draftOrder(ctx, supplier.id), "SUPPLIER_NOT_ORDERABLE");
  });

  it("blocks issuing below the supplier's minimum order value", () => {
    const ctx = buildModule();
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "purchase_order", "USD");
    const supplier = registerSupplier(ctx, { minimumOrderValue: usd(500_000) });
    const order = ctx.module.purchaseOrderService.create(ctx.tenant, {
      supplierId: supplier.id,
      buyerId: BUYER,
      shipTo: "Plant 2",
      lines: [
        orderLineInput({
          description: "Gloves",
          categoryCode: "IND.OFFICE",
          quantity: 10,
          uom: "BOX",
          unitPriceMinor: 1_200,
          currency: "USD",
          needBy: d("2026-04-15"),
        }),
      ],
    });
    ctx.module.purchaseOrderService.submitForApproval(ctx.tenant, order.id);
    assertDomainError(
      () => ctx.module.purchaseOrderService.issue(ctx.tenant, order.id),
      "SUPPLIER_NOT_ORDERABLE",
    );
  });

  it("issues an approved order and emits the supplier-facing event", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    assert.equal(order.status, "issued");
    assertEmitted(ctx.module, ProcurementEvents.PurchaseOrderIssued);
  });

  it("records the supplier acknowledgement with promised dates", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    ctx.module.purchaseOrderService.acknowledge(ctx.tenant, order.id, {
      supplierReference: "SO-55123",
      promisedDates: [{ lineNumber: order.lines[0].lineNumber, promisedDate: d("2026-04-22") }],
    });
    assert.equal(order.status, "acknowledged");
    assert.equal(order.lines[0].promisedDate, "2026-04-22");
  });
});

describe("requisition to order", () => {
  function approvedRequisition(ctx: TestContext) {
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "requisition", "USD");
    const requisition = ctx.module.requisitionService.create(ctx.tenant, {
      title: "Glove demand",
      requesterId: id("user_requester"),
      costCenter: "CC-300",
      currency: "USD",
      neededBy: d("2026-04-15"),
      deliverTo: "Plant 2",
      lines: [
        lineInput({
          description: "Nitrile gloves, box of 100",
          categoryCode: "IND.OFFICE",
          quantity: 100,
          uom: "BOX",
          unitPriceMinor: 1_200,
          currency: "USD",
        }),
      ],
    });
    ctx.module.requisitionService.submit(ctx.tenant, requisition.id);
    const chain = ctx.module.approvalService.pendingForDocument(ctx.tenant, requisition.id);
    if (chain) {
      ctx.module.approvalService.approve(ctx.tenant, chain.id, {
        approverId: id("user_manager"),
        roles: ["manager"],
      });
    }
    return requisition;
  }

  it("reserves the ordered quantity so the same demand cannot be bought twice", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const requisition = approvedRequisition(ctx);
    const line = requisition.lines[0];

    ctx.module.purchaseOrderService.createFromRequisition(ctx.tenant, {
      requisitionId: requisition.id,
      supplierId: supplier.id,
      buyerId: BUYER,
      lineSelections: [{ lineId: line.id, quantity: 60 }],
    });
    assert.equal(line.orderedQuantity, 60);
    assert.equal(line.remainingQuantity, 40);
    assert.equal(requisition.status, "partially_ordered");

    ctx.module.purchaseOrderService.createFromRequisition(ctx.tenant, {
      requisitionId: requisition.id,
      supplierId: supplier.id,
      buyerId: BUYER,
      lineSelections: [{ lineId: line.id }],
    });
    assert.equal(line.remainingQuantity, 0);
    assert.equal(requisition.status, "ordered");
  });

  it("refuses to order more than the requisition asked for", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const requisition = approvedRequisition(ctx);
    assertDomainError(
      () =>
        ctx.module.purchaseOrderService.createFromRequisition(ctx.tenant, {
          requisitionId: requisition.id,
          supplierId: supplier.id,
          buyerId: BUYER,
          lineSelections: [{ lineId: requisition.lines[0].id, quantity: 120 }],
        }),
      "VALIDATION",
    );
  });

  it("returns the coverage to the requisition when the order is cancelled", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const requisition = approvedRequisition(ctx);
    const order = ctx.module.purchaseOrderService.createFromRequisition(ctx.tenant, {
      requisitionId: requisition.id,
      supplierId: supplier.id,
      buyerId: BUYER,
      lineSelections: [{ lineId: requisition.lines[0].id }],
    });
    assert.equal(requisition.lines[0].remainingQuantity, 0);

    ctx.module.purchaseOrderService.cancel(ctx.tenant, order.id, "Supplier withdrew");
    assert.equal(requisition.lines[0].remainingQuantity, 100);
    assert.equal(requisition.status, "approved");
  });
});

describe("change orders", () => {
  it("a small increase revises in place without re-approval", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const { revision } = ctx.module.purchaseOrderService.revise(ctx.tenant, order.id, {
      changedBy: BUYER,
      reason: "Supplier confirmed a slightly higher freight-inclusive price",
      lineChanges: [{ lineId: order.lines[0].id, unitPrice: usd(1_240) }],
    });
    assert.equal(revision.requiredReapproval, false);
    assert.equal(order.status, "issued");
    // Issuing publishes revision 1, so the first change order is revision 2.
    assert.equal(order.revision, 2);
  });

  it("a material increase pushes the order back into approval", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    const { revision } = ctx.module.purchaseOrderService.revise(ctx.tenant, order.id, {
      changedBy: BUYER,
      reason: "Scope increased after a site survey",
      lineChanges: [{ lineId: order.lines[0].id, quantity: 60 }],
    });
    assert.equal(revision.requiredReapproval, true);
    assert.equal(order.status, "pending_approval");
    assert.ok(ctx.module.approvalService.pendingForDocument(ctx.tenant, order.id));
    assertEmitted(ctx.module, ProcurementEvents.PurchaseOrderRevised);
  });

  it("cannot revise a draft order", () => {
    const ctx = buildModule();
    const order = draftOrder(ctx);
    assertDomainError(
      () =>
        ctx.module.purchaseOrderService.revise(ctx.tenant, order.id, {
          changedBy: BUYER,
          reason: "Too early for a change order",
        }),
      "INVALID_STATE",
    );
  });
});

describe("order analytics", () => {
  it("counts issued orders as open commitment until they are received", () => {
    const ctx = buildModule();
    const order = issuedOrder(ctx);
    assert.deepEqual(ctx.module.purchaseOrderService.openCommitment(ctx.tenant, "USD"), usd(24_000));
    assert.equal(ctx.module.purchaseOrderService.listReceivable(ctx.tenant).length, 1);
    assert.equal(order.status, "issued");
  });

  it("lists late lines with how many days they have slipped", () => {
    const ctx = buildModule("2026-03-02");
    issuedOrder(ctx);
    assert.equal(ctx.module.purchaseOrderService.expediteList(ctx.tenant).length, 0);
    ctx.clock.set(d("2026-04-20"));
    const late = ctx.module.purchaseOrderService.expediteList(ctx.tenant);
    assert.equal(late.length, 1);
    assert.equal(late[0].daysLate, 5);
  });
});
