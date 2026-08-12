import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateAgreementInput } from "../src/application/agreement-service.js";
import {
  priceTier,
  type BlanketAgreement,
} from "../src/domain/blanket-agreement.js";
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

const OWNER = id("user_category_manager");
const BUYER = id("user_buyer");

function agreementInput(
  supplierId: ReturnType<typeof id>,
  overrides: Partial<CreateAgreementInput> = {},
): CreateAgreementInput {
  return {
    title: "Gloves and safety consumables 2026",
    supplierId,
    ownerId: OWNER,
    effectiveFrom: d("2026-01-01"),
    effectiveTo: d("2026-12-31"),
    maximumValue: usd(1_000_000),
    currency: "USD",
    lines: [
      {
        description: "Nitrile gloves, box of 100",
        categoryCode: "IND.OFFICE",
        uom: "BOX",
        unitPrice: usd(1_200),
        itemCode: "GLV-NITRILE-100",
        contractedQuantity: 1_000,
        maximumQuantity: 1_500,
        leadTimeDays: 5,
        priceTiers: [priceTier({ minQuantity: 500, unitPriceMinor: 1_100, currency: "USD" })],
      },
    ],
    ...overrides,
  };
}

function activeAgreement(
  ctx: TestContext,
  overrides: Partial<CreateAgreementInput> = {},
  supplierNumber = "SUP-9001",
): BlanketAgreement {
  const supplier = registerSupplier(ctx, { supplierNumber });
  const agreement = ctx.module.agreementService.create(
    ctx.tenant,
    agreementInput(supplier.id, overrides),
  );
  ctx.module.agreementService.activate(ctx.tenant, agreement.id);
  return agreement;
}

function release(ctx: TestContext, agreement: BlanketAgreement, qty: number, autoIssue = false) {
  return ctx.module.agreementService.release(ctx.tenant, agreement.id, {
    buyerId: BUYER,
    shipTo: "Plant 2, dock B",
    autoIssue,
    lines: [{ lineNumber: agreement.lines[0].lineNumber, quantity: qty, needBy: d("2026-04-15") }],
  });
}

describe("blanket agreements", () => {
  it("is created in draft and activates once it has a priced line", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const agreement = ctx.module.agreementService.create(ctx.tenant, agreementInput(supplier.id));
    assert.equal(agreement.status, "draft");
    assert.match(agreement.agreementNumber, /^BPA-2026-\d{6}$/);
    assert.equal(agreement.remainingValue.amountMinor, 1_000_000);

    ctx.module.agreementService.activate(ctx.tenant, agreement.id);
    assert.equal(agreement.status, "active");
    assertEmitted(ctx.module, ProcurementEvents.AgreementActivated);
  });

  it("refuses to activate an agreement with no lines", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    const agreement = ctx.module.agreementService.create(
      ctx.tenant,
      agreementInput(supplier.id, { lines: [] }),
    );
    assertDomainError(
      () => ctx.module.agreementService.activate(ctx.tenant, agreement.id),
      "VALIDATION",
    );
  });

  it("refuses a minimum commitment above the maximum value", () => {
    const ctx = buildModule();
    const supplier = registerSupplier(ctx);
    assertDomainError(
      () =>
        ctx.module.agreementService.create(
          ctx.tenant,
          agreementInput(supplier.id, {
            maximumValue: usd(100_000),
            minimumCommitment: usd(200_000),
          }),
        ),
      "VALIDATION",
    );
  });

  it("prices a release off the volume tier that applies", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    const lineNumber = agreement.lines[0].lineNumber;

    const small = ctx.module.agreementService.quote(ctx.tenant, agreement.id, [
      { lineNumber, quantity: 100 },
    ]);
    assert.equal(small.lines[0].unitPrice.amountMinor, 1_200);
    assert.equal(small.total.amountMinor, 120_000);

    const bulk = ctx.module.agreementService.quote(ctx.tenant, agreement.id, [
      { lineNumber, quantity: 600 },
    ]);
    assert.equal(bulk.lines[0].unitPrice.amountMinor, 1_100, "the 500+ tier kicks in");
    assert.equal(bulk.total.amountMinor, 660_000);
  });

  it("honours a date-scoped promotional tier only inside its window", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    const lineNumber = agreement.lines[0].lineNumber;
    ctx.module.agreementService.addPriceTier(
      ctx.tenant,
      agreement.id,
      lineNumber,
      priceTier({
        minQuantity: 100,
        unitPriceMinor: 950,
        currency: "USD",
        effectiveFrom: d("2026-03-01"),
        effectiveTo: d("2026-03-31"),
      }),
    );
    assertEmitted(ctx.module, ProcurementEvents.AgreementPriceTierAdded);

    const during = ctx.module.agreementService.quote(ctx.tenant, agreement.id, [
      { lineNumber, quantity: 100 },
    ]);
    assert.equal(during.lines[0].unitPrice.amountMinor, 950);

    ctx.clock.set(d("2026-04-02"));
    const after = ctx.module.agreementService.quote(ctx.tenant, agreement.id, [
      { lineNumber, quantity: 100 },
    ]);
    assert.equal(after.lines[0].unitPrice.amountMinor, 1_200);
  });
});

