import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money } from "@enterprise-suite/shared-kernel";
import { ChannelEventTypes } from "../src/domain/events.js";
import { DEFAULT_TIER_POLICIES } from "../src/domain/partner.js";
import { addDays } from "../src/domain/protection.js";
import {
  eventsOfType,
  eventTypes,
  expectRejects,
  makeApprovedRegistration,
  makePartner,
  makeRegistration,
  usd,
  world,
} from "./helpers.js";

const GOLD = DEFAULT_TIER_POLICIES.gold;

describe("registering a deal", () => {
  it("refuses a partner that is not active, out of territory or unauthorized", async () => {
    const w = world();
    const onboarding = await makePartner(w, { code: "ONBOARD", activate: false });
    await expectRejects(makeRegistration(w, onboarding), "POLICY_VIOLATION", "is onboarding");

    const partner = await makePartner(w, { territories: ["NA"], productLines: ["endpoint"] });
    await expectRejects(
      makeRegistration(w, partner, { country: "DE", productLines: ["endpoint"], domain: "fabrikam.de" }),
      "POLICY_VIOLATION",
      "not authorized in DE",
    );
    await expectRejects(
      makeRegistration(w, partner, { productLines: ["cloud-platform"] }),
      "POLICY_VIOLATION",
      "not authorized for product line(s): cloud-platform",
    );
  });

  it("refuses a referral agent, who introduces deals but never transacts", async () => {
    const w = world();
    const agent = await makePartner(w, { code: "ATLAS-REF", type: "referral_agent" });
    await expectRejects(
      makeRegistration(w, agent),
      "POLICY_VIOLATION",
      "submit an opportunity referral instead",
    );
  });

  it("refuses a value in a currency the partner does not transact in", async () => {
    const w = world();
    const partner = await makePartner(w, { currency: "EUR" });
    await expectRejects(
      makeRegistration(w, partner, { value: usd(1_000_000) }),
      "POLICY_VIOLATION",
      "must be in EUR",
    );
  });

  it("refuses a close date in the past and a stage that is already closed", async () => {
    const w = world();
    const partner = await makePartner(w);
    await expectRejects(makeRegistration(w, partner, { closeInDays: -1 }), "VALIDATION", "must be in the future");
    await expectRejects(
      w.container.services.registration.create(w.ctx, {
        partnerId: partner.id,
        endCustomer: { name: "Contoso", domain: "contoso.com", country: "US" },
        productLines: ["network-security"],
        estimatedValue: usd(100_000),
        expectedCloseDate: addDays(w.clock.now(), 30),
        stage: "closed_won",
      }),
      "VALIDATION",
      "cannot start in a closed stage",
    );
  });

  it("creates a numbered draft, resolves the customer key and emits one event", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeRegistration(w, partner);

    assert.equal(registration.number, "DR-00001");
    assert.equal(registration.status, "draft");
    assert.equal(registration.customerKey, "domain:contoso.com");
    assert.equal(registration.stage, "qualified");
    assert.equal(registration.probability, 25, "probability defaults to the stage");
    assert.deepEqual(eventsOfType(w, ChannelEventTypes.DealRegistrationCreated).length, 1);

    const second = await makeRegistration(w, partner, { customerName: "Fabrikam", domain: "fabrikam.de", country: "DE" });
    assert.equal(second.number, "DR-00002", "numbers are sequential per tenant");
  });
});

