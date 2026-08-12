import assert from "node:assert/strict";
import { test } from "node:test";
import { QualityEventTypes } from "../src/domain/events.js";
import { harness, activePlan, createdLot, failingLot, passingLot } from "./helpers.js";

test("lot creation freezes sampling (AQL J: n=80, Ac=2) and characteristics", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await createdLot(h, plan.id);

  assert.equal(lot.status, "created");
  assert.match(lot.lotNumber, /^LOT-2026-\d{6}$/);
  assert.equal(lot.sampling.sampleSize, 80);
  assert.equal(lot.sampling.acceptanceNumber, 2);
  assert.equal(lot.characteristics.length, 2);
  assert.equal(lot.linkage.supplierId, "SUP-001");
});

test("plan revision after lot creation does not affect the lot snapshot", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await createdLot(h, plan.id);

  const rev2 = await h.module.services.plans.revisePlan(h.ctx, plan.id);
  await h.module.services.plans.addCharacteristic(h.ctx, rev2.id, {
    code: "EXTRA",
    name: "Added later",
    type: "attribute",
    criticality: "minor",
  });

  const reloaded = await h.module.services.lots.getLot(h.ctx, lot.id);
  assert.equal(reloaded.characteristics.length, 2);
});

test("goods-receipt lots require a supplier", async () => {
  const h = harness();
  const plan = await activePlan(h);
  await assert.rejects(
    () =>
      h.module.services.lots.createLot(h.ctx, {
        planId: plan.id,
        origin: "goods-receipt",
        quantity: 10,
        uom: "EA",
      }),
    /supplierId/,
  );
});

test("lots cannot be created against draft or retired plans", async () => {
  const h = harness();
  const draft = await h.module.services.plans.createPlan(h.ctx, {
    planCode: "QP-DRAFT",
    name: "Draft",
    targetType: "material",
    materialCode: "MAT-9",
    samplingRule: { kind: "full" },
    characteristics: [{ code: "A", name: "A", type: "attribute", criticality: "minor" }],
  });
  await assert.rejects(
    () =>
      h.module.services.lots.createLot(h.ctx, {
        planId: draft.id,
        origin: "final",
        quantity: 10,
        uom: "EA",
      }),
    /not active/,
  );
});

test("results can only be recorded while in-progress, once per characteristic", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await createdLot(h, plan.id);

  await assert.rejects(
    () => h.module.services.lots.recordQuantitativeResult(h.ctx, lot.id, "DIA", [10.0]),
    /in-progress/,
  );

  await h.module.services.lots.startInspection(h.ctx, lot.id);
  await h.module.services.lots.recordQuantitativeResult(h.ctx, lot.id, "DIA", [10.0, 9.95]);
  await assert.rejects(
    () => h.module.services.lots.recordQuantitativeResult(h.ctx, lot.id, "DIA", [10.0]),
    /already recorded/,
  );
});

test("quantitative evaluation computes statistics and flags out-of-spec", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await failingLot(h, plan.id);

  const dia = lot.results.find((r) => r.code === "DIA")!;
  assert.equal(dia.evaluation, "fail");
  assert.equal(dia.statistics?.outOfSpecCount, 2);
  assert.ok(dia.statistics?.cpk !== null);

  const surf = lot.results.find((r) => r.code === "SURF")!;
  assert.equal(surf.evaluation, "pass"); // 1 defective <= Ac 2
});

