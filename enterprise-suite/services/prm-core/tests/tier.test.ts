import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money, type Ulid } from "@enterprise-suite/shared-kernel";
import { STANDARD_TIERS, createTierDefinition, evaluateTier } from "../src/domain/tier.js";
import { activeContract, approvedPartner, expectRejects, portalUser, usd, world, type TestWorld } from "./helpers.js";

const tenant = "acme";
const definitions = STANDARD_TIERS.map((input) => createTierDefinition(tenant as never, input));

describe("tier qualification (pure)", () => {
  it("qualifies for the highest tier whose requirements are all met", async () => {
    const evaluation = evaluateTier(definitions, {
      trailingRevenue: usd(80_000),
      certifiedIndividuals: 3,
      heldCertificationCodes: ["sales-pro"],
      dealsWon: 9,
      monthsActive: 14,
      hasActiveContract: true,
    });
    assert.equal(evaluation.eligibleTierCode, "silver");
    assert.equal(evaluation.recommendation, "initial");
    // Gold is out of reach on revenue, head-count and the technical certification.
    assert.deepEqual(
      evaluation.gapsToNextTier.map((g) => g.requirement).sort(),
      ["certification", "certifiedIndividuals", "trailingRevenue"],
    );
  });

  it("never trades revenue against a certification requirement", () => {
    const evaluation = evaluateTier(definitions, {
      trailingRevenue: usd(5_000_000),
      certifiedIndividuals: 40,
      heldCertificationCodes: ["sales-pro"],
      dealsWon: 400,
      monthsActive: 60,
      hasActiveContract: true,
    });
    assert.equal(evaluation.eligibleTierCode, "silver");
    const gold = evaluation.qualifications.find((q) => q.tierCode === "gold");
    assert.equal(gold?.qualifies, false);
    assert.deepEqual(gold?.gaps.map((g) => g.required), ["tech-pro"]);
  });

  it("reports a downgrade when the current tier is no longer earned", () => {
    const evaluation = evaluateTier(definitions, {
      trailingRevenue: usd(100),
      certifiedIndividuals: 0,
      heldCertificationCodes: [],
      dealsWon: 0,
      monthsActive: 24,
      hasActiveContract: true,
      currentTierCode: "gold",
    });
    assert.equal(evaluation.eligibleTierCode, "registered");
    assert.equal(evaluation.recommendation, "downgrade");
  });

  it("qualifies for nothing without a signed contract", () => {
    const evaluation = evaluateTier(definitions, {
      trailingRevenue: usd(1_000_000),
      certifiedIndividuals: 20,
      heldCertificationCodes: ["sales-pro", "tech-pro", "tech-expert"],
      dealsWon: 100,
      monthsActive: 36,
      hasActiveContract: false,
    });
    assert.equal(evaluation.eligibleTierCode, undefined);
    assert.equal(evaluation.recommendation, "hold");
  });

  it("rejects a mismatched revenue currency rather than comparing it", () => {
    const evaluation = evaluateTier(definitions, {
      trailingRevenue: money(900_000_00, "EUR"),
      certifiedIndividuals: 5,
      heldCertificationCodes: ["sales-pro", "tech-pro"],
      dealsWon: 30,
      monthsActive: 24,
      hasActiveContract: true,
    });
    const gold = evaluation.qualifications.find((q) => q.tierCode === "gold");
    assert.deepEqual(gold?.gaps.map((g) => g.requirement), ["trailingRevenue"]);
  });
});

/** Certifies `count` distinct people at the partner on `code`. */
async function certify(w: TestWorld, partnerId: Ulid, code: string, count: number): Promise<void> {
  const { training } = w.container.services;
  const definition = await training.getCertificationDefinition(w.ctx, code);
  for (let i = 0; i < count; i += 1) {
    const userId = await portalUser(w, partnerId, `${code}-${i}@contoso.example`, ["technical_lead"]);
    for (const courseCode of definition.requiredCourseCodes) {
      const enrollment = await training.enroll(w.ctx, { portalUserId: userId, courseCode });
      await training.startEnrollment(w.ctx, enrollment.id);
      await training.recordAttempt(w.ctx, enrollment.id, { score: 95 });
    }
    await training.award(w.ctx, { portalUserId: userId, certificationCode: code });
  }
}

async function trainingCatalog(w: TestWorld): Promise<void> {
  const { training } = w.container.services;
  await training.createCourse(w.ctx, {
    code: "sales-foundations",
    title: "Selling the platform",
    track: "sales",
    deliveryMode: "self_paced",
    durationMinutes: 120,
  });
  await training.createCertificationDefinition(w.ctx, {
    code: "sales-pro",
    name: "Certified Sales Professional",
    track: "sales",
    level: "professional",
    requiredCourseCodes: ["sales-foundations"],
  });
}

