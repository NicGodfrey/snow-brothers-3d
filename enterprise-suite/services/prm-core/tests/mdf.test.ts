import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money, type Ulid } from "@enterprise-suite/shared-kernel";
import {
  activePartner,
  approvedPartner,
  expectRejects,
  partnerCtx,
  usd,
  world,
  type TestWorld,
} from "./helpers.js";

const PERIOD = "FY26-Q1";
const ACTIVITY_START = "2026-02-01T00:00:00.000Z";
const ACTIVITY_END = "2026-02-20T00:00:00.000Z";

/** Open budget with a single allocation for `partnerId`. */
async function fundedBudget(
  w: TestWorld,
  partnerId: Ulid,
  allocation = usd(100_000),
): Promise<{ budgetId: Ulid; allocationId: Ulid }> {
  const { mdfBudget } = w.container.services;
  const budget = await mdfBudget.create(w.ctx, {
    code: `MDF-${PERIOD}`,
    name: `Channel marketing fund ${PERIOD}`,
    period: PERIOD,
    total: usd(500_000),
    claimWindowDays: 60,
    matchingRateBps: 5000,
  });
  await mdfBudget.open(w.ctx, budget.id);
  const line = await mdfBudget.allocate(w.ctx, budget.id, { partnerId, amount: allocation });
  return { budgetId: budget.id, allocationId: line.id };
}

async function approvedRequest(
  w: TestWorld,
  partnerId: Ulid,
  budgetId: Ulid,
  requested = usd(40_000),
  approved?: ReturnType<typeof usd>,
): Promise<Ulid> {
  const { mdf } = w.container.services;
  const request = await mdf.createRequest(partnerCtx(w), {
    partnerId,
    budgetId,
    activityType: "digital_campaign",
    title: "Manufacturing analytics webinar series",
    description: "Three-part webinar series with paid social promotion.",
    activityStart: ACTIVITY_START as never,
    activityEnd: ACTIVITY_END as never,
    requestedAmount: requested,
    expectedLeads: 120,
  });
  await mdf.submitRequest(partnerCtx(w), request.id);
  await mdf.approveRequest(w.ctx, request.id, {
    approvedAmount: approved,
    notes: approved ? "Social spend capped" : undefined,
  });
  return request.id;
}

describe("MDF budgets", () => {
  it("keeps allocations inside the budget and reports the ledger", async () => {
    const w = world();
    const partner = await activePartner(w);
    const other = await activePartner(w, { legalName: "Fabrikam Systems Inc", countryCode: "US" });
    const budget = await w.container.services.mdfBudget.create(w.ctx, {
      code: "MDF-FY26-Q1",
      name: "Q1 fund",
      period: PERIOD,
      total: usd(100_000),
    });
    await expectRejects(
      w.container.services.mdfBudget.allocate(w.ctx, budget.id, {
        partnerId: partner.id,
        amount: usd(10_000),
      }),
      "INVALID_STATE",
      "draft",
    );
    await w.container.services.mdfBudget.open(w.ctx, budget.id);
    await w.container.services.mdfBudget.allocate(w.ctx, budget.id, {
      partnerId: partner.id,
      amount: usd(60_000),
    });
    await expectRejects(
      w.container.services.mdfBudget.allocate(w.ctx, budget.id, {
        partnerId: other.id,
        amount: usd(60_000),
      }),
      "MDF_BUDGET_EXHAUSTED",
    );
    // A second allocation for the same partner is a top-up, not a new line.
    await expectRejects(
      w.container.services.mdfBudget.allocate(w.ctx, budget.id, {
        partnerId: partner.id,
        amount: usd(1_000),
      }),
      "INVALID_STATE",
      "already has an allocation",
    );
    await w.container.services.mdfBudget.topUp(w.ctx, budget.id, usd(50_000), "Extra Q1 funding");
    const line = await w.container.services.mdfBudget.allocate(w.ctx, budget.id, {
      partnerId: other.id,
      amount: usd(60_000),
    });
    assert.equal(line.amount.amountMinor, usd(60_000).amountMinor);

    const reloaded = await w.container.services.mdfBudget.get(w.ctx, budget.id);
    const summary = reloaded.summary();
    assert.equal(summary.total.amountMinor, usd(150_000).amountMinor);
    assert.equal(summary.allocated.amountMinor, usd(120_000).amountMinor);
    assert.equal(summary.unallocated.amountMinor, usd(30_000).amountMinor);
    assert.equal(summary.available.amountMinor, usd(120_000).amountMinor);
  });

  it("refuses money in the wrong currency", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId } = await fundedBudget(w, partner.id);
    await expectRejects(
      w.container.services.mdfBudget.topUp(w.ctx, budgetId, money(1000, "EUR"), "Euro top-up"),
      "CURRENCY_MISMATCH",
    );
  });

  it("will not close a budget with money still committed", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId } = await fundedBudget(w, partner.id);
    const requestId = await approvedRequest(w, partner.id, budgetId);
    await expectRejects(
      w.container.services.mdfBudget.close(w.ctx, budgetId),
      "INVALID_STATE",
      "committed funds",
    );
    await w.container.services.mdf.closeRequest(w.ctx, requestId, "Campaign cancelled");
    const closed = await w.container.services.mdfBudget.close(w.ctx, budgetId);
    assert.equal(closed.status, "closed");
  });
});

