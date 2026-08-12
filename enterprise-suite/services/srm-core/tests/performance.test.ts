import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { DateOnly } from "../src/domain/dates.js";
import { SrmEventTypes } from "../src/domain/events.js";
import { ratingForScore } from "../src/domain/scorecard.js";
import { scoreKpi } from "../src/domain/kpi.js";
import { activeSupplier, expectRejects, world, type TestWorld } from "./helpers.js";

const OTD = { direction: "higher_better", target: 98, floor: 85, greenScore: 85, amberScore: 70 } as const;
const PPM = { direction: "lower_better", target: 500, floor: 10_000, greenScore: 85, amberScore: 70 } as const;

/** Mandatory KPIs only, so a scorecard can be published in a few calls. */
const MANDATORY = ["on-time-delivery", "quality-ppm", "price-variance"] as const;

async function seeded(w: TestWorld) {
  await w.container.services.performance.seedStandardKpis(w.ctx);
}

async function publishedScorecard(
  w: TestWorld,
  supplierId: Ulid,
  periodCode: string,
  values: Partial<Record<string, number>> = {},
) {
  const { performance } = w.container.services;
  const scorecard = await performance.openScorecard(w.ctx, supplierId, periodCode);
  const measured = { "on-time-delivery": 97, "quality-ppm": 800, "price-variance": 0.5, ...values };
  for (const [kpiCode, value] of Object.entries(measured)) {
    await performance.recordMeasurement(w.ctx, scorecard.id, { kpiCode, value: value as number });
  }
  return performance.publish(w.ctx, scorecard.id);
}

describe("KPI definitions", () => {
  it("interpolates linearly between floor and target in both directions", () => {
    assert.deepEqual(scoreKpi(OTD, 98), { score: 100, band: "green" });
    assert.deepEqual(scoreKpi(OTD, 91.5), { score: 50, band: "red" });
    assert.deepEqual(scoreKpi(OTD, 99), { score: 100, band: "green" }, "beating the target is capped at 100");
    assert.deepEqual(scoreKpi(OTD, 80), { score: 0, band: "red" }, "below the floor is clamped at 0");
    assert.equal(scoreKpi(PPM, 500).score, 100, "lower_better: hitting the target scores 100");
    assert.equal(scoreKpi(PPM, 5250).score, 50);
    assert.equal(scoreKpi(PPM, 12_000).score, 0);
  });

  it("bands the interpolated score against the definition's thresholds", () => {
    assert.equal(scoreKpi({ ...OTD, greenScore: 90, amberScore: 60 }, 96).band, "amber");
    assert.equal(scoreKpi({ ...OTD, greenScore: 90, amberScore: 60 }, 97.5).band, "green");
  });

  it("rejects a definition whose floor sits on the wrong side of the target", async () => {
    const w = world();
    const { performance } = w.container.services;
    await expectRejects(
      performance.createKpi(w.ctx, {
        code: "backwards",
        name: "Backwards",
        category: "quality",
        unit: "percent",
        direction: "higher_better",
        target: 50,
        floor: 90,
        weight: 10,
      }),
      "VALIDATION",
      "floor must be below the target",
    );
    await expectRejects(
      performance.createKpi(w.ctx, {
        code: "no-weight",
        name: "No weight",
        category: "cost",
        unit: "percent",
        direction: "lower_better",
        target: 0,
        floor: 5,
        weight: 0,
      }),
      "VALIDATION",
      "greater than 0",
    );
  });

  it("seeds the standard catalog once and sorts it by weight", async () => {
    const w = world();
    const { performance } = w.container.services;
    const first = await performance.seedStandardKpis(w.ctx);
    assert.equal(first.length, 10);
    assert.equal((await performance.seedStandardKpis(w.ctx)).length, 0, "seeding is idempotent");
    const listed = await performance.listKpis(w.ctx);
    assert.equal(listed[0]?.weight, 25);
    assert.deepEqual(
      listed.filter((kpi) => kpi.mandatory).map((kpi) => kpi.code).sort(),
      [...MANDATORY].sort(),
    );
  });
});

