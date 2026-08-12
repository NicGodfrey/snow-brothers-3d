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
  usd,
  type TestContext,
} from "./helpers.js";

const BUYER = id("user_buyer");

function twoSuppliers(ctx: TestContext) {
  const cheap = ctx.module.supplierDirectory.register(ctx.tenant, {
    supplierNumber: "SUP-A",
    legalName: "Cheap But Slow Ltd",
    currency: "USD",
    status: "active",
    categories: ["RAW.STEEL"],
    qualityScoreBps: 7_500,
    riskTier: "high",
    paymentTermsDays: 30,
  });
  const solid = ctx.module.supplierDirectory.register(ctx.tenant, {
    supplierNumber: "SUP-B",
    legalName: "Solid Supply Co",
    currency: "USD",
    status: "active",
    categories: ["RAW.STEEL"],
    qualityScoreBps: 9_800,
    riskTier: "low",
    paymentTermsDays: 45,
  });
  return { cheap, solid };
}

function issuedRfq(ctx: TestContext, suppliers: ReturnType<typeof twoSuppliers>) {
  const rfq = ctx.module.sourcingService.createRfq(ctx.tenant, {
    title: "Steel plate tender",
    buyerId: BUYER,
    currency: "USD",
    responseDeadline: d("2026-03-20"),
    deliveryLocation: "Plant 2",
    sealed: false,
    lines: [
      {
        description: "S355 plate 12mm",
        categoryCode: "RAW.STEEL",
        quantity: 10,
        uom: "TONNE",
        requiredBy: d("2026-05-01"),
      },
      {
        description: "S355 beam IPE300",
        categoryCode: "RAW.STEEL",
        quantity: 5,
        uom: "TONNE",
        requiredBy: d("2026-05-01"),
      },
    ],
  });
  ctx.module.sourcingService.inviteSupplier(ctx.tenant, rfq.id, suppliers.cheap.id);
  ctx.module.sourcingService.inviteSupplier(ctx.tenant, rfq.id, suppliers.solid.id);
  ctx.module.sourcingService.issueRfq(ctx.tenant, rfq.id);
  return rfq;
}