describe("submitting for review", () => {
  it("requires a description a reviewer can act on", async () => {
    const w = world();
    const partner = await makePartner(w);
    const thin = await makeRegistration(w, partner, { description: "big deal" });
    await expectRejects(
      w.container.services.registration.submit(w.ctx, thin.id),
      "VALIDATION",
      "at least 20 characters",
    );
  });

  it("stamps the tier's approval SLA and moves to submitted", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeRegistration(w, partner);
    const result = await w.container.services.registration.submit(w.partnerCtx("rep"), registration.id);

    assert.equal(result.registration.status, "submitted");
    assert.equal(result.autoApproved, false, "25,000.00 USD is above the gold auto-approval bar");
    assert.equal(registration.slaDueAt, addDays(w.clock.now(), GOLD.approvalSlaHours / 24));
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.conflicts, []);
  });

  it("auto-approves a small, clean deal in the same call", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeRegistration(w, partner, { value: usd(4_500_000) });
    const result = await w.container.services.registration.submit(w.partnerCtx("rep"), registration.id);

    assert.equal(result.autoApproved, true);
    assert.equal(registration.status, "approved");
    assert.equal(registration.approval?.autoApproved, true);
    assert.equal(registration.discountBps, GOLD.registeredDiscountBps);
    assert.equal(registration.protection?.grantedDays, GOLD.protectionDays);
    assert.equal(registration.isProtectedAt(w.clock.now()), true);

    const approvals = eventsOfType(w, ChannelEventTypes.DealRegistrationApproved);
    assert.equal(approvals.length, 1);
    assert.equal((approvals[0]!.payload as { autoApproved: boolean }).autoApproved, true);
  });

  it("refuses a duplicate of the partner's own live registration", async () => {
    const w = world();
    const partner = await makePartner(w);
    await makeApprovedRegistration(w, partner);
    const again = await makeRegistration(w, partner);
    await expectRejects(
      w.container.services.registration.submit(w.ctx, again.id),
      "DEAL_CONFLICT",
      "You already have DR-00001",
    );
    assert.equal(again.status, "draft", "a refused submission leaves the draft alone");
  });

  it("refuses a house account outright", async () => {
    const w = world();
    const partner = await makePartner(w);
    await w.container.services.conflict.addDirectClaim(w.ctx, {
      customerKey: "domain:globex.com",
      reason: "strategic account owned by the direct team",
    });
    const registration = await makeRegistration(w, partner, { customerName: "Globex", domain: "globex.com" });
    await expectRejects(
      w.container.services.registration.submit(w.ctx, registration.id),
      "DEAL_CONFLICT",
      "house account",
    );
  });

  it("accepts a submission into another partner's protection but opens a case and blocks auto-approval", async () => {
    const w = world();
    const incumbent = await makePartner(w, { code: "NORTHWIND" });
    const challenger = await makePartner(w, { code: "HELIOS" });
    await makeApprovedRegistration(w, incumbent);

    const contested = await makeRegistration(w, challenger, { value: usd(1_000_000) });
    const result = await w.container.services.registration.submit(w.partnerCtx("marek"), contested.id);

    assert.equal(result.registration.status, "submitted");
    assert.equal(result.autoApproved, false, "a small deal still waits when the customer is contested");
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]!.kind, "partner_vs_partner");
    assert.equal(result.conflicts[0]!.number, "CNF-00001");
    assert.deepEqual(contested.conflictCaseIds, [result.conflicts[0]!.id]);

    // Re-submitting the same collision must not spam the adjudication queue.
    const duplicateCase = await w.container.services.conflict.raiseCase(w.ctx, contested, result.findings[0]!);
    assert.equal(duplicateCase.id, result.conflicts[0]!.id);
  });
});

