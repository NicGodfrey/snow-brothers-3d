import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Email, IsoDateTime } from "@enterprise-suite/shared-kernel";
import { ChannelEventTypes } from "../src/domain/events.js";
import { DEFAULT_TIER_POLICIES } from "../src/domain/partner.js";
import { addDays } from "../src/domain/protection.js";
import type { Partner } from "../src/domain/partner.js";
import { eventsOfType, expectRejects, makePartner, usd, world, type TestWorld } from "./helpers.js";

const REGISTERED = DEFAULT_TIER_POLICIES.registered;

async function agent(w: TestWorld): Promise<Partner> {
  return makePartner(w, {
    code: "ATLAS-REF",
    type: "referral_agent",
    tier: "registered",
    territories: ["NA"],
    productLines: ["cloud-platform"],
  });
}

async function submitReferral(w: TestWorld, partner: Partner, overrides: { productLines?: readonly string[] } = {}) {
  return w.container.services.referral.submit(w.partnerCtx("priya"), {
    partnerId: partner.id,
    contact: {
      name: "Sofia Marchetti",
      email: "sofia@umbrella-logistics.com" as Email,
      title: "Director of Platform Engineering",
    },
    company: { name: "Umbrella Logistics", domain: "umbrella-logistics.com", country: "US" },
    productLines: overrides.productLines ?? ["cloud-platform"],
    estimatedValue: usd(6_000_000),
    notes: "Long-standing advisory client migrating off a self-hosted stack.",
  });
}

describe("submitting a referral", () => {
  it("numbers it, resolves the customer and starts the decision clock", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));

    assert.equal(referral.number, "REF-00001");
    assert.equal(referral.status, "submitted");
    assert.equal(referral.customerKey, "domain:umbrella-logistics.com");
    assert.equal(referral.decisionDueAt, addDays(w.clock.now(), 10));
    assert.equal(eventsOfType(w, ChannelEventTypes.ReferralSubmitted).length, 1);
  });

  it("enforces product-line authorization but not territory", async () => {
    const w = world();
    const partner = await agent(w);
    await expectRejects(
      submitReferral(w, partner, { productLines: ["network-security"] }),
      "POLICY_VIOLATION",
      "not authorized for product line(s): network-security",
    );

    // The company sits outside the agent's NA grant; an introduction still counts.
    const outside = await w.container.services.referral.submit(w.partnerCtx("priya"), {
      partnerId: partner.id,
      contact: { name: "Kenji Sato", email: "kenji@initech.io" as Email },
      company: { name: "Initech", domain: "initech.io", country: "SG" },
      productLines: ["cloud-platform"],
    });
    assert.equal(outside.status, "submitted");
  });

  it("rejects an unusable contact", async () => {
    const w = world();
    const partner = await agent(w);
    await expectRejects(
      w.container.services.referral.submit(w.partnerCtx("priya"), {
        partnerId: partner.id,
        contact: { name: "X", email: "not-an-email" as Email },
        company: { name: "A", country: "US" },
        productLines: ["cloud-platform"],
      }),
      "VALIDATION",
      "contact.email",
    );
  });
});

describe("deciding a referral", () => {
  it("accepts with an attribution window and the tier's commission rate", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await w.container.services.referral.accept(w.ctx, referral.id, { attributionDays: 180 });

    assert.equal(referral.status, "accepted");
    assert.equal(referral.commissionBps, REGISTERED.referralCommissionBps);
    assert.equal(referral.attribution?.endsAt, addDays(w.clock.now(), 180));
    assert.equal(referral.isAttributedAt(w.clock.now()), true);
  });

  it("refuses a commission above the tier's rate", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await expectRejects(
      w.container.services.referral.accept(w.ctx, referral.id, { commissionBps: 2_000 }),
      "POLICY_VIOLATION",
      "exceeds the registered referral rate",
    );
  });

  it("rejects with a reason and refuses a second decision", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await w.container.services.referral.reject(w.ctx, referral.id, {
      reason: "existing_customer",
      notes: "Already a direct customer of ours since 2024",
    });
    assert.equal(referral.status, "rejected");
    await expectRejects(
      w.container.services.referral.accept(w.ctx, referral.id),
      "INVALID_STATE",
      "only submitted referrals can be accepted",
    );
  });
});

describe("converting a referral", () => {
  it("creates and submits a vendor-referred registration for the transacting partner", async () => {
    const w = world();
    const atlas = await agent(w);
    const northwind = await makePartner(w, { code: "NORTHWIND", productLines: ["cloud-platform"] });
    const referral = await submitReferral(w, atlas);
    await w.container.services.referral.accept(w.ctx, referral.id);

    const { registration } = await w.container.services.referral.convertToRegistration(w.ctx, referral.id, {
      estimatedValue: usd(6_000_000),
      expectedCloseDate: addDays(w.clock.now(), 90),
      description: "Cloud platform migration for a 400-site logistics operator, introduced by Atlas.",
      transactingPartnerId: northwind.id,
    });

    assert.equal(referral.status, "converted");
    assert.equal(referral.conversion?.registrationId, registration.id);
    assert.equal(registration.partnerId, northwind.id, "the agent introduces, the reseller transacts");
    assert.equal(registration.source, "vendor_referred");
    assert.equal(registration.referralId, referral.id);
    assert.equal(registration.customerKey, referral.customerKey);
    assert.equal(registration.status, "approved", "6,000.00 USD clears the gold auto-approval bar");
  });

  it("hands a deal to the vendor's own sellers while the partner keeps attribution", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await w.container.services.referral.accept(w.ctx, referral.id);
    await w.container.services.referral.convertToOpportunity(w.ctx, referral.id, "opp_84213");

    assert.equal(referral.status, "converted");
    assert.equal(referral.conversion?.opportunityRef, "opp_84213");
    assert.equal(referral.conversion?.registrationId, undefined);
  });

  it("refuses to convert once attribution has lapsed", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await w.container.services.referral.accept(w.ctx, referral.id, { attributionDays: 30 });
    w.clock.advanceDays(31);
    await expectRejects(
      w.container.services.referral.convertToOpportunity(w.ctx, referral.id, "opp_99"),
      "INVALID_STATE",
      "lapsed on",
    );
  });

  it("refuses to convert something that was never accepted", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await expectRejects(
      w.container.services.referral.convertToOpportunity(w.ctx, referral.id, "opp_1"),
      "INVALID_STATE",
      "only accepted referrals can be converted",
    );
  });
});