describe("request for quote", () => {
  it("will not issue without lines or invitations", () => {
    const ctx = buildModule();
    const bare = ctx.module.sourcingService.createRfq(ctx.tenant, {
      title: "Empty tender",
      buyerId: BUYER,
      currency: "USD",
      responseDeadline: d("2026-03-20"),
      deliveryLocation: "Plant 2",
    });
    assertDomainError(() => ctx.module.sourcingService.issueRfq(ctx.tenant, bare.id), "VALIDATION");
  });

  it("refuses to invite a blocked supplier", () => {
    const ctx = buildModule();
    const { cheap } = twoSuppliers(ctx);
    ctx.module.supplierDirectory.block(ctx.tenant, cheap.id, "Failed audit");
    const rfq = ctx.module.sourcingService.createRfq(ctx.tenant, {
      title: "Steel tender",
      buyerId: BUYER,
      currency: "USD",
      responseDeadline: d("2026-03-20"),
      deliveryLocation: "Plant 2",
    });
    assertDomainError(
      () => ctx.module.sourcingService.inviteSupplier(ctx.tenant, rfq.id, cheap.id),
      "SUPPLIER_NOT_ORDERABLE",
    );
  });

  it("invites every active supplier covering the RFQ categories", () => {
    const ctx = buildModule();
    twoSuppliers(ctx);
    ctx.module.supplierDirectory.register(ctx.tenant, {
      supplierNumber: "SUP-C",
      legalName: "Office Only Inc",
      currency: "USD",
      status: "active",
      categories: ["IND.OFFICE"],
    });
    const rfq = ctx.module.sourcingService.createRfq(ctx.tenant, {
      title: "Steel tender",
      buyerId: BUYER,
      currency: "USD",
      responseDeadline: d("2026-03-20"),
      deliveryLocation: "Plant 2",
      lines: [
        {
          description: "S355 plate 12mm",
          categoryCode: "RAW.STEEL",
          quantity: 10,
          uom: "TONNE",
          requiredBy: d("2026-05-01"),
        },
      ],
    });
    ctx.module.sourcingService.inviteByCategory(ctx.tenant, rfq.id);
    assert.equal(rfq.invitations.length, 2);
  });

  it("builds an RFQ from a requisition and marks those lines as sourcing", () => {
    const ctx = buildModule();
    twoSuppliers(ctx);
    ctx.module.approvalService.createDefaultPolicy(ctx.tenant, "requisition", "USD");
    const requisition = ctx.module.requisitionService.create(ctx.tenant, {
      title: "Steel demand",
      requesterId: id("user_eng"),
      costCenter: "CC-200",
      currency: "USD",
      neededBy: d("2026-05-01"),
      deliverTo: "Plant 2",
      lines: [
        lineInput({
          description: "S355 plate 12mm",
          categoryCode: "RAW.STEEL",
          quantity: 10,
          uom: "TONNE",
          unitPriceMinor: 80_000,
          currency: "USD",
        }),
      ],
    });
    ctx.module.requisitionService.submit(ctx.tenant, requisition.id);
    const chain = ctx.module.approvalService.pendingForDocument(ctx.tenant, requisition.id);
    assert.ok(chain);
    ctx.module.approvalService.approve(ctx.tenant, chain.id, {
      approverId: id("user_manager"),
      roles: ["manager"],
    });

    const rfq = ctx.module.sourcingService.createRfqFromRequisition(ctx.tenant, {
      requisitionId: requisition.id,
      buyerId: BUYER,
      responseDeadline: d("2026-03-20"),
    });
    assert.equal(rfq.lines.length, 1);
    assert.equal(rfq.lines[0].requisitionLineId, requisition.lines[0].id);
    assert.equal(requisition.lines[0].status, "sourcing");
  });

  it("rejects a quote from an uninvited supplier", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const other = ctx.module.supplierDirectory.register(ctx.tenant, {
      supplierNumber: "SUP-D",
      legalName: "Gatecrasher Ltd",
      currency: "USD",
      status: "active",
      categories: ["RAW.STEEL"],
    });
    const rfq = issuedRfq(ctx, suppliers);
    assertDomainError(
      () =>
        ctx.module.sourcingService.submitQuote(ctx.tenant, {
          rfqId: rfq.id,
          supplierId: other.id,
          validUntil: d("2026-04-30"),
          lines: [{ rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 20 }],
        }),
      "VALIDATION",
    );
  });

  it("rejects quotes once the deadline has passed", () => {
    const ctx = buildModule("2026-03-02");
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    ctx.clock.set(d("2026-03-21"));
    assertDomainError(
      () =>
        ctx.module.sourcingService.submitQuote(ctx.tenant, {
          rfqId: rfq.id,
          supplierId: suppliers.cheap.id,
          validUntil: d("2026-04-30"),
          lines: [{ rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 20 }],
        }),
      "INVALID_STATE",
    );
  });

  it("a resubmission revises the supplier's existing quote rather than adding a rival", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    const first = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.cheap.id,
      validUntil: d("2026-04-30"),
      lines: [{ rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 25 }],
    });
    const second = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.cheap.id,
      validUntil: d("2026-04-30"),
      lines: [{ rfqLineNumber: 10, unitPrice: usd(68_000), quantity: 10, uom: "TONNE", leadTimeDays: 25 }],
    });
    assert.equal(first.id, second.id);
    assert.equal(ctx.module.sourcingService.listQuotes(ctx.tenant, { rfqId: rfq.id }).length, 1);
    assert.deepEqual(second.lines[0].netUnitPrice, usd(68_000));
  });

  it("keeps sealed bids hidden until the RFQ closes", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const rfq = ctx.module.sourcingService.createRfq(ctx.tenant, {
      title: "Sealed steel tender",
      buyerId: BUYER,
      currency: "USD",
      responseDeadline: d("2026-03-20"),
      deliveryLocation: "Plant 2",
      sealed: true,
      lines: [
        {
          description: "S355 plate 12mm",
          categoryCode: "RAW.STEEL",
          quantity: 10,
          uom: "TONNE",
          requiredBy: d("2026-05-01"),
        },
      ],
    });
    ctx.module.sourcingService.inviteSupplier(ctx.tenant, rfq.id, suppliers.cheap.id);
    ctx.module.sourcingService.issueRfq(ctx.tenant, rfq.id);
    assertDomainError(
      () => ctx.module.sourcingService.evaluate(ctx.tenant, rfq.id),
      "INVALID_STATE",
    );
    ctx.module.sourcingService.closeRfq(ctx.tenant, rfq.id, "Deadline reached");
    assert.ok(ctx.module.sourcingService.evaluate(ctx.tenant, rfq.id));
  });
});