describe("tier administration", () => {
  it("installs the standard program once and is idempotent", async () => {
    const w = world();
    const first = await w.container.services.tier.installStandardProgram(w.ctx);
    const second = await w.container.services.tier.installStandardProgram(w.ctx);
    assert.deepEqual(first.map((t) => t.code), ["registered", "silver", "gold", "platinum"]);
    assert.deepEqual(second.map((t) => t.id), first.map((t) => t.id));
    await expectRejects(
      w.container.services.tier.createTier(w.ctx, {
        code: "elite",
        name: "Elite",
        rank: 30,
        benefits: {
          baseDiscountBps: 1500,
          dealRegistrationBonusBps: 0,
          mdfAccrualBps: 0,
          mdfRequestCapBps: 10_000,
          leadSharing: false,
          namedChannelManager: false,
          supportLevel: "standard",
          nfrSeats: 0,
        },
      }),
      "CONFLICT",
      "Rank 30 is already used",
    );
  });

  it("collects facts from contracts, revenue and certifications", async () => {
    const w = world();
    await w.container.services.tier.installStandardProgram(w.ctx);
    await trainingCatalog(w);
    const partner = await approvedPartner(w);
    await activeContract(w, partner.id);
    await w.container.services.partner.activate(w.ctx, partner.id);
    await certify(w, partner.id, "sales-pro", 2);
    await w.container.services.partner.recordPerformance(w.ctx, partner.id, {
      period: "FY26-Q1",
      bookedRevenue: usd(60_000),
      dealsRegistered: 12,
      dealsWon: 7,
    });

    const facts = await w.container.services.tier.facts(w.ctx, partner.id);
    assert.equal(facts.hasActiveContract, true);
    assert.equal(facts.certifiedIndividuals, 2);
    assert.deepEqual([...facts.heldCertificationCodes], ["sales-pro"]);
    assert.equal(facts.trailingRevenue.amountMinor, usd(60_000).amountMinor);
    assert.equal(facts.dealsWon, 7);
  });

  it("auto-assigns the earned tier and holds the line on the rest", async () => {
    const w = world();
    await w.container.services.tier.installStandardProgram(w.ctx);
    await trainingCatalog(w);
    const partner = await approvedPartner(w);
    await activeContract(w, partner.id);
    await w.container.services.partner.activate(w.ctx, partner.id);

    const initial = await w.container.services.tier.autoAssign(w.ctx, partner.id);
    assert.equal(initial.applied, true);
    assert.equal(initial.appliedTierCode, "registered");
    assert.equal(initial.evaluation.recommendation, "initial");

    const again = await w.container.services.tier.autoAssign(w.ctx, partner.id);
    assert.equal(again.applied, false);
    assert.equal(again.skippedReason, "already in the correct tier");

    // Silver needs revenue, two certified people and three months of trading.
    await expectRejects(
      w.container.services.tier.assign(w.ctx, partner.id, { tierCode: "silver", reason: "Because" }),
      "TIER_INELIGIBLE",
      "certifiedIndividuals",
    );

    await certify(w, partner.id, "sales-pro", 2);
    await w.container.services.partner.recordPerformance(w.ctx, partner.id, {
      period: "FY26-Q1",
      bookedRevenue: usd(60_000),
      dealsRegistered: 10,
      dealsWon: 6,
    });
    w.clock.advanceDays(120);

    const upgraded = await w.container.services.tier.autoAssign(w.ctx, partner.id);
    assert.equal(upgraded.appliedTierCode, "silver");
    assert.equal(upgraded.evaluation.recommendation, "upgrade");
    const benefits = await w.container.services.tier.benefitsFor(w.ctx, partner.id);
    assert.equal(benefits?.mdfAccrualBps, 100);
    assert.equal(benefits?.nfrSeats, 3);

    const reloaded = await w.container.services.partner.get(w.ctx, partner.id);
    assert.deepEqual(
      reloaded.tierHistory.map((h) => `${h.tierCode}:${h.direction}`),
      ["registered:initial", "silver:upgrade"],
    );
  });

  it("suppresses downgrades unless the review asks for them", async () => {
    const w = world();
    await w.container.services.tier.installStandardProgram(w.ctx);
    const partner = await approvedPartner(w);
    await activeContract(w, partner.id);
    await w.container.services.partner.activate(w.ctx, partner.id);
    await w.container.services.tier.assign(w.ctx, partner.id, {
      tierCode: "gold",
      reason: "Program launch migration from the legacy portal",
      override: true,
    });

    const held = await w.container.services.tier.reviewAll(w.ctx);
    assert.equal(held[0]?.applied, false);
    assert.equal(held[0]?.skippedReason, "downgrade suppressed");

    const applied = await w.container.services.tier.reviewAll(w.ctx, { allowDowngrade: true });
    assert.equal(applied[0]?.appliedTierCode, "registered");
    const reloaded = await w.container.services.partner.get(w.ctx, partner.id);
    assert.equal(reloaded.tierCode, "registered");
    assert.ok(reloaded.tierHistory[0]?.reason.startsWith("[override]"));
  });

  it("requires a substantive reason for an override", async () => {
    const w = world();
    await w.container.services.tier.installStandardProgram(w.ctx);
    const partner = await approvedPartner(w);
    await expectRejects(
      w.container.services.tier.assign(w.ctx, partner.id, {
        tierCode: "platinum",
        reason: "vip",
        override: true,
      }),
      "VALIDATION",
      "substantive reason",
    );
  });
});