test("attribute evaluation honours the lot acceptance number, criticals use Ac=0", async () => {
  const h = harness();
  const plan = await h.module.services.plans.createPlan(h.ctx, {
    planCode: "QP-CRIT",
    name: "Critical attribute",
    targetType: "material",
    materialCode: "MAT-C",
    samplingRule: { kind: "aql", level: "II", aql: 1.0 }, // lot 1000 -> Ac 2
    characteristics: [
      { code: "SAFE", name: "Safety feature present", type: "attribute", criticality: "critical" },
      { code: "COSM", name: "Cosmetic", type: "attribute", criticality: "minor" },
    ],
  });
  await h.module.services.plans.activatePlan(h.ctx, plan.id);
  const lot = await h.module.services.lots.createLot(h.ctx, {
    planId: plan.id,
    origin: "final",
    quantity: 1000,
    uom: "EA",
  });
  await h.module.services.lots.startInspection(h.ctx, lot.id);
  // 1 defect on a critical characteristic fails even though lot Ac=2
  await h.module.services.lots.recordAttributeResult(h.ctx, lot.id, "SAFE", { inspected: 80, defective: 1 });
  // 2 defects on a minor characteristic passes (Ac=2)
  await h.module.services.lots.recordAttributeResult(h.ctx, lot.id, "COSM", { inspected: 80, defective: 2 });

  const reloaded = await h.module.services.lots.getLot(h.ctx, lot.id);
  assert.equal(reloaded.results.find((r) => r.code === "SAFE")?.evaluation, "fail");
  assert.equal(reloaded.results.find((r) => r.code === "COSM")?.evaluation, "pass");
  assert.ok(reloaded.hasCriticalFailure());
});

test("completion requires all characteristics to have results", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await createdLot(h, plan.id);
  await h.module.services.lots.startInspection(h.ctx, lot.id);
  await h.module.services.lots.recordQuantitativeResult(h.ctx, lot.id, "DIA", [10.0]);
  await assert.rejects(
    () => h.module.services.lots.completeInspection(h.ctx, lot.id),
    /results missing for characteristics: SURF/,
  );
});

test("clean lots can be accepted; accepted lots emit the decided event", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await passingLot(h, plan.id);

  const outcome = await h.module.services.lots.decideUsage(h.ctx, lot.id, { decision: "accept" });
  assert.equal(outcome.lot.status, "decided");
  assert.equal(outcome.lot.usageDecision?.acceptedQuantity, 1000);
  assert.equal(outcome.ncr, undefined);
  assert.equal(outcome.supplierEvent, undefined);

  const events = await h.module.outbox.drain();
  const decided = events.find((e) => e.eventType === QualityEventTypes.InspectionLotDecided);
  assert.ok(decided);
});

test("lots with failures cannot be plainly accepted", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await failingLot(h, plan.id);
  await assert.rejects(
    () => h.module.services.lots.decideUsage(h.ctx, lot.id, { decision: "accept" }),
    /Cannot plainly accept/,
  );
});

test("accept-with-deviation requires a note and no critical failures", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await failingLot(h, plan.id);
  await assert.rejects(
    () => h.module.services.lots.decideUsage(h.ctx, lot.id, { decision: "accept-with-deviation" }),
    /justification note/,
  );
  const outcome = await h.module.services.lots.decideUsage(h.ctx, lot.id, {
    decision: "accept-with-deviation",
    note: "Deviation DEV-11 approved by engineering",
  });
  assert.equal(outcome.lot.usageDecision?.decision, "accept-with-deviation");
  assert.equal(outcome.ncr, undefined); // nothing rejected
});

test("partial decisions validate the accepted quantity", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await failingLot(h, plan.id);
  await assert.rejects(
    () => h.module.services.lots.decideUsage(h.ctx, lot.id, { decision: "partial" }),
    /acceptedQuantity/,
  );
  const outcome = await h.module.services.lots.decideUsage(h.ctx, lot.id, {
    decision: "partial",
    acceptedQuantity: 900,
  });
  assert.equal(outcome.lot.usageDecision?.acceptedQuantity, 900);
  assert.equal(outcome.lot.usageDecision?.rejectedQuantity, 100);
  assert.ok(outcome.ncr, "partial rejection should open an NCR");
});

test("cancelled and decided lots are terminal", async () => {
  const h = harness();
  const plan = await activePlan(h);
  const lot = await createdLot(h, plan.id);
  await h.module.services.lots.cancelLot(h.ctx, lot.id, "created by mistake");
  await assert.rejects(
    () => h.module.services.lots.startInspection(h.ctx, lot.id),
    /terminal state/,
  );
});
