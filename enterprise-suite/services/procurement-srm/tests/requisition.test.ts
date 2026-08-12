import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lineInput } from "../src/application/requisition-service.js";
import { ProcurementEvents } from "../src/domain/events.js";
import {
  assertDomainError,
  assertEmitted,
  buildModule,
  d,
  id,
  plusDays,
  registerSupplier,
  usd,
  type TestContext,
} from "./helpers.js";

function draftRequisition(ctx: TestContext, overrides: { costCenter?: string } = {}) {
  return ctx.module.requisitionService.create(ctx.tenant, {
    title: "Lab consumables",
    requesterId: id("user_scientist"),
    costCenter: overrides.costCenter ?? "CC-300",
    currency: "USD",
    neededBy: d("2026-04-01"),
    deliverTo: "Lab 4",
    lines: [
      lineInput({
        description: "Nitrile gloves, box of 100",
        categoryCode: "IND.OFFICE",
        quantity: 40,
        uom: "BOX",
        unitPriceMinor: 1_250,
        currency: "USD",
      }),
    ],
  });
}

describe("purchase requisitions", () => {
  it("numbers documents per tenant, series and year", () => {
    const ctx = buildModule("2026-03-02");
    const first = draftRequisition(ctx);
    const second = draftRequisition(ctx);
    assert.equal(first.requisitionNumber, "PR-2026-000001");
    assert.equal(second.requisitionNumber, "PR-2026-000002");
  });

  it("totals lines and exposes the categories the approval engine keys on", () => {
    const ctx = buildModule();
    const requisition = draftRequisition(ctx);
    assert.deepEqual(requisition.estimatedTotal, usd(50_000));
    assert.deepEqual(requisition.categoryCodes, ["IND.OFFICE"]);
  });

  it("emits a created event and keeps the aggregate in draft", () => {
    const ctx = buildModule();
    const requisition = draftRequisition(ctx);
    assert.equal(requisition.status, "draft");
    assertEmitted(ctx.module, ProcurementEvents.RequisitionCreated);
  });

  it("refuses to submit an empty requisition", () => {
    const ctx = buildModule();
    const empty = ctx.module.requisitionService.create(ctx.tenant, {
      title: "Nothing yet",
      requesterId: id("user_scientist"),
      costCenter: "CC-300",
      currency: "USD",
      neededBy: d("2026-04-01"),
      deliverTo: "Lab 4",
    });
    assertDomainError(
      () => ctx.module.requisitionService.submit(ctx.tenant, empty.id),
      "VALIDATION",
    );
  });

  it("rejects a suggested supplier that is not in the directory", () => {
    const ctx = buildModule();
    const requisition = draftRequisition(ctx);
    assertDomainError(
      () =>
        ctx.module.requisitionService.addLine(
          ctx.tenant,
          requisition.id,
          lineInput({
            description: "Pipette tips",
            categoryCode: "IND.OFFICE",
            quantity: 10,
            uom: "BOX",
            unitPriceMinor: 900,
            currency: "USD",
            suggestedSupplierId: id("supplier_unknown"),
          }),
        ),
      "VALIDATION",
    );
  });

  it("accepts a suggested supplier that exists", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const requisition = draftRequisition(ctx);
    const line = ctx.module.requisitionService.addLine(
      ctx.tenant,
      requisition.id,
      lineInput({
        description: "Pipette tips",
        categoryCode: "IND.OFFICE",
        quantity: 10,
        uom: "BOX",
        unitPriceMinor: 900,
        currency: "USD",
        suggestedSupplierId: supplier.id,
      }),
    );
    assert.equal(line.suggestedSupplierId, supplier.id);
  });

  it("locks lines once the requisition is out for approval", () => {
    const ctx = buildModule();
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "requisition", "USD");
    const requisition = draftRequisition(ctx);
    ctx.module.requisitionService.submit(ctx.tenant, requisition.id);
    assert.equal(requisition.status, "pending_approval");
    assertDomainError(
      () =>
        ctx.module.requisitionService.addLine(
          ctx.tenant,
          requisition.id,
          lineInput({
            description: "Late addition",
            categoryCode: "IND.OFFICE",
            quantity: 1,
            uom: "EA",
            unitPriceMinor: 100,
            currency: "USD",
          }),
        ),
      "INVALID_STATE",
    );
  });

  it("auto-approves spend inside the no-approval band", () => {
    const ctx = buildModule();
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "requisition", "USD");
    const requisition = ctx.module.requisitionService.create(ctx.tenant, {
      title: "Coffee",
      requesterId: id("user_scientist"),
      costCenter: "CC-300",
      currency: "USD",
      neededBy: d("2026-04-01"),
      deliverTo: "Kitchen",
      lines: [
        lineInput({
          description: "Coffee beans, 1kg",
          categoryCode: "IND.OFFICE",
          quantity: 4,
          uom: "BAG",
          unitPriceMinor: 2_400,
          currency: "USD",
        }),
      ],
    });
    ctx.module.requisitionService.submit(ctx.tenant, requisition.id);
    assert.equal(requisition.status, "approved");
    assertEmitted(ctx.module, ProcurementEvents.RequisitionApproved);
  });

  it("withdrawing a submitted requisition cancels its approval chain", () => {
    const ctx = buildModule();
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "requisition", "USD");
    const requisition = draftRequisition(ctx);
    ctx.module.requisitionService.submit(ctx.tenant, requisition.id);
    const chain = ctx.module.approvalService.pendingForDocument(ctx.tenant, requisition.id);
    assert.ok(chain);

    ctx.module.requisitionService.withdraw(ctx.tenant, requisition.id, "Budget frozen");
    assert.equal(requisition.status, "draft");
    assert.equal(
      ctx.module.approvalService.get(ctx.tenant, chain.id).status,
      "cancelled",
    );
  });

  it("groups open demand by category for the sourcing plan", () => {
    const ctx = buildModule();
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "requisition", "USD");
    const requisition = draftRequisition(ctx);
    ctx.module.requisitionService.submit(ctx.tenant, requisition.id);
    approveEverything(ctx, requisition.id);

    const demand = ctx.module.requisitionService.demandByCategory(ctx.tenant);
    assert.equal(demand.length, 1);
    assert.equal(demand[0].categoryCode, "IND.OFFICE");
    assert.deepEqual(demand[0].estimatedValue, usd(50_000));
  });

  it("flags demand whose need-by date has passed", () => {
    const ctx = buildModule("2026-03-02");
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "requisition", "USD");
    const requisition = draftRequisition(ctx);
    ctx.module.requisitionService.submit(ctx.tenant, requisition.id);
    approveEverything(ctx, requisition.id);

    assert.equal(ctx.module.requisitionService.overdueDemand(ctx.tenant).length, 0);
    ctx.clock.set(plusDays(d("2026-04-01"), 1));
    assert.equal(ctx.module.requisitionService.overdueDemand(ctx.tenant).length, 1);
  });
});

/** Approves every step of the chain currently open on a document. */
function approveEverything(ctx: TestContext, documentId: ReturnType<typeof id>): void {
  for (const roles of [["manager"], ["finance"], ["cfo"]]) {
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, documentId);
    if (!request) return;
    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id(`user_${roles[0]}`),
      roles,
    });
  }
}
