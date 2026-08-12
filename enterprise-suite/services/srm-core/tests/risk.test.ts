import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Ulid, UserId } from "@enterprise-suite/shared-kernel";
import { addMonths, type DateOnly } from "../src/domain/dates.js";
import { SrmEventTypes } from "../src/domain/events.js";
import { severityForScore, tierForProfileScore } from "../src/domain/risk.js";
import { actor, activeSupplier, expectRejects, world, type TestWorld } from "./helpers.js";

async function flagged(
  w: TestWorld,
  supplierId: Ulid,
  overrides: Partial<Parameters<TestWorld["container"]["services"]["risk"]["raiseFlag"]>[2]> = {},
) {
  return w.container.services.risk.raiseFlag(w.ctx, supplierId, {
    category: "financial",
    title: "Credit rating downgraded to B-",
    source: "monitoring",
    likelihood: 3,
    impact: 4,
    detectedOn: w.today,
    ...overrides,
  });
}

describe("risk scoring", () => {
  it("grades a flag by likelihood x impact", () => {
    assert.equal(severityForScore(4), "low", "2x2 is noise");
    assert.equal(severityForScore(6), "medium");
    assert.equal(severityForScore(12), "high");
    assert.equal(severityForScore(20), "critical", "4x5 is board-level");
  });

  it("banks the profile tier off the projected score", () => {
    assert.equal(tierForProfileScore(19), "low");
    assert.equal(tierForProfileScore(20), "medium");
    assert.equal(tierForProfileScore(40), "high");
    assert.equal(tierForProfileScore(70), "critical");
  });

  it("lets the worst open risk dominate but still counts the rest", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;

    const single = await risk.raiseFlag(w.ctx, supplier.id, {
      category: "delivery",
      title: "Single line down",
      source: "internal",
      likelihood: 2,
      impact: 3,
      detectedOn: w.today,
    });
    assert.equal(single.inherentScore, 6);
    let profile = await risk.profile(w.ctx, supplier.id);
    assert.equal(profile.score, 22, "6 x 3.6 rounded");
    assert.equal(profile.tier, "medium");

    for (const title of ["Second line down", "Third line down"]) {
      await risk.raiseFlag(w.ctx, supplier.id, {
        category: "delivery",
        title,
        source: "internal",
        likelihood: 2,
        impact: 3,
        detectedOn: w.today,
      });
    }
    profile = await risk.profile(w.ctx, supplier.id);
    assert.equal(profile.score, 29, "the two extra 6s add 0.6 each, not another 3.6");
    assert.equal(profile.tier, "medium", "three mediums never outrank one critical");

    await risk.raiseFlag(w.ctx, supplier.id, {
      category: "sanctions",
      title: "Beneficial owner on a watch list",
      source: "monitoring",
      likelihood: 4,
      impact: 5,
      detectedOn: w.today,
    });
    profile = await risk.profile(w.ctx, supplier.id);
    assert.equal(profile.tier, "critical");
    assert.equal(profile.score, 83, "20 x 3.6 plus three 6s at 0.6");
  });

  it("caps the profile score at 100", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    for (let index = 0; index < 6; index += 1) {
      await risk.raiseFlag(w.ctx, supplier.id, {
        category: "operational",
        title: `Critical exposure ${index}`,
        source: "audit",
        likelihood: 5,
        impact: 5,
        detectedOn: w.today,
      });
    }
    const profile = await risk.profile(w.ctx, supplier.id);
    assert.equal(profile.score, 100);
  });

  it("emits a tier change only when the tier actually moves", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    await flagged(w, supplier.id, { likelihood: 2, impact: 3 });
    await flagged(w, supplier.id, { likelihood: 2, impact: 3, title: "Second modest exposure" });
    const tierChanges = () =>
      w.container.outbox.entries(w.ctx.tenantId).filter((event) => event.eventType === SrmEventTypes.RiskTierChanged);
    assert.equal(tierChanges().length, 1, "low -> medium once; the second small flag stays inside the band");

    await risk.raiseFlag(w.ctx, supplier.id, {
      category: "cyber",
      title: "Ransomware at a subcontractor",
      source: "news",
      likelihood: 4,
      impact: 5,
      detectedOn: w.today,
    });
    const changes = tierChanges();
    assert.equal(changes.length, 2);
    assert.equal((changes[1]?.payload as { from: string; to: string }).from, "medium");
    assert.equal((changes[1]?.payload as { from: string; to: string }).to, "critical");
  });
});