describe("agreement releases", () => {
  it("raises a purchase order at the contracted price and reserves the drawdown", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    const { order, release: recorded } = release(ctx, agreement, 600);

    assert.equal(order.sourceType, "agreement_release");
    assert.equal(order.agreementId, agreement.id);
    assert.equal(order.supplierReference, agreement.agreementNumber);
    assert.equal(order.lines[0].unitPrice.amountMinor, 1_100);
    assert.equal(order.netTotal.amountMinor, 660_000);
    assert.equal(order.status, "draft", "the agreement does not auto-approve by default");

    assert.equal(recorded.valueMinor, 660_000);
    assert.equal(agreement.releasedValue.amountMinor, 660_000);
    assert.equal(agreement.remainingValue.amountMinor, 340_000);
    assert.equal(agreement.lines[0].releasedQuantity, 600);
    assert.equal(agreement.lines[0].remainingQuantity, 900);
    assert.equal(agreement.lines[0].fulfilmentBps, 6_000);
    assertEmitted(ctx.module, ProcurementEvents.AgreementReleased);
  });

  it("auto-approves and can issue the release order when the agreement allows it", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx, { autoReleaseApproved: true });
    const { order } = release(ctx, agreement, 100, true);
    assert.equal(order.status, "issued");
    assert.equal(order.approvalRequestId, undefined, "no approval chain was raised");
    assert.ok(order.issuedAt);
  });

  it("refuses a release above the per-release limit and rolls the order back", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx, { releaseLimit: usd(100_000) });
    const error = assertDomainError(() => release(ctx, agreement, 100), "AGREEMENT_LIMIT");
    assert.equal((error.details as { limitCode: string }).limitCode, "RELEASE_LIMIT");

    assert.equal(agreement.releases.length, 0);
    assert.equal(agreement.releasedValue.amountMinor, 0);
    assert.equal(agreement.lines[0].releasedQuantity, 0);
    const orders = ctx.module.purchaseOrderService.list(ctx.tenant, {});
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "cancelled", "the speculative order is cancelled again");
  });

  it("refuses a release beyond the agreement's maximum value", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx, { maximumValue: usd(500_000) });
    const error = assertDomainError(() => release(ctx, agreement, 600), "AGREEMENT_LIMIT");
    assert.equal((error.details as { limitCode: string }).limitCode, "MAXIMUM_VALUE");
  });

  it("refuses a release beyond the line's maximum quantity", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    release(ctx, agreement, 800);
    const error = assertDomainError(() => release(ctx, agreement, 800), "AGREEMENT_LIMIT");
    assert.equal((error.details as { limitCode: string }).limitCode, "LINE_QUANTITY_CAP");
    assert.equal(agreement.lines[0].releasedQuantity, 800, "the rejected release changed nothing");
  });

  it("returns the drawdown when the release order is cancelled", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    const { order } = release(ctx, agreement, 600);

    ctx.module.purchaseOrderService.cancel(ctx.tenant, order.id, "Demand disappeared");
    assert.equal(agreement.releasedValue.amountMinor, 0);
    assert.equal(agreement.lines[0].releasedQuantity, 0);
    assert.equal(agreement.releases[0].cancelled, true);
    assert.equal(agreement.activeReleaseCount, 0);
    assertEmitted(ctx.module, ProcurementEvents.AgreementReleaseReturned);
  });

  it("cannot release against a suspended agreement until it resumes", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    ctx.module.agreementService.suspend(ctx.tenant, agreement.id, "Supplier audit finding open");
    assertDomainError(() => release(ctx, agreement, 100), "INVALID_STATE");

    ctx.module.agreementService.resume(ctx.tenant, agreement.id);
    assert.equal(release(ctx, agreement, 100).order.netTotal.amountMinor, 120_000);
  });

  it("cannot release outside the agreement's effective period", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    ctx.clock.set(d("2027-01-05"));
    const error = assertDomainError(() => release(ctx, agreement, 100), "AGREEMENT_LIMIT");
    assert.equal((error.details as { limitCode: string }).limitCode, "OUT_OF_PERIOD");
  });

  it("announces the minimum commitment being reached exactly once", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx, { minimumCommitment: usd(200_000) });
    release(ctx, agreement, 100);
    assert.equal(
      ctx.module.outbox
        .peek()
        .filter((event) => event.eventType === ProcurementEvents.AgreementCommitmentReached).length,
      0,
    );

    release(ctx, agreement, 100);
    release(ctx, agreement, 100);
    assert.equal(agreement.commitmentProgressBps, 18_000);
    assert.equal(
      ctx.module.outbox
        .peek()
        .filter((event) => event.eventType === ProcurementEvents.AgreementCommitmentReached).length,
      1,
    );
  });
});

