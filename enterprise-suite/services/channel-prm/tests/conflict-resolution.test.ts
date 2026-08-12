import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConflictCase } from "../src/domain/conflict.js";
import type { DealRegistration } from "../src/domain/deal-registration.js";
import { ChannelEventTypes } from "../src/domain/events.js";
import { DEFAULT_TIER_POLICIES } from "../src/domain/partner.js";
import {
  eventsOfType,
  expectRejects,
  makeApprovedRegistration,
  makePartner,
  makeRegistration,
  usd,
  world,
  type TestWorld,
} from "./helpers.js";

/** Two partners on the same customer: an approved incumbent and an open case. */
async function contestedCustomer(w: TestWorld = world()): Promise<{
  w: TestWorld;
  incumbent: DealRegistration;
  claimant: DealRegistration;
  conflict: ConflictCase;
}> {
  const northwind = await makePartner(w, { code: "NORTHWIND", tier: "gold" });
  const helios = await makePartner(w, { code: "HELIOS", tier: "silver" });
  const incumbent = await makeApprovedRegistration(w, northwind);
  const claimant = await w.container.services.registration.create(w.partnerCtx("marek"), {
    partnerId: helios.id,
    endCustomer: { name: "Contoso Manufacturing GmbH", domain: "contoso.com", country: "DE" },
    productLines: ["network-security"],
    estimatedValue: usd(20_000_000),
    expectedCloseDate: "2026-06-01T00:00:00.000Z" as never,
    description: "The German subsidiary asked us to quote the same firewall refresh for their Cologne site.",
  });
  const result = await w.container.services.registration.submit(w.partnerCtx("marek"), claimant.id);
  return { w, incumbent, claimant, conflict: result.conflicts[0]! };
}

