import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, activePlan, otherTenantCtx } from "./helpers.js";

test("plan lifecycle: draft -> active -> retired", async () => {
  const h = harness();
  const plan = await activePlan(h);
  assert.equal(plan.status, "active");
  assert.equal(plan.revision, 1);

  const retired = await h.module.services.plans.retirePlan(h.ctx, plan.id);
  assert.equal(retired.status, "retired");
});

test("activation requires at least one characteristic", async () => {
  const h = harness();
  const plan = await h.module.services.plans.createPlan(h.ctx, {
    planCode: "QP-EMPTY",
    name: "Empty plan",
    targetType: "process",
    samplingRule: { kind: "full" },
  });
  await assert.rejects(
    () => h.module.services.plans.activatePlan(h.ctx, plan.id),
    /without characteristics/,
  );
});

test("active plans are not editable", async () => {
  const h = harness();
  const plan = await activePlan(h);
  await assert.rejects(
    () =>
      h.module.services.plans.addCharacteristic(h.ctx, plan.id, {
        code: "NEW",
        name: "New characteristic",
        type: "attribute",
        criticality: "minor",
      }),
    /only draft plans are editable/,
  );
});

test("duplicate characteristic codes are rejected", async () => {
  const h = harness();
  const plan = await h.module.services.plans.createPlan(h.ctx, {
    planCode: "QP-DUP",
    name: "Dup check",
    targetType: "material",
    materialCode: "MAT-1",
    samplingRule: { kind: "full" },
    characteristics: [
      { code: "X", name: "X", type: "attribute", criticality: "minor" },
    ],
  });
  await assert.rejects(
    () =>
      h.module.services.plans.addCharacteristic(h.ctx, plan.id, {
        code: "x", // normalized to X
        name: "Duplicate",
        type: "attribute",
        criticality: "minor",
      }),
    /already exists/,
  );
});

test("quantitative characteristics require unit and a limit or target", async () => {
  const h = harness();
  const plan = await h.module.services.plans.createPlan(h.ctx, {
    planCode: "QP-VAL",
    name: "Validation",
    targetType: "material",
    materialCode: "MAT-1",
    samplingRule: { kind: "full" },
  });
  await assert.rejects(
    () =>
      h.module.services.plans.addCharacteristic(h.ctx, plan.id, {
        code: "Q1",
        name: "No spec",
        type: "quantitative",
        criticality: "major",
      }),
    /require a spec/,
  );
  await assert.rejects(
    () =>
      h.module.services.plans.addCharacteristic(h.ctx, plan.id, {
        code: "Q2",
        name: "Bad limits",
        type: "quantitative",
        criticality: "major",
        quantitative: { unit: "mm", lowerLimit: 10, upperLimit: 9 },
      }),
    /lowerLimit must be < upperLimit/,
  );
});

test("revising creates a draft next revision; activating it retires the old one", async () => {
  const h = harness();
  const rev1 = await activePlan(h);
  const rev2 = await h.module.services.plans.revisePlan(h.ctx, rev1.id);
  assert.equal(rev2.status, "draft");
  assert.equal(rev2.revision, 2);
  assert.equal(rev2.characteristics.length, rev1.characteristics.length);

  await h.module.services.plans.activatePlan(h.ctx, rev2.id);
  const rev1After = await h.module.services.plans.getPlan(h.ctx, rev1.id);
  assert.equal(rev1After.status, "retired");
  const active = await h.module.repos.plans.findActiveByPlanCode(h.ctx.tenantId, "QP-BRKT-01");
  assert.equal(active?.id, rev2.id);
});

test("duplicate active plan codes are rejected", async () => {
  const h = harness();
  await activePlan(h);
  await assert.rejects(
    () =>
      h.module.services.plans.createPlan(h.ctx, {
        planCode: "QP-BRKT-01",
        name: "Duplicate",
        targetType: "material",
        materialCode: "MAT-X",
        samplingRule: { kind: "full" },
      }),
    /already exists/,
  );
});

test("plans are tenant-isolated", async () => {
  const h = harness();
  const plan = await activePlan(h);
  await assert.rejects(
    () => h.module.services.plans.getPlan(otherTenantCtx(), plan.id),
    /not found/,
  );
});

test("plan events land in the outbox", async () => {
  const h = harness();
  await activePlan(h);
  const events = await h.module.outbox.drain();
  const types = events.map((e) => e.eventType);
  assert.ok(types.includes("quality.inspection-plan.created"));
  assert.ok(types.includes("quality.inspection-plan.activated"));
});