describe("risk flags", () => {
  it("rejects a score outside the 1-5 register scale", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    await expectRejects(flagged(w, supplier.id, { likelihood: 0 }), "VALIDATION", "likelihood");
    await expectRejects(flagged(w, supplier.id, { impact: 6 }), "VALIDATION", "impact");
    await expectRejects(
      flagged(w, supplier.id, { category: "made_up" as never }),
      "VALIDATION",
      "category",
    );
  });

  it("keeps one open flag per automated source rather than a duplicate every night", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    const first = await flagged(w, supplier.id, { sourceRef: "sanctions-feed:ofac-4411" });
    await expectRejects(
      flagged(w, supplier.id, { sourceRef: "sanctions-feed:ofac-4411" }),
      "INVALID_STATE",
      "already tracks",
    );

    await risk.closeFlag(w.ctx, supplier.id, first.id, "Screening false positive");
    const reopened = await flagged(w, supplier.id, { sourceRef: "sanctions-feed:ofac-4411" });
    assert.equal(reopened.status, "open", "a closed flag no longer suppresses the feed");
  });

  it("lowers the residual exposure without erasing the inherent score", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    const flag = await flagged(w, supplier.id, { likelihood: 4, impact: 4 });
    assert.equal(flag.severity, "critical");

    const mitigated = await risk.mitigateFlag(w.ctx, supplier.id, flag.id, {
      plan: "Second-source the two sole-supplied parts and shorten payment terms",
      ownerId: "buyer-1" as UserId,
      dueOn: addMonths(w.today, 3),
      residualLikelihood: 2,
      residualImpact: 3,
    });
    assert.equal(mitigated.status, "mitigating");
    assert.equal(mitigated.inherentScore, 16, "the audit trail keeps what the risk was");
    assert.equal(mitigated.residualScore, 6);
    assert.equal(mitigated.severity, "medium", "severity follows the residual once there is one");
    assert.equal((await risk.profile(w.ctx, supplier.id)).tier, "medium");
  });

  it("refuses a mitigation that claims more than the risk ever was", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const flag = await flagged(w, supplier.id, { likelihood: 2, impact: 2 });
    await expectRejects(
      w.container.services.risk.mitigateFlag(w.ctx, supplier.id, flag.id, {
        plan: "Discovered a bigger problem while mitigating",
        ownerId: "buyer-1" as UserId,
        dueOn: addMonths(w.today, 1),
        residualLikelihood: 4,
        residualImpact: 4,
      }),
      "VALIDATION",
      "exceeds the inherent score",
    );
  });

  it("will not let anyone sign off a critical risk", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    const flag = await flagged(w, supplier.id, { likelihood: 4, impact: 5 });
    await expectRejects(
      risk.acceptFlag(w.ctx, supplier.id, flag.id, "Commercially unavoidable"),
      "INVALID_STATE",
      "cannot be accepted",
    );

    const mitigated = await risk.mitigateFlag(w.ctx, supplier.id, flag.id, {
      plan: "Dual-source and hold four weeks of safety stock",
      ownerId: "buyer-1" as UserId,
      dueOn: addMonths(w.today, 2),
      residualLikelihood: 2,
      residualImpact: 3,
    });
    assert.equal(mitigated.severity, "medium");
    const accepted = await risk.acceptFlag(w.ctx, supplier.id, flag.id, "Residual is inside appetite");
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.acceptedBy, w.ctx.userId);
    const profile = await risk.profile(w.ctx, supplier.id);
    assert.equal(profile.openFlags().length, 0, "an accepted risk leaves the open register");
    assert.equal(profile.tier, "low");
  });

  it("queues the flags whose review date has arrived, oldest first", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const other = await activeSupplier(w, "BETA-CAST");
    const { risk } = w.container.services;

    await flagged(w, supplier.id, { title: "Review in March", reviewDueOn: "2026-03-01" as DateOnly });
    await flagged(w, other.id, { title: "Review in February", reviewDueOn: "2026-02-01" as DateOnly });
    const future = await flagged(w, supplier.id, {
      title: "Review in December",
      reviewDueOn: "2026-12-01" as DateOnly,
    });
    assert.equal((await risk.reviewQueue(w.ctx)).length, 0, "nothing is due on day one");

    w.clock.set("2026-03-15T00:00:00.000Z");
    const queue = await risk.reviewQueue(w.ctx);
    assert.deepEqual(
      queue.map((entry) => entry.flag.title),
      ["Review in February", "Review in March"],
    );

    await risk.closeFlag(w.ctx, supplier.id, future.id, "Not a risk after all");
    assert.equal((await risk.reviewQueue(w.ctx)).length, 2, "closed flags never come back for review");
  });

  it("ranks the portfolio and filters to the tier a reviewer asked for", async () => {
    const w = world();
    const calm = await activeSupplier(w, "CALM-CO");
    const hot = await activeSupplier(w, "HOT-CO");
    const { risk } = w.container.services;

    await flagged(w, calm.id, { likelihood: 1, impact: 2, title: "Late paperwork" });
    await flagged(w, hot.id, { likelihood: 5, impact: 5, title: "Sanctions exposure", category: "sanctions" });
    await risk.placeHold(w.ctx, hot.id, { type: "payment", reasonCode: "sanctions_match" });

    const all = await risk.heatmap(w.ctx);
    assert.deepEqual(
      all.map((entry) => entry.supplierCode),
      ["HOT-CO", "CALM-CO"],
      "worst score first",
    );
    assert.equal(all[0]?.topRisk, "Sanctions exposure");
    assert.equal(all[0]?.activeHolds, 1);

    const escalated = await risk.heatmap(w.ctx, "high");
    assert.deepEqual(
      escalated.map((entry) => entry.supplierCode),
      ["HOT-CO"],
    );
  });
});