describe("agreement lifecycle reporting", () => {
  it("expires agreements past their end date, once", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    assert.deepEqual(ctx.module.agreementService.expireDue(ctx.tenant), []);

    ctx.clock.set(d("2027-01-02"));
    assert.deepEqual(
      ctx.module.agreementService.expireDue(ctx.tenant).map((entry) => entry.id),
      [agreement.id],
    );
    assert.equal(agreement.status, "expired");
    assert.deepEqual(ctx.module.agreementService.expireDue(ctx.tenant), []);
    assertEmitted(ctx.module, ProcurementEvents.AgreementExpired);
  });

  it("lists agreements inside their renewal notice window", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx, { renewalNoticeDays: 45 });
    assert.deepEqual(ctx.module.agreementService.renewalsDue(ctx.tenant), []);

    ctx.clock.set(d("2026-12-01"));
    assert.deepEqual(
      ctx.module.agreementService.renewalsDue(ctx.tenant).map((entry) => entry.id),
      [agreement.id],
    );
  });

  it("finds the cheapest contracted price for an item across agreements", () => {
    const ctx = buildModule();
    const dearer = activeAgreement(ctx);
    const cheaper = activeAgreement(
      ctx,
      {
        title: "Gloves, secondary source",
        lines: [
          {
            description: "Nitrile gloves, box of 100",
            categoryCode: "IND.OFFICE",
            uom: "BOX",
            unitPrice: usd(1_150),
            itemCode: "GLV-NITRILE-100",
          },
        ],
      },
      "SUP-9002",
    );

    const best = ctx.module.agreementService.bestContractPrice(ctx.tenant, "GLV-NITRILE-100", 10);
    assert.equal(best?.agreement.id, cheaper.id);
    assert.equal(best?.unitPrice.amountMinor, 1_150);

    // At tier volume the first agreement wins again.
    const bulk = ctx.module.agreementService.bestContractPrice(ctx.tenant, "GLV-NITRILE-100", 600);
    assert.equal(bulk?.agreement.id, dearer.id);
    assert.equal(bulk?.unitPrice.amountMinor, 1_100);

    assert.equal(
      ctx.module.agreementService.bestContractPrice(ctx.tenant, "NOT-CONTRACTED", 1),
      undefined,
    );
  });

  it("reports commitment progress and value still available", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx, { minimumCommitment: usd(400_000) });
    release(ctx, agreement, 100);

    const [progress] = ctx.module.agreementService.commitmentReport(ctx.tenant);
    assert.equal(progress.agreement.id, agreement.id);
    assert.equal(progress.releasedValue.amountMinor, 120_000);
    assert.equal(progress.progressBps, 3_000);
    assert.equal(progress.daysToExpiry, 304);

    assert.equal(
      ctx.module.agreementService
        .availableValue(ctx.tenant, agreement.supplierId, "USD")
        .amountMinor,
      880_000,
    );
  });

  it("closing an agreement stops further releases", () => {
    const ctx = buildModule();
    const agreement = activeAgreement(ctx);
    ctx.module.agreementService.close(ctx.tenant, agreement.id, "Superseded by the 2027 contract");
    assert.equal(agreement.status, "closed");
    assertEmitted(ctx.module, ProcurementEvents.AgreementClosed);
    assertDomainError(() => release(ctx, agreement, 100), "INVALID_STATE");
  });
});