describe("quote evaluation", () => {
  function bothQuotes(ctx: TestContext, suppliers: ReturnType<typeof twoSuppliers>, rfqId: ReturnType<typeof id>) {
    const cheapQuote = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId,
      supplierId: suppliers.cheap.id,
      validUntil: d("2026-04-30"),
      lines: [
        { rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 45 },
        { rfqLineNumber: 20, unitPrice: usd(88_000), quantity: 5, uom: "TONNE", leadTimeDays: 45 },
      ],
    });
    const solidQuote = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId,
      supplierId: suppliers.solid.id,
      validUntil: d("2026-04-30"),
      lines: [
        { rfqLineNumber: 10, unitPrice: usd(76_000), quantity: 10, uom: "TONNE", leadTimeDays: 10 },
        { rfqLineNumber: 20, unitPrice: usd(84_000), quantity: 5, uom: "TONNE", leadTimeDays: 10 },
      ],
    });
    return { cheapQuote, solidQuote };
  }

  it("prices every bid onto the RFQ quantities and ranks them", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    const { cheapQuote } = bothQuotes(ctx, suppliers, rfq.id);

    const evaluation = ctx.module.sourcingService.evaluate(ctx.tenant, rfq.id);
    assert.equal(evaluation.scorecards.length, 2);
    assert.deepEqual(evaluation.scorecards.map((card) => card.rank), [1, 2]);

    const cheapCard = evaluation.scorecards.find((card) => card.quoteId === cheapQuote.id);
    assert.ok(cheapCard);
    // 10 tonnes at 700.00 plus 5 at 880.00.
    assert.deepEqual(cheapCard.comparableValue, usd(700_000 + 440_000));
    assert.equal(cheapCard.coverageBps, 10_000);
  });

  it("scores lead time and quality, not just price", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    const { cheapQuote, solidQuote } = bothQuotes(ctx, suppliers, rfq.id);

    const evaluation = ctx.module.sourcingService.evaluate(ctx.tenant, rfq.id);
    const cheapCard = evaluation.scorecards.find((card) => card.quoteId === cheapQuote.id);
    const solidCard = evaluation.scorecards.find((card) => card.quoteId === solidQuote.id);
    assert.ok(cheapCard && solidCard);
    assert.ok(cheapCard.priceScoreBps > solidCard.priceScoreBps, "cheaper bid wins on price");
    assert.ok(solidCard.leadTimeScoreBps > cheapCard.leadTimeScoreBps, "faster bid wins on lead time");
    assert.ok(solidCard.qualityScoreBps > cheapCard.qualityScoreBps, "better scorecard wins on quality");
  });

  it("compares line by line and recommends a split when it is cheaper", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    bothQuotes(ctx, suppliers, rfq.id);

    const evaluation = ctx.module.sourcingService.evaluate(ctx.tenant, rfq.id);
    assert.equal(evaluation.lineComparisons.length, 2);
    assert.deepEqual(evaluation.lineComparisons[0].bestSupplierId, suppliers.cheap.id);
    assert.deepEqual(evaluation.lineComparisons[1].bestSupplierId, suppliers.solid.id);
    assert.ok(evaluation.splitAward);
    assert.equal(evaluation.splitAward.supplierCount, 2);
    assert.ok(evaluation.splitAward.savingVsSingleAward.amountMinor > 0);
  });

  it("excludes quotes that have expired by the evaluation date", () => {
    const ctx = buildModule("2026-03-02");
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.cheap.id,
      validUntil: d("2026-03-10"),
      lines: [{ rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 45 }],
    });
    const evaluation = ctx.module.sourcingService.evaluate(ctx.tenant, rfq.id, {
      onDate: d("2026-03-15"),
    });
    assert.equal(evaluation.scorecards.length, 0);
    assert.equal(evaluation.excludedQuotes.length, 1);
  });
});