describe("scorecard lifecycle", () => {
  it("refuses to publish without every mandatory KPI", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { performance } = w.container.services;
    const scorecard = await performance.openScorecard(w.ctx, supplier.id, "2026-Q1");
    await performance.recordMeasurement(w.ctx, scorecard.id, { kpiCode: "on-time-delivery", value: 97 });
    await expectRejects(
      performance.publish(w.ctx, scorecard.id),
      "INVALID_STATE",
      "missing mandatory KPIs: quality-ppm, price-variance",
    );
  });

  it("weights the measured KPIs and derives the rating", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { score, rating } = await publishedScorecard(w, supplier.id, "2026-Q1");
    // OTD 92.3 (w25), PPM 96.8 (w25), PPV 93.8 (w15), weighted over 65.
    assert.equal(score, 94.4);
    assert.equal(rating, "excellent");
    assert.equal(ratingForScore(score), rating);
  });

  it("snapshots the KPI weight so a later re-tuning cannot rewrite history", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { performance } = w.container.services;
    const scorecard = await performance.openScorecard(w.ctx, supplier.id, "2026-Q1");
    await performance.recordMeasurement(w.ctx, scorecard.id, { kpiCode: "on-time-delivery", value: 97 });
    await performance.updateKpi(w.ctx, "on-time-delivery", { weight: 1, target: 100 });
    const reloaded = await performance.getScorecard(w.ctx, scorecard.id);
    const measurement = reloaded.measurement("on-time-delivery")!;
    assert.equal(measurement.weight, 25);
    assert.equal(measurement.target, 98);
  });

  it("will not measure against a retired KPI", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { performance } = w.container.services;
    const scorecard = await performance.openScorecard(w.ctx, supplier.id, "2026-Q1");
    await performance.updateKpi(w.ctx, "fill-rate", { isActive: false });
    await expectRejects(
      performance.recordMeasurement(w.ctx, scorecard.id, { kpiCode: "fill-rate", value: 95 }),
      "INVALID_STATE",
      "retired",
    );
  });

  it("freezes measurements once the period is published", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { scorecard } = await publishedScorecard(w, supplier.id, "2026-Q1");
    await expectRejects(
      w.container.services.performance.recordMeasurement(w.ctx, scorecard.id, {
        kpiCode: "on-time-delivery",
        value: 99,
      }),
      "INVALID_STATE",
      "frozen",
    );
    await expectRejects(
      w.container.services.performance.openScorecard(w.ctx, supplier.id, "2026-Q1"),
      "INVALID_STATE",
      "already exists",
    );
  });

  it("carries the previous period's score forward as a delta", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    await publishedScorecard(w, supplier.id, "2026-Q1");
    const second = await publishedScorecard(w, supplier.id, "2026-Q2", { "on-time-delivery": 90 });
    assert.equal(second.scorecard.previousScore, 94.4);
    assert.ok((second.scorecard.delta() ?? 0) < 0, "a worse quarter shows a negative delta");
  });
});

describe("scorecard disputes", () => {
  it("re-scores from the corrected measurement and keeps the original on record", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { scorecard, score } = await publishedScorecard(w, supplier.id, "2026-Q1", { "on-time-delivery": 88 });
    const { performance } = w.container.services;

    await performance.raiseDispute(w.ctx, scorecard.id, "Three receipts were late because of our own dock closure");
    const resolved = await performance.resolveDispute(w.ctx, scorecard.id, "Buyer-caused delays excluded", [
      { kpiCode: "on-time-delivery", value: 97, reason: "Dock closure days removed from the denominator" },
    ]);
    assert.equal(resolved.status, "published");
    assert.ok((resolved.score ?? 0) > score);
    const measurement = resolved.measurement("on-time-delivery")!;
    assert.equal(measurement.value, 97);
    assert.equal(measurement.adjustments[0]?.previousValue, 88);
    assert.equal(measurement.adjustments[0]?.reason, "Dock closure days removed from the denominator");
  });

  it("closes the dispute window after thirty days", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { scorecard } = await publishedScorecard(w, supplier.id, "2026-Q1");
    w.clock.advanceDays(31);
    await expectRejects(
      w.container.services.performance.raiseDispute(w.ctx, scorecard.id, "Too late"),
      "INVALID_STATE",
      "dispute window",
    );
  });

  it("only corrects KPIs that were actually measured", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { scorecard } = await publishedScorecard(w, supplier.id, "2026-Q1");
    const { performance } = w.container.services;
    await performance.raiseDispute(w.ctx, scorecard.id, "Numbers look wrong");
    await expectRejects(
      performance.resolveDispute(w.ctx, scorecard.id, "Corrected", [
        { kpiCode: "esg-rating", value: 80, reason: "Survey arrived late" },
      ]),
      "INVALID_STATE",
      "was not measured",
    );
  });
});