describe("adjudicating a channel conflict", () => {
  it("opens the case with a recommendation, an SLA and both registrations attached", async () => {
    const { w, incumbent, claimant, conflict } = await contestedCustomer();

    assert.equal(conflict.status, "open");
    assert.equal(conflict.kind, "partner_vs_partner");
    assert.equal(conflict.claimantRegistrationId, claimant.id);
    assert.equal(conflict.incumbentRegistrationId, incumbent.id);
    assert.equal(conflict.recommendedOutcome, "incumbent_upheld");
    // Silver claimant: the case must be worked inside the silver conflict SLA.
    assert.equal(
      conflict.slaDueAt,
      new Date(Date.parse(conflict.raisedAt) + DEFAULT_TIER_POLICIES.silver.conflictSlaHours * 3_600_000).toISOString(),
    );
    assert.deepEqual(incumbent.conflictCaseIds, [conflict.id]);
    assert.equal(eventsOfType(w, ChannelEventTypes.ConflictRaised).length, 1);
  });

  it("collects evidence from both sides and stops once decided", async () => {
    const { w, conflict } = await contestedCustomer();
    await w.container.services.conflict.addEvidence(w.partnerCtx("marek"), conflict.id, {
      source: "claimant",
      note: "Purchasing in Cologne approached us directly; email thread attached.",
    });
    await w.container.services.conflict.addEvidence(w.partnerCtx("dana"), conflict.id, {
      source: "incumbent",
      note: "The global framework is negotiated in Cleveland and covers Cologne.",
    });
    assert.equal(conflict.evidence.length, 2);
    await expectRejects(
      w.container.services.conflict.addEvidence(w.ctx, conflict.id, { source: "vendor", note: "hi" }),
      "VALIDATION",
      "at least 5 characters",
    );

    await w.container.services.conflict.resolve(w.ctx, conflict.id, {
      outcome: "incumbent_upheld",
      rationale: "First to register and demonstrably still working the account.",
    });
    await expectRejects(
      w.container.services.conflict.addEvidence(w.ctx, conflict.id, {
        source: "vendor",
        note: "late addition to a closed case",
      }),
      "INVALID_STATE",
      "evidence is closed",
    );
  });

  it("upholding the incumbent rejects the claimant and leaves protection untouched", async () => {
    const { w, incumbent, claimant, conflict } = await contestedCustomer();
    const untouched = incumbent.protection!.endsAt;

    await w.container.services.conflict.resolve(w.ctx, conflict.id, {
      outcome: "incumbent_upheld",
      rationale: "Northwind registered first and is running an active proposal.",
    });

    assert.equal(conflict.status, "resolved");
    assert.equal(conflict.resolution?.awardedRegistrationId, incumbent.id);
    assert.equal(claimant.status, "rejected");
    assert.equal(claimant.rejection?.reasonCode, "conflict_lost");
    assert.equal(incumbent.status, "approved");
    assert.equal(incumbent.protection!.endsAt, untouched);
  });

  it("awarding the claimant approves it and cuts the incumbent's window at the decision", async () => {
    const { w, incumbent, claimant, conflict } = await contestedCustomer();
    w.clock.advanceDays(3);

    await w.container.services.conflict.resolve(w.ctx, conflict.id, {
      outcome: "claimant_awarded",
      rationale: "The incumbent has not touched the deal since registering it.",
      protectionDays: 45,
    });

    assert.equal(claimant.status, "approved");
    assert.equal(claimant.protection?.grantedDays, 45);
    assert.equal(claimant.approval?.notes, `Awarded by conflict ${conflict.number}`);
    assert.equal(incumbent.protection!.endsAt, w.clock.now(), "the loser's exclusivity ends now");
    assert.equal(incumbent.isProtectedAt(w.clock.now()), false);
    assert.equal(eventsOfType(w, ChannelEventTypes.DealRegistrationProtectionTruncated).length, 1);
  });

  it("co-sell approves the claimant while the incumbent keeps its window", async () => {
    const { w, incumbent, claimant, conflict } = await contestedCustomer();
    const incumbentEnd = incumbent.protection!.endsAt;

    await w.container.services.conflict.resolve(w.ctx, conflict.id, {
      outcome: "co_sell",
      rationale: "Both partners hold genuine relationships in different parts of the group.",
    });

    assert.equal(claimant.status, "approved");
    assert.equal(incumbent.status, "approved");
    assert.equal(incumbent.protection!.endsAt, incumbentEnd);
    assert.equal(claimant.isProtectedAt(w.clock.now()), true);
  });

  it("a split needs a claimant share, and other outcomes must not carry one", async () => {
    const { w, conflict } = await contestedCustomer();
    await expectRejects(
      w.container.services.conflict.resolve(w.ctx, conflict.id, {
        outcome: "split",
        rationale: "Both sides contributed to the opportunity.",
      }),
      "VALIDATION",
      "between 1 and 9999 basis points",
    );
    await expectRejects(
      w.container.services.conflict.resolve(w.ctx, conflict.id, {
        outcome: "co_sell",
        rationale: "Both sides contributed to the opportunity.",
        splitBps: 5_000,
      }),
      "VALIDATION",
      'only meaningful for a "split"',
    );

    await w.container.services.conflict.resolve(w.ctx, conflict.id, {
      outcome: "split",
      rationale: "Sixty/forty in the claimant's favour on sourcing evidence.",
      splitBps: 6_000,
    });
    assert.equal(conflict.resolution?.splitBps, 6_000);
  });

  it("rejecting both claims clears the customer entirely", async () => {
    const { w, incumbent, claimant, conflict } = await contestedCustomer();
    await w.container.services.conflict.resolve(w.ctx, conflict.id, {
      outcome: "both_rejected",
      rationale: "Neither partner has a mandate; the account moves to the direct team.",
    });

    assert.equal(claimant.status, "rejected");
    assert.equal(incumbent.isProtectedAt(w.clock.now()), false);
    assert.equal(conflict.resolution?.awardedRegistrationId, undefined);
  });

  it("refuses a two-sided outcome when there is no incumbent to weigh", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeRegistration(w, partner);
    await w.container.services.registration.submit(w.ctx, registration.id);
    const conflict = await w.container.services.conflict.raiseCase(w.ctx, registration, {
      kind: "partner_vs_direct",
      severity: "blocking",
      customerKey: registration.customerKey,
      overlappingProductLines: ["network-security"],
      overlapDays: 0,
      explanation: "raised by hand for an account the direct team claims",
    });
    await expectRejects(
      w.container.services.conflict.resolve(w.ctx, conflict.id, {
        outcome: "co_sell",
        rationale: "Nobody to co-sell with, so this should be refused.",
      }),
      "INVALID_STATE",
      "has no incumbent registration",
    );
  });

  it("escalates, halving the remaining clock, up to the top level", async () => {
    const { w, conflict } = await contestedCustomer();
    const originalDue = Date.parse(conflict.slaDueAt);

    await w.container.services.conflict.escalate(w.ctx, conflict.id, "no response from the claimant");
    assert.equal(conflict.escalationLevel, 1);
    assert.ok(Date.parse(conflict.slaDueAt) < originalDue, "escalation shortens the clock");

    await w.container.services.conflict.escalate(w.ctx, conflict.id, "still nothing");
    await w.container.services.conflict.escalate(w.ctx, conflict.id, "to the channel director");
    await expectRejects(
      w.container.services.conflict.escalate(w.ctx, conflict.id, "there is nowhere left to go"),
      "INVALID_STATE",
      "highest escalation level",
    );
  });

  it("reports cases past their SLA to the escalation queue", async () => {
    const { w, conflict } = await contestedCustomer();
    assert.deepEqual(await w.container.services.conflict.overdue(w.ctx), []);
    w.clock.advanceDays(DEFAULT_TIER_POLICIES.silver.conflictSlaHours / 24 + 1);
    const overdue = await w.container.services.conflict.overdue(w.ctx);
    assert.deepEqual(overdue.map((c) => c.number), [conflict.number]);
    assert.equal(conflict.isOverdueAt(w.clock.now()), true);
  });

  it("withdraws a case without touching either registration", async () => {
    const { w, incumbent, claimant, conflict } = await contestedCustomer();
    await w.container.services.conflict.withdraw(w.ctx, conflict.id, "claimant withdrew after a call");

    assert.equal(conflict.status, "withdrawn");
    assert.equal(claimant.status, "submitted");
    assert.equal(incumbent.status, "approved");
    await expectRejects(
      w.container.services.conflict.resolve(w.ctx, conflict.id, {
        outcome: "incumbent_upheld",
        rationale: "Too late, the case is already closed.",
      }),
      "INVALID_STATE",
      "already withdrawn",
    );
  });

  it("manages the house-account list the detector reads", async () => {
    const w = world();
    await w.container.services.conflict.addDirectClaim(w.ctx, {
      customerKey: "domain:globex.com",
      reason: "owned by the direct enterprise team",
    });
    assert.equal((await w.container.services.conflict.listDirectClaims(w.ctx)).length, 1);
    await expectRejects(
      w.container.services.conflict.addDirectClaim(w.ctx, { customerKey: "domain:x.com", reason: " " }),
      "VALIDATION",
      "a reason is required",
    );
    await w.container.services.conflict.removeDirectClaim(w.ctx, "domain:globex.com");
    assert.deepEqual(await w.container.services.conflict.listDirectClaims(w.ctx), []);
  });
});