describe("approval, protection and the discount band", () => {
  it("mints the tier's window and discount, and records the tier at approval", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "silver" });
    const registration = await makeRegistration(w, partner, { value: usd(25_000_000) });
    await w.container.services.registration.submit(w.ctx, registration.id);
    await w.container.services.registration.startReview(w.ctx, registration.id);
    await w.container.services.registration.approve(w.ctx, registration.id, { notes: "Displacement case" });

    assert.equal(registration.status, "approved");
    assert.equal(registration.tierAtApproval, "silver");
    assert.equal(registration.protection?.grantedDays, DEFAULT_TIER_POLICIES.silver.protectionDays);
    assert.equal(registration.discountBps, DEFAULT_TIER_POLICIES.silver.registeredDiscountBps);

    // A later tier change must not rewrite what was granted.
    await w.container.services.partner.changeTier(w.ctx, partner.id, "platinum", "Q1 promotion");
    assert.equal(registration.tierAtApproval, "silver");
  });

  it("refuses protection or a discount beyond the tier ceiling", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeRegistration(w, partner);
    await w.container.services.registration.submit(w.ctx, registration.id);

    await expectRejects(
      w.container.services.registration.approve(w.ctx, registration.id, { protectionDays: 200 }),
      "POLICY_VIOLATION",
      "exceeds the gold ceiling of 135 days",
    );
    await expectRejects(
      w.container.services.registration.approve(w.ctx, registration.id, { discountBps: 2_500 }),
      "POLICY_VIOLATION",
      "exceeds the gold band of 1800bps",
    );

    // A reviewer may always grant less than the tier's default.
    await w.container.services.registration.approve(w.ctx, registration.id, { protectionDays: 30, discountBps: 500 });
    assert.equal(registration.protection?.grantedDays, 30);
    assert.equal(registration.discountBps, 500);
  });

  it("refuses approval while a conflict case is open, and allows it once resolved", async () => {
    const w = world();
    const incumbent = await makePartner(w, { code: "NORTHWIND" });
    const challenger = await makePartner(w, { code: "HELIOS" });
    await makeApprovedRegistration(w, incumbent);
    const contested = await makeRegistration(w, challenger);
    const { conflicts } = await w.container.services.registration.submit(w.ctx, contested.id);

    await expectRejects(
      w.container.services.registration.approve(w.ctx, contested.id),
      "INVALID_STATE",
      "open conflict case",
    );

    await w.container.services.conflict.withdraw(w.ctx, conflicts[0]!.id, "partner stood down");
    await w.container.services.registration.approve(w.ctx, contested.id);
    assert.equal(contested.status, "approved");
  });

  it("extends protection within the tier's head-room and refuses beyond it", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeApprovedRegistration(w, partner);
    const originalEnd = registration.protection!.endsAt;

    await w.container.services.registration.extendProtection(w.ctx, registration.id, {
      days: 45,
      reason: "customer moved the decision into the next budget cycle",
    });
    assert.equal(registration.protection!.endsAt, addDays(originalEnd, 45));
    assert.equal(registration.protection!.extensions.length, 1);

    await w.container.services.registration.extendProtection(w.ctx, registration.id, {
      days: 10,
      reason: "final legal review",
    });
    await expectRejects(
      w.container.services.registration.extendProtection(w.ctx, registration.id, { days: 10, reason: "again" }),
      "POLICY_VIOLATION",
      "the tier allows 2",
    );
  });

  it("rejects with a reason code and refuses to reject twice", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeRegistration(w, partner);
    await w.container.services.registration.submit(w.ctx, registration.id);
    await w.container.services.registration.reject(w.ctx, registration.id, {
      reasonCode: "insufficient_detail",
      notes: "No named buying contact",
    });
    assert.equal(registration.status, "rejected");
    assert.equal(registration.rejection?.reasonCode, "insufficient_detail");
    await expectRejects(
      w.container.services.registration.reject(w.ctx, registration.id, { reasonCode: "duplicate" }),
      "INVALID_STATE",
      "is rejected",
    );
  });
});