describe("MDF fund requests", () => {
  it("requires an eligible, trading partner", async () => {
    const w = world();
    const applicant = await approvedPartner(w);
    const trading = await activePartner(w, { legalName: "Northwind Distribution GmbH", countryCode: "DE" });
    const { budgetId } = await fundedBudget(w, trading.id);

    const ineligible = await w.container.services.mdf.eligibility(w.ctx, applicant.id);
    assert.equal(ineligible.eligible, false);
    assert.deepEqual(
      [...ineligible.reasons],
      ["partner is approved", "no MDF-eligible contract and the tier does not accrue MDF"],
    );
    await expectRejects(
      w.container.services.mdf.createRequest(partnerCtx(w), {
        partnerId: applicant.id,
        budgetId,
        activityType: "event",
        title: "Launch event",
        description: "A launch event in Reading with 60 invited accounts.",
        activityStart: ACTIVITY_START as never,
        activityEnd: ACTIVITY_END as never,
        requestedAmount: usd(5_000),
      }),
      "INVALID_STATE",
      "not eligible for MDF",
    );
    assert.equal((await w.container.services.mdf.eligibility(w.ctx, trading.id)).eligible, true);
  });

  it("holds the activity inside the budget period and the allocation", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId } = await fundedBudget(w, partner.id, usd(20_000));
    await expectRejects(
      w.container.services.mdf.createRequest(partnerCtx(w), {
        partnerId: partner.id,
        budgetId,
        activityType: "trade_show",
        title: "Expo booth",
        description: "Shared booth with two demo stations at the Smart Factory Expo.",
        activityStart: "2026-07-01T00:00:00.000Z" as never,
        activityEnd: "2026-07-03T00:00:00.000Z" as never,
        requestedAmount: usd(5_000),
      }),
      "VALIDATION",
      "must fall inside FY26-Q1",
    );
    await expectRejects(
      w.container.services.mdf.createRequest(partnerCtx(w), {
        partnerId: partner.id,
        budgetId,
        activityType: "trade_show",
        title: "Expo booth",
        description: "Shared booth with two demo stations at the Smart Factory Expo.",
        activityStart: ACTIVITY_START as never,
        activityEnd: ACTIVITY_END as never,
        requestedAmount: usd(25_000),
      }),
      "MDF_BUDGET_EXHAUSTED",
    );
  });

  it("commits budget money on approval and computes the partner's own share", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId, allocationId } = await fundedBudget(w, partner.id);
    const requestId = await approvedRequest(w, partner.id, budgetId, usd(40_000), usd(35_000));

    const request = await w.container.services.mdf.getRequest(w.ctx, requestId);
    assert.equal(request.number, "MDF-00001");
    assert.equal(request.status, "approved");
    assert.equal(request.approvedAmount?.amountMinor, usd(35_000).amountMinor);
    // A 5000 bps matching rate makes the partner fund half of what it asks for.
    assert.equal(request.partnerContribution.amountMinor, usd(20_000).amountMinor);
    assert.ok(request.claimDeadline);

    const budget = await w.container.services.mdfBudget.get(w.ctx, budgetId);
    assert.equal(budget.allocationAvailable(allocationId).amountMinor, usd(65_000).amountMinor);
    const balance = await w.container.services.mdfBudget.partnerBalance(w.ctx, partner.id);
    assert.equal(balance.committed.amountMinor, usd(35_000).amountMinor);
    assert.equal(balance.available.amountMinor, usd(65_000).amountMinor);
  });

  it("requires an explanation when approving less than requested", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId } = await fundedBudget(w, partner.id);
    const request = await w.container.services.mdf.createRequest(partnerCtx(w), {
      partnerId: partner.id,
      budgetId,
      activityType: "content_syndication",
      title: "Syndicated whitepaper",
      description: "Whitepaper syndication across two industry publishers.",
      activityStart: ACTIVITY_START as never,
      activityEnd: ACTIVITY_END as never,
      requestedAmount: usd(10_000),
    });
    await expectRejects(
      w.container.services.mdf.approveRequest(w.ctx, request.id),
      "INVALID_STATE",
      "is draft, expected submitted",
    );
    await w.container.services.mdf.submitRequest(partnerCtx(w), request.id);
    await expectRejects(
      w.container.services.mdf.approveRequest(w.ctx, request.id, { approvedAmount: usd(6_000) }),
      "VALIDATION",
      "explain why less than the requested amount",
    );
    await expectRejects(
      w.container.services.mdf.approveRequest(w.ctx, request.id, { approvedAmount: usd(12_000) }),
      "VALIDATION",
      "cannot exceed the requested amount",
    );
  });

  it("releases the unclaimed remainder when the request is closed", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId, allocationId } = await fundedBudget(w, partner.id);
    const requestId = await approvedRequest(w, partner.id, budgetId, usd(40_000));

    const claim = await w.container.services.mdf.createClaim(partnerCtx(w), {
      requestId,
      claimedAmount: usd(15_000),
      activitySummary: "Two of three webinars delivered.",
    });
    await w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
      kind: "invoice",
      reference: "AGENCY-2026-0114",
      amount: usd(15_000),
    });
    await w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
      kind: "activity_report",
      reference: "WEBINAR-SERIES-REPORT",
    });
    await w.container.services.mdf.submitClaim(partnerCtx(w), claim.id);
    await expectRejects(
      w.container.services.mdf.closeRequest(w.ctx, requestId, "Series cut short"),
      "INVALID_STATE",
      "still open",
    );
    await w.container.services.mdf.startClaimReview(w.ctx, claim.id);
    await w.container.services.mdf.approveClaim(w.ctx, claim.id);
    await w.container.services.mdf.payClaim(w.ctx, claim.id, "AP-2026-000771");

    const closed = await w.container.services.mdf.closeRequest(w.ctx, requestId, "Series cut short");
    assert.equal(closed.status, "closed");
    const budget = await w.container.services.mdfBudget.get(w.ctx, budgetId);
    // 40k committed, 15k paid, 25k handed back to the allocation.
    assert.equal(budget.allocationAvailable(allocationId).amountMinor, usd(85_000).amountMinor);
    assert.equal(budget.paidTotal().amountMinor, usd(15_000).amountMinor);
  });
});