describe("poor performance escalation", () => {
  it("puts a probation rating on sourcing hold until the plan is worked off", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { performance, risk } = w.container.services;
    const { rating, scorecard } = await publishedScorecard(w, supplier.id, "2026-Q1", {
      "on-time-delivery": 86,
      "quality-ppm": 9000,
      "price-variance": 6,
    });
    assert.equal(rating, "probation");

    const held = await risk.clearance(w.ctx, supplier.id, "sourcing");
    assert.equal(held.cleared, false);
    assert.equal(held.holds[0]?.reasonCode, "performance_probation");

    const profile = await w.container.repos.riskProfiles.bySupplier(w.ctx.tenantId, supplier.id);
    assert.equal(profile?.openFlags().some((flag) => flag.category === "delivery"), true);

    // The period cannot be closed on a promise: the plan has to exist and be done.
    await expectRejects(performance.closeScorecard(w.ctx, scorecard.id), "INVALID_STATE", "needs an improvement plan");
    const action = await performance.addImprovementAction(w.ctx, scorecard.id, {
      title: "Weekly delivery review with the plant",
      dueOn: "2026-06-30" as DateOnly,
      kpiCode: "on-time-delivery",
    });
    await expectRejects(performance.closeScorecard(w.ctx, scorecard.id), "INVALID_STATE", "open improvement action");

    await performance.completeImprovementAction(w.ctx, scorecard.id, action.id, "OTD back at 96% for two months");
    const closed = await performance.closeScorecard(w.ctx, scorecard.id);
    assert.equal(closed.status, "closed");
    assert.equal((await risk.clearance(w.ctx, supplier.id, "sourcing")).cleared, true, "the hold goes with the plan");
  });

  it("raises the flag for a watch rating without stopping sourcing", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { rating } = await publishedScorecard(w, supplier.id, "2026-Q1", {
      "on-time-delivery": 92,
      "quality-ppm": 3000,
      "price-variance": 3,
    });
    assert.equal(rating, "watch");
    assert.equal((await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing")).cleared, true);
    const profile = await w.container.repos.riskProfiles.bySupplier(w.ctx.tenantId, supplier.id);
    assert.equal(profile?.openFlags().length, 1);
    const types = w.container.outbox.entries(w.ctx.tenantId).map((event) => event.eventType);
    assert.ok(types.includes(SrmEventTypes.ScorecardImprovementRequired));
  });

  it("ties an improvement action to a measured KPI and a sane due date", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    const { scorecard } = await publishedScorecard(w, supplier.id, "2026-Q1");
    const { performance } = w.container.services;
    await expectRejects(
      performance.addImprovementAction(w.ctx, scorecard.id, {
        title: "Fix something unmeasured",
        dueOn: "2026-06-30" as DateOnly,
        kpiCode: "esg-rating",
      }),
      "INVALID_STATE",
      "was not measured",
    );
    await expectRejects(
      performance.addImprovementAction(w.ctx, scorecard.id, {
        title: "Backdated action",
        dueOn: "2026-01-15" as DateOnly,
      }),
      "VALIDATION",
      "on or after the period end",
    );
  });
});

describe("performance analytics", () => {
  it("reports a trailing trend with gaps where no scorecard exists", async () => {
    const w = world();
    await seeded(w);
    const supplier = await activeSupplier(w);
    await publishedScorecard(w, supplier.id, "2026-Q1");
    const trend = await w.container.services.performance.trend(w.ctx, supplier.id, "2026-Q2", 3);
    assert.deepEqual(
      trend.map((point) => point.periodCode),
      ["2025-Q4", "2026-Q1", "2026-Q2"],
    );
    assert.equal(trend[0]?.status, "missing");
    assert.equal(trend[1]?.status, "published");
    assert.equal(trend[2]?.status, "missing");
  });

  it("ranks suppliers for a period, best first", async () => {
    const w = world();
    await seeded(w);
    const good = await activeSupplier(w, "GOOD-CO");
    const poor = await activeSupplier(w, "POOR-CO");
    await publishedScorecard(w, good.id, "2026-Q1");
    await publishedScorecard(w, poor.id, "2026-Q1", { "on-time-delivery": 88, "quality-ppm": 7000 });
    const ranking = await w.container.services.performance.ranking(w.ctx, "2026-Q1");
    assert.deepEqual(
      ranking.map((entry) => entry.supplierCode),
      ["GOOD-CO", "POOR-CO"],
    );
  });

  it("lists the active suppliers with no scorecard for the period", async () => {
    const w = world();
    await seeded(w);
    const rated = await activeSupplier(w, "RATED-CO");
    await activeSupplier(w, "UNRATED-CO");
    await publishedScorecard(w, rated.id, "2026-Q1");
    assert.deepEqual(await w.container.services.performance.missingScorecards(w.ctx, "2026-Q1"), ["UNRATED-CO"]);
  });
});