describe("the life of an approved registration", () => {
  it("freezes product lines and the customer once submitted", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeRegistration(w, partner);
    await w.container.services.registration.updateDetails(w.ctx, registration.id, { productLines: ["endpoint"] });
    assert.deepEqual(registration.productLines, ["endpoint"]);

    await w.container.services.registration.submit(w.ctx, registration.id);
    await expectRejects(
      w.container.services.registration.updateDetails(w.ctx, registration.id, { productLines: ["network-security"] }),
      "INVALID_STATE",
      "frozen once",
    );
    // The commercial body of the deal stays editable.
    await w.container.services.registration.updateDetails(w.ctx, registration.id, { estimatedValue: usd(30_000_000) });
    assert.deepEqual(registration.estimatedValue, usd(30_000_000));
  });

  it("moves the forecast and resets probability to the stage default", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeApprovedRegistration(w, partner);

    await w.container.services.registration.updateForecast(w.ctx, registration.id, { stage: "negotiation" });
    assert.equal(registration.stage, "negotiation");
    assert.equal(registration.probability, 75);

    await w.container.services.registration.updateForecast(w.ctx, registration.id, { probability: 40 });
    assert.equal(registration.probability, 40, "a manager can mark a deal down without moving the stage");

    await expectRejects(
      w.container.services.registration.updateForecast(w.ctx, registration.id, { stage: "closed_won" }),
      "INVALID_STATE",
      "Use win/lose to close",
    );
  });

  it("closes won in the registered currency and reports the cycle time", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeApprovedRegistration(w, partner);
    w.clock.advanceDays(40);

    await expectRejects(
      w.container.services.registration.markWon(w.ctx, registration.id, { value: money(1_000, "EUR") }),
      "VALIDATION",
      "must be in USD",
    );
    await w.container.services.registration.markWon(w.ctx, registration.id, { value: usd(24_000_000) });

    assert.equal(registration.status, "closed_won");
    assert.equal(registration.stage, "closed_won");
    assert.equal(registration.probability, 100);
    assert.equal(registration.cycleDays(), 40);
    assert.equal(registration.isProtectedAt(w.clock.now()), true, "a won deal keeps its window for attribution");
  });

  it("closes lost, names the competitor and releases the customer immediately", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeApprovedRegistration(w, partner);
    w.clock.advanceDays(10);

    await expectRejects(
      w.container.services.registration.markLost(w.ctx, registration.id, { reason: "competitor" }),
      "VALIDATION",
      "name the competitor",
    );
    await w.container.services.registration.markLost(w.ctx, registration.id, {
      reason: "competitor",
      competitor: "Palo Alto Networks",
    });

    assert.equal(registration.status, "closed_lost");
    assert.deepEqual(registration.closure?.value, usd(0));
    assert.equal(registration.protection!.endsAt, w.clock.now(), "protection is cut at the loss");
    assert.equal(registration.isProtectedAt(w.clock.now()), false);

    // The space is free again: another partner can register the same customer.
    const challenger = await makePartner(w, { code: "HELIOS" });
    const fresh = await makeRegistration(w, challenger);
    const result = await w.container.services.registration.submit(w.ctx, fresh.id);
    assert.deepEqual(result.findings, []);
  });

  it("withdraws a protected registration and frees the customer", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeApprovedRegistration(w, partner);
    w.clock.advanceDays(5);
    await w.container.services.registration.withdraw(w.ctx, registration.id, "partner no longer engaged");

    assert.equal(registration.status, "withdrawn");
    assert.equal(registration.protection!.endsAt, w.clock.now());
    assert.ok(eventTypes(w).includes(ChannelEventTypes.DealRegistrationWithdrawn));
  });

  it("expires only once its window has actually lapsed", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeApprovedRegistration(w, partner);

    await expectRejects(
      w.container.services.registration.expire(w.ctx, registration.id),
      "INVALID_STATE",
      "protection has not lapsed",
    );

    w.clock.advanceDays(GOLD.protectionDays + 1);
    await w.container.services.registration.expire(w.ctx, registration.id);
    assert.equal(registration.status, "expired");
    assert.equal(eventsOfType(w, ChannelEventTypes.DealRegistrationExpired).length, 1);
  });
});

describe("the portal pre-check", () => {
  it("answers eligibility, conflicts and the likely outcome without writing anything", async () => {
    const w = world();
    const incumbent = await makePartner(w, { code: "NORTHWIND" });
    const challenger = await makePartner(w, { code: "HELIOS", tier: "silver", territories: ["NA"] });
    await makeApprovedRegistration(w, incumbent);

    const clean = await w.container.services.registration.precheck(w.ctx, {
      partnerId: challenger.id,
      endCustomer: { name: "Fabrikam", domain: "fabrikam.de", country: "US" },
      productLines: ["network-security"],
      estimatedValue: usd(500_000),
    });
    assert.deepEqual(clean.reasons, []);
    assert.equal(clean.eligible, true);
    assert.equal(clean.blocked, false);
    assert.equal(clean.autoApprovalLikely, true);
    assert.equal(clean.protectionDays, DEFAULT_TIER_POLICIES.silver.protectionDays);

    const contested = await w.container.services.registration.precheck(w.ctx, {
      partnerId: challenger.id,
      endCustomer: { name: "Contoso", domain: "contoso.com", country: "US" },
      productLines: ["network-security"],
      estimatedValue: usd(500_000),
    });
    assert.equal(contested.blocked, true);
    assert.equal(contested.autoApprovalLikely, false);
    assert.equal(contested.findings[0]!.kind, "partner_vs_partner");

    const ineligible = await w.container.services.registration.precheck(w.ctx, {
      partnerId: challenger.id,
      endCustomer: { name: "Initech", domain: "initech.io", country: "SG" },
      productLines: ["cloud-platform"],
    });
    assert.equal(ineligible.eligible, false);
    assert.equal(ineligible.reasons.length, 2, "out of territory and unauthorized product line");

    const registrations = await w.container.repos.registrations.all("acme" as never);
    assert.equal(registrations.length, 1, "a pre-check creates nothing");
  });
});