describe("MDF claims", () => {
  it("needs financial proof and lands inside the claim window", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId } = await fundedBudget(w, partner.id);
    const requestId = await approvedRequest(w, partner.id, budgetId);
    const claim = await w.container.services.mdf.createClaim(partnerCtx(w), {
      requestId,
      claimedAmount: usd(32_000),
      activitySummary: "Three webinars delivered, 143 registrations.",
      actualLeads: 96,
    });
    assert.equal(claim.number, "CLM-00001");
    await expectRejects(
      w.container.services.mdf.submitClaim(partnerCtx(w), claim.id),
      "VALIDATION",
      "at least one invoice or receipt",
    );
    await expectRejects(
      w.container.services.mdf.addProof(partnerCtx(w), claim.id, { kind: "invoice", reference: "NO-AMOUNT" }),
      "VALIDATION",
      "requires an amount",
    );
    await w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
      kind: "invoice",
      reference: "AGENCY-2026-0114",
      amount: usd(28_000),
    });
    await expectRejects(
      w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
        kind: "invoice",
        reference: "AGENCY-2026-0114",
        amount: usd(28_000),
      }),
      "INVALID_STATE",
      "already attached",
    );
    await w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
      kind: "receipt",
      reference: "SOCIAL-ADS-Q1",
      amount: usd(4_000),
    });
    await expectRejects(
      w.container.services.mdf.submitClaim(partnerCtx(w), claim.id),
      "VALIDATION",
      "proof of performance",
    );
    await w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
      kind: "lead_export",
      reference: "CRM-EXPORT-96-LEADS",
      documentUrl: "https://files.example/leads/webinar-series.csv",
    });

    // The claim window closes 60 days after the activity ends.
    w.clock.set("2026-05-01T00:00:00.000Z");
    await expectRejects(
      w.container.services.mdf.submitClaim(partnerCtx(w), claim.id),
      "MDF_CLAIM_WINDOW_CLOSED",
    );
    w.clock.set("2026-03-01T00:00:00.000Z");
    const submitted = await w.container.services.mdf.submitClaim(partnerCtx(w), claim.id);
    assert.equal(submitted.status, "submitted");
  });

  it("short-pays with a reason and settles the ledger on payment", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId, allocationId } = await fundedBudget(w, partner.id);
    const requestId = await approvedRequest(w, partner.id, budgetId);
    const claim = await w.container.services.mdf.createClaim(partnerCtx(w), {
      requestId,
      claimedAmount: usd(32_000),
      activitySummary: "Three webinars delivered.",
    });
    await w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
      kind: "invoice",
      reference: "AGENCY-2026-0114",
      amount: usd(32_000),
    });
    await w.container.services.mdf.addProof(partnerCtx(w), claim.id, {
      kind: "lead_export",
      reference: "CRM-EXPORT-96-LEADS",
    });
    await w.container.services.mdf.submitClaim(partnerCtx(w), claim.id);
    await expectRejects(
      w.container.services.mdf.payClaim(w.ctx, claim.id, "AP-1"),
      "INVALID_STATE",
    );
    await w.container.services.mdf.startClaimReview(w.ctx, claim.id);
    await expectRejects(
      w.container.services.mdf.approveClaim(w.ctx, claim.id, { approvedAmount: usd(20_000) }),
      "VALIDATION",
      "short-pay reason",
    );
    const approved = await w.container.services.mdf.approveClaim(w.ctx, claim.id, {
      approvedAmount: usd(20_000),
      notes: "Social advertising was outside the approved plan",
    });
    assert.equal(approved.approvedAmount?.amountMinor, usd(20_000).amountMinor);

    await expectRejects(w.container.services.mdf.payClaim(w.ctx, claim.id, "  "), "VALIDATION");
    const paid = await w.container.services.mdf.payClaim(w.ctx, claim.id, "AP-2026-000771");
    assert.equal(paid.status, "paid");

    const budget = await w.container.services.mdfBudget.get(w.ctx, budgetId);
    assert.equal(budget.paidTotal().amountMinor, usd(20_000).amountMinor);
    // 40k committed - 20k paid leaves 20k committed and 60k free.
    assert.equal(budget.committedTotal().amountMinor, usd(20_000).amountMinor);
    assert.equal(budget.allocationAvailable(allocationId).amountMinor, usd(60_000).amountMinor);

    const events = w.container.outbox.entries(w.ctx.tenantId).map((e) => e.eventType);
    assert.ok(events.includes("prm.mdf-budget.funds-committed"));
    assert.ok(events.includes("prm.mdf-budget.funds-paid"));
    assert.ok(events.includes("prm.mdf-claim.paid"));
  });

  it("never lets claims exceed the approved envelope", async () => {
    const w = world();
    const partner = await activePartner(w);
    const { budgetId } = await fundedBudget(w, partner.id);
    const requestId = await approvedRequest(w, partner.id, budgetId, usd(40_000), usd(30_000));
    const first = await w.container.services.mdf.createClaim(partnerCtx(w), {
      requestId,
      claimedAmount: usd(25_000),
    });
    await w.container.services.mdf.addProof(partnerCtx(w), first.id, {
      kind: "invoice",
      reference: "INV-1",
      amount: usd(25_000),
    });
    await w.container.services.mdf.addProof(partnerCtx(w), first.id, {
      kind: "attendee_list",
      reference: "EXPO-ATTENDEES",
    });
    await w.container.services.mdf.submitClaim(partnerCtx(w), first.id);
    await w.container.services.mdf.startClaimReview(w.ctx, first.id);
    await w.container.services.mdf.approveClaim(w.ctx, first.id);
    await expectRejects(
      w.container.services.mdf.createClaim(partnerCtx(w), { requestId, claimedAmount: usd(10_000) }),
      "INVALID_STATE",
      "still claimable",
    );
    const second = await w.container.services.mdf.createClaim(partnerCtx(w), {
      requestId,
      claimedAmount: usd(5_000),
    });
    assert.equal(second.claimedAmount.amountMinor, usd(5_000).amountMinor);
  });
});