describe("scorecard to SLA linkage", () => {
  /** Active contract with a 98% OTD commitment and a percentage credit. */
  async function contractedSupplier(w: TestWorld) {
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const drafted = await contract.draft(w.ctx, {
      supplierId: supplier.id,
      type: "msa",
      title: "Master supply agreement",
      currency: "EUR",
      effectiveFrom: "2026-01-01" as DateOnly,
      effectiveTo: "2027-12-31" as DateOnly,
    });
    const commitment = await contract.addCommitment(w.ctx, drafted.id, {
      metric: "on_time_delivery",
      target: 98,
      tolerance: 1,
      window: "quarterly",
      graceBreaches: 0,
      penalty: { kind: "service_credit_percent", percent: 2 },
      creditCapPercent: 10,
      escalations: [{ afterBreaches: 2, action: "Escalate to the supply-chain director" }],
    });
    const signatory = await contract.addSignatory(w.ctx, drafted.id, {
      party: "supplier",
      name: "Sales Director",
      email: "sales@acme-parts.example",
    });
    const buyerSignatory = await contract.addSignatory(w.ctx, drafted.id, {
      party: "buyer",
      name: "Category Manager",
      email: "cm@buyer.example",
    });
    await contract.sendForSignature(w.ctx, drafted.id);
    await contract.sign(w.ctx, drafted.id, signatory.id);
    await contract.sign(w.ctx, drafted.id, buyerSignatory.id);
    await contract.activate(w.ctx, drafted.id);
    return { supplier, contractId: drafted.id, commitmentId: commitment.id };
  }

  it("turns a published KPI miss into a contractual breach without re-keying", async () => {
    const w = world();
    await seeded(w);
    const { supplier, contractId, commitmentId } = await contractedSupplier(w);
    const { slaBreaches } = await publishedScorecard(w, supplier.id, "2026-Q1", { "on-time-delivery": 94 });

    assert.equal(slaBreaches.length, 1);
    const breach = slaBreaches[0]!;
    assert.equal(breach.commitmentId, commitmentId);
    assert.equal(breach.periodCode, "2026-Q1");
    assert.equal(breach.deviation, 4);
    assert.equal(breach.severity, "major", "a 4-point miss against a 1-point tolerance is not minor");

    const contract = await w.container.services.contract.get(w.ctx, contractId);
    assert.equal(contract.breaches.length, 1);
  });

  it("does not double-charge when the same period is re-published after a dispute", async () => {
    const w = world();
    await seeded(w);
    const { supplier, contractId } = await contractedSupplier(w);
    const { scorecard } = await publishedScorecard(w, supplier.id, "2026-Q1", { "on-time-delivery": 94 });
    const { performance } = w.container.services;
    await performance.raiseDispute(w.ctx, scorecard.id, "Carrier strike");
    await performance.resolveDispute(w.ctx, scorecard.id, "Force majeure days excluded", [
      { kpiCode: "on-time-delivery", value: 97.5, reason: "Strike days excluded" },
    ]);
    const contract = await w.container.services.contract.get(w.ctx, contractId);
    assert.equal(contract.breaches.length, 1, "the period already has its breach on record");
  });

  it("leaves a met commitment alone", async () => {
    const w = world();
    await seeded(w);
    const { supplier, contractId } = await contractedSupplier(w);
    const { slaBreaches } = await publishedScorecard(w, supplier.id, "2026-Q1", { "on-time-delivery": 97.5 });
    assert.deepEqual(slaBreaches, [], "inside the tolerance band is not a breach");
    assert.equal((await w.container.services.contract.get(w.ctx, contractId)).breaches.length, 0);
  });
});