describe("referral commission", () => {
  it("accrues on the realised value, then needs approval and a payment reference", async () => {
    const w = world();
    const partner = await agent(w);
    const referral = await submitReferral(w, partner);
    await w.container.services.referral.accept(w.ctx, referral.id);
    await w.container.services.referral.convertToOpportunity(w.ctx, referral.id, "opp_84213");

    const { commission } = await w.container.services.referral.markWon(w.ctx, referral.id, usd(6_200_000));
    assert.equal(commission.bps, REGISTERED.referralCommissionBps);
    assert.deepEqual(commission.basis, usd(6_200_000));
    assert.deepEqual(commission.amount, usd(186_000), "3% of the realised value");
    assert.equal(commission.status, "accrued");

    await expectRejects(
      w.container.services.referral.payCommission(w.ctx, referral.id, "pay_1"),
      "INVALID_STATE",
      "approve it before payment",
    );
    await w.container.services.referral.approveCommission(w.ctx, referral.id);
    await expectRejects(
      w.container.services.referral.payCommission(w.ctx, referral.id, "  "),
      "VALIDATION",
      "payment reference is required",
    );
    await w.container.services.referral.payCommission(w.ctx, referral.id, "run_2026_02");

    assert.equal(referral.commission?.status, "paid");
    assert.equal(referral.commission?.paymentRef, "run_2026_02");
    assert.equal(eventsOfType(w, ChannelEventTypes.ReferralCommissionAccrued).length, 1);
    assert.equal(eventsOfType(w, ChannelEventTypes.ReferralCommissionPaid).length, 1);
  });

  it("reports accrued, approved and paid separately in the ledger", async () => {
    const w = world();
    const partner = await agent(w);

    const first = await submitReferral(w, partner);
    await w.container.services.referral.accept(w.ctx, first.id);
    await w.container.services.referral.convertToOpportunity(w.ctx, first.id, "opp_1");
    await w.container.services.referral.markWon(w.ctx, first.id, usd(1_000_000));

    const second = await w.container.services.referral.submit(w.partnerCtx("priya"), {
      partnerId: partner.id,
      contact: { name: "Ana Silva", email: "ana@vertigo.example" as Email },
      company: { name: "Vertigo Freight", domain: "vertigo.example", country: "US" },
      productLines: ["cloud-platform"],
    });
    await w.container.services.referral.accept(w.ctx, second.id);
    await w.container.services.referral.convertToOpportunity(w.ctx, second.id, "opp_2");
    await w.container.services.referral.markWon(w.ctx, second.id, usd(2_000_000));
    await w.container.services.referral.approveCommission(w.ctx, second.id);
    await w.container.services.referral.payCommission(w.ctx, second.id, "run_2026_02");

    const ledger = await w.container.services.referral.commissionLedger(w.ctx);
    assert.equal(ledger.length, 1, "one row per partner and currency");
    const entry = ledger[0]!;
    assert.equal(entry.referralCount, 2);
    assert.deepEqual(entry.accrued, usd(30_000));
    assert.deepEqual(entry.approved, usd(0));
    assert.deepEqual(entry.paid, usd(60_000));
  });

  it("earns nothing on a lost referral", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await w.container.services.referral.accept(w.ctx, referral.id);
    await w.container.services.referral.markLost(w.ctx, referral.id, "customer stayed on their incumbent platform");

    assert.equal(referral.status, "closed_lost");
    assert.equal(referral.commission, undefined);
    assert.deepEqual(await w.container.services.referral.commissionLedger(w.ctx), []);
  });
});

describe("referral expiry", () => {
  it("lapses an undecided referral on the decision SLA", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    assert.deepEqual(await w.container.services.referral.sweepExpired(w.ctx), []);

    w.clock.advanceDays(11);
    const expired = await w.container.services.referral.sweepExpired(w.ctx);
    assert.deepEqual(expired.map((r) => r.number), [referral.number]);
    assert.equal(referral.status, "expired");

    // The sweep is idempotent: a second pass finds nothing new.
    assert.deepEqual(await w.container.services.referral.sweepExpired(w.ctx), []);
    assert.equal(eventsOfType(w, ChannelEventTypes.ReferralExpired).length, 1);
  });

  it("lapses an accepted referral when attribution runs out before conversion", async () => {
    const w = world();
    const referral = await submitReferral(w, await agent(w));
    await w.container.services.referral.accept(w.ctx, referral.id, { attributionDays: 60 });

    w.clock.advanceDays(61);
    const expired = await w.container.services.referral.sweepExpired(w.ctx, w.clock.now() as IsoDateTime);
    assert.deepEqual(expired.map((r) => r.number), [referral.number]);
    assert.equal(referral.status, "expired");
  });
});