describe("compliance holds", () => {
  it("stops the activity it names, and sourcing also stops the PO", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    await risk.placeHold(w.ctx, supplier.id, {
      type: "sourcing",
      reasonCode: "failed_audit",
      note: "Q1 process audit failed",
    });

    assert.equal((await risk.clearance(w.ctx, supplier.id, "sourcing")).cleared, false);
    assert.equal(
      (await risk.clearance(w.ctx, supplier.id, "purchase_order")).cleared,
      false,
      "you cannot raise a PO for work you may not source",
    );
    assert.equal((await risk.clearance(w.ctx, supplier.id, "payment")).cleared, true, "existing invoices still pay");
  });

  it("scopes a category hold to the categories it names", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { category, risk } = w.container.services;
    const castings = await category.create(w.ctx, { code: "castings", name: "Castings" });
    const packaging = await category.create(w.ctx, { code: "packaging", name: "Packaging" });

    await risk.placeHold(w.ctx, supplier.id, {
      type: "sourcing",
      reasonCode: "quality_incident",
      scope: "categories",
      categoryIds: [castings.id],
    });

    assert.equal((await risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: castings.id })).cleared, false);
    assert.equal((await risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: packaging.id })).cleared, true);
    assert.equal(
      (await risk.clearance(w.ctx, supplier.id, "sourcing")).cleared,
      false,
      "asking without a category is the conservative question",
    );
  });

  it("insists a scoped hold actually names a scope", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    await expectRejects(
      risk.placeHold(w.ctx, supplier.id, { type: "sourcing", reasonCode: "credit_risk", scope: "categories" }),
      "VALIDATION",
      "at least one category",
    );
    await expectRejects(
      risk.placeHold(w.ctx, supplier.id, { type: "shipment", reasonCode: "credit_risk", scope: "sites" }),
      "VALIDATION",
      "at least one site",
    );
  });

  it("refuses to stack an identical hold", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    await risk.placeHold(w.ctx, supplier.id, { type: "payment", reasonCode: "unverified_bank_details" });
    await expectRejects(
      risk.placeHold(w.ctx, supplier.id, { type: "payment", reasonCode: "unverified_bank_details" }),
      "INVALID_STATE",
      "already active",
    );
    await risk.placeHold(w.ctx, supplier.id, { type: "purchase_order", reasonCode: "unverified_bank_details" });
    assert.equal((await risk.holds(w.ctx, supplier.id)).length, 2, "a different activity is a different control");
  });

  it("answers a blocked command with the hold ids that caused it", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    const hold = await risk.placeHold(w.ctx, supplier.id, { type: "payment", reasonCode: "sanctions_match" });

    try {
      await risk.assertClear(w.ctx, supplier.id, "payment");
      assert.fail("expected the payment to be blocked");
    } catch (error) {
      const err = error as { code: string; status: number; holdIds: string[]; details: { reasonCodes: string[] } };
      assert.equal(err.code, "COMPLIANCE_BLOCKED");
      assert.equal(err.status, 409);
      assert.deepEqual(err.holdIds, [hold.id]);
      assert.deepEqual(err.details.reasonCodes, ["sanctions_match"]);
    }
    await risk.assertClear(w.ctx, supplier.id, "shipment");
  });

  it("only lets the named role lift a hold", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    const hold = await risk.placeHold(w.ctx, supplier.id, {
      type: "sourcing",
      reasonCode: "sanctions_match",
      releaseRoles: ["srm.compliance"],
    });

    await expectRejects(
      risk.releaseHold(actor(w.ctx, "buyer-2"), supplier.id, hold.id, "The supplier says it is fine"),
      "ROLE_REQUIRED",
      "srm.compliance",
    );
    const released = await risk.releaseHold(
      actor(w.ctx, "compliance-1", ["srm.compliance"]),
      supplier.id,
      hold.id,
      "Screening cleared: name match only",
    );
    assert.equal(released.status, "released");
    assert.equal(released.releasedBy, "compliance-1");
    assert.equal((await risk.clearance(w.ctx, supplier.id, "sourcing")).cleared, true);
    await expectRejects(
      risk.releaseHold(w.ctx, supplier.id, hold.id, "Again"),
      "INVALID_STATE",
      "already released",
    );
  });

  it("lets a time-boxed hold fall away on the sweep", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification, risk } = w.container.services;
    await risk.placeHold(w.ctx, supplier.id, {
      type: "shipment",
      reasonCode: "quality_incident",
      note: "Containment while the 8D runs",
      expiresOn: "2026-01-15" as DateOnly,
    });

    w.clock.set("2026-01-14T00:00:00.000Z");
    assert.equal((await qualification.runComplianceSweep(w.ctx)).holdsExpired, 0, "the hold runs to its last day");
    assert.equal((await risk.clearance(w.ctx, supplier.id, "shipment")).cleared, false);

    w.clock.set("2026-01-16T00:00:00.000Z");
    const sweep = await qualification.runComplianceSweep(w.ctx);
    assert.equal(sweep.holdsExpired, 1);
    assert.equal((await risk.clearance(w.ctx, supplier.id, "shipment")).cleared, true);
    const expired = (await risk.holds(w.ctx, supplier.id))[0];
    assert.equal(expired?.status, "expired");
    assert.equal(expired?.releasedBy, undefined, "expiry is not a release; nobody signed it off");
  });

  it("blocks a supplier by placing the hold that enforces the status", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk, supplier: suppliers } = w.container.services;

    await suppliers.block(w.ctx, supplier.id, "Sanctions screening hit");
    const clearance = await risk.clearance(w.ctx, supplier.id, "sourcing");
    assert.equal(clearance.cleared, false);
    assert.equal(clearance.holds[0]?.sourceRef, `supplier-block:${supplier.id}`);
    await expectRejects(
      suppliers.reinstate(w.ctx, supplier.id, "Trade again"),
      "COMPLIANCE_BLOCKED",
      "sourcing hold is active",
    );

    await suppliers.unblock(w.ctx, supplier.id, "Screening cleared");
    assert.equal(
      (await risk.clearance(w.ctx, supplier.id, "sourcing")).cleared,
      true,
      "unblocking lifts the hold it placed, without needing the compliance role twice",
    );
  });

  it("writes the register and the enforcement to the outbox", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { risk } = w.container.services;
    const flag = await flagged(w, supplier.id, { likelihood: 3, impact: 3 });
    await risk.mitigateFlag(w.ctx, supplier.id, flag.id, {
      plan: "Weekly cash-flow reporting",
      ownerId: "buyer-1" as UserId,
      dueOn: addMonths(w.today, 1),
      residualLikelihood: 2,
      residualImpact: 2,
    });
    const hold = await risk.placeHold(w.ctx, supplier.id, { type: "purchase_order", reasonCode: "credit_risk" });
    await risk.releaseHold(w.ctx, supplier.id, hold.id, "Prepayment agreed");
    await risk.closeFlag(w.ctx, supplier.id, flag.id, "Rating restored");

    const types = w.container.outbox.entries(w.ctx.tenantId).map((event) => event.eventType);
    for (const expected of [
      SrmEventTypes.RiskFlagRaised,
      SrmEventTypes.RiskFlagMitigated,
      SrmEventTypes.RiskFlagClosed,
      SrmEventTypes.RiskTierChanged,
      SrmEventTypes.HoldPlaced,
      SrmEventTypes.HoldReleased,
    ]) {
      assert.ok(types.includes(expected), `expected ${expected} in the outbox`);
    }
    const raised = w.container.outbox
      .entries(w.ctx.tenantId)
      .find((event) => event.eventType === SrmEventTypes.RiskFlagRaised);
    assert.equal((raised?.payload as { supplierCode: string }).supplierCode, supplier.code);
    assert.equal(raised?.aggregateType, "SupplierRiskProfile");
  });
});