describe("award", () => {
  it("raises one purchase order per winning supplier and accepts their quote", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    const cheapQuote = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.cheap.id,
      validUntil: d("2026-04-30"),
      lines: [{ rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 45 }],
    });
    const solidQuote = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.solid.id,
      validUntil: d("2026-04-30"),
      lines: [{ rfqLineNumber: 20, unitPrice: usd(84_000), quantity: 5, uom: "TONNE", leadTimeDays: 10 }],
    });

    const result = ctx.module.sourcingService.award(ctx.tenant, rfq.id, {
      awardedBy: BUYER,
      decisions: [
        { quoteId: cheapQuote.id, lineNumbers: [10] },
        { quoteId: solidQuote.id, lineNumbers: [20] },
      ],
    });

    assert.equal(result.purchaseOrders.length, 2);
    assert.equal(rfq.status, "awarded");
    assert.equal(cheapQuote.status, "accepted");
    assert.deepEqual(result.awardedValue, usd(700_000 + 420_000));
    assert.deepEqual(result.purchaseOrders[0].lines[0].unitPrice, usd(70_000));
    assertEmitted(ctx.module, ProcurementEvents.RfqAwarded);
    assertEmitted(ctx.module, ProcurementEvents.PurchaseOrderCreated);
  });

  it("will not award an expired quote", () => {
    const ctx = buildModule("2026-03-02");
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    const quote = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.cheap.id,
      validUntil: d("2026-03-10"),
      lines: [{ rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 45 }],
    });
    ctx.clock.set(d("2026-03-15"));
    assertDomainError(
      () =>
        ctx.module.sourcingService.award(ctx.tenant, rfq.id, {
          awardedBy: BUYER,
          decisions: [{ quoteId: quote.id, lineNumbers: [10] }],
        }),
      "INVALID_STATE",
    );
  });

  it("rejects the losing bids when asked", () => {
    const ctx = buildModule();
    const suppliers = twoSuppliers(ctx);
    const rfq = issuedRfq(ctx, suppliers);
    const winner = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.cheap.id,
      validUntil: d("2026-04-30"),
      lines: [
        { rfqLineNumber: 10, unitPrice: usd(70_000), quantity: 10, uom: "TONNE", leadTimeDays: 45 },
        { rfqLineNumber: 20, unitPrice: usd(88_000), quantity: 5, uom: "TONNE", leadTimeDays: 45 },
      ],
    });
    const loser = ctx.module.sourcingService.submitQuote(ctx.tenant, {
      rfqId: rfq.id,
      supplierId: suppliers.solid.id,
      validUntil: d("2026-04-30"),
      lines: [
        { rfqLineNumber: 10, unitPrice: usd(90_000), quantity: 10, uom: "TONNE", leadTimeDays: 10 },
        { rfqLineNumber: 20, unitPrice: usd(99_000), quantity: 5, uom: "TONNE", leadTimeDays: 10 },
      ],
    });

    ctx.module.sourcingService.award(ctx.tenant, rfq.id, {
      awardedBy: BUYER,
      decisions: [{ quoteId: winner.id, lineNumbers: [10, 20] }],
      rejectOthers: true,
    });
    assert.equal(loser.status, "rejected");
  });
});
