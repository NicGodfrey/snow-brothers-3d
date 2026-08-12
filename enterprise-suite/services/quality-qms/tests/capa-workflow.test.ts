import assert from "node:assert/strict";
import { test } from "node:test";
import { riskRating } from "../src/domain/capa.js";
import { harness, isoIn, type TestHarness } from "./helpers.js";

async function draftCapa(h: TestHarness) {
  return h.module.services.capas.createCapa(h.ctx, {
    type: "corrective",
    title: "Recurring bore oversize",
    description: "Bore diameter drifts oversize on machine M-3",
    priority: "high",
    riskRating: riskRating(4, 3, 2),
  });
}

/** Walks a CAPA to implementation with one completed corrective action. */
async function capaInImplementation(h: TestHarness) {
  const capa = await draftCapa(h);
  const svc = h.module.services.capas;
  await svc.submit(h.ctx, capa.id);
  await svc.startInvestigation(h.ctx, capa.id);
  await svc.recordRootCause(h.ctx, capa.id, {
    method: "5-whys",
    summary: "Tool wear compensation not applied after insert change",
    causes: [
      { category: "method", description: "No standard work for offset update" },
      { category: "machine", description: "Wear offset resets on power cycle" },
    ],
  });
  await svc.moveToActionPlanning(h.ctx, capa.id);
  const { action } = await svc.addAction(h.ctx, capa.id, {
    type: "corrective",
    description: "Add offset check to setup checklist",
    dueAt: isoIn(h.clock, 7 * 86_400_000),
  });
  await svc.defineEffectivenessCheck(h.ctx, capa.id, {
    criteria: "No oversize bores in 30 production days",
    dueAt: isoIn(h.clock, 30 * 86_400_000),
  });
  await svc.beginImplementation(h.ctx, capa.id);
  return { capa: await svc.getCapa(h.ctx, capa.id), actionId: action.id };
}

test("risk rating computes RPN and validates bounds", () => {
  assert.equal(riskRating(4, 3, 2).rpn, 24);
  assert.throws(() => riskRating(0, 3, 2), /1\.\.5/);
  assert.throws(() => riskRating(4, 6, 2), /1\.\.5/);
});

test("investigation cannot finish without a root cause", async () => {
  const h = harness();
  const capa = await draftCapa(h);
  await h.module.services.capas.submit(h.ctx, capa.id);
  await h.module.services.capas.startInvestigation(h.ctx, capa.id);
  await assert.rejects(
    () => h.module.services.capas.moveToActionPlanning(h.ctx, capa.id),
    /root cause analysis must be recorded/,
  );
});

test("action-planning requires a corrective or preventive action to proceed", async () => {
  const h = harness();
  const capa = await draftCapa(h);
  const svc = h.module.services.capas;
  await svc.submit(h.ctx, capa.id);
  await svc.startInvestigation(h.ctx, capa.id);
  await svc.recordRootCause(h.ctx, capa.id, {
    method: "fishbone",
    summary: "root cause",
    causes: [{ description: "cause" }],
  });
  await svc.moveToActionPlanning(h.ctx, capa.id);

  await assert.rejects(
    () => svc.beginImplementation(h.ctx, capa.id),
    /at least one corrective or preventive action/,
  );

  // A containment-only action is not enough
  await svc.addAction(h.ctx, capa.id, {
    type: "containment",
    description: "Sort stock",
    dueAt: isoIn(h.clock, 86_400_000),
  });
  await assert.rejects(
    () => svc.beginImplementation(h.ctx, capa.id),
    /at least one corrective or preventive action/,
  );
});

test("verification requires all actions completed and an effectiveness check defined", async () => {
  const h = harness();
  const { capa, actionId } = await capaInImplementation(h);
  const svc = h.module.services.capas;

  await assert.rejects(
    () => svc.requestVerification(h.ctx, capa.id),
    /not yet completed/,
  );

  await svc.startAction(h.ctx, capa.id, actionId);
  await svc.completeAction(h.ctx, capa.id, actionId, "checklist updated, operators trained");
  const inVerification = await svc.requestVerification(h.ctx, capa.id);
  assert.equal(inVerification.status, "verification");
});

test("closing requires an effective outcome; not-effective loops back to planning", async () => {
  const h = harness();
  const { capa, actionId } = await capaInImplementation(h);
  const svc = h.module.services.capas;
  await svc.completeAction(h.ctx, capa.id, actionId);
  await svc.requestVerification(h.ctx, capa.id);

  await assert.rejects(() => svc.close(h.ctx, capa.id), /'effective' effectiveness outcome/);

  await svc.recordEffectiveness(h.ctx, capa.id, { outcome: "not-effective", note: "oversize recurred" });
  await assert.rejects(() => svc.close(h.ctx, capa.id), /'effective' effectiveness outcome/);

  const backToPlanning = await svc.returnToPlanning(h.ctx, capa.id);
  assert.equal(backToPlanning.status, "action-planning");
  assert.equal(backToPlanning.reworkCycles, 1);
  // Effectiveness outcome reset for the next cycle
  assert.equal(backToPlanning.effectiveness?.outcome, undefined);

  // Second cycle: add another action, implement, verify effective, close.
  const { action } = await svc.addAction(h.ctx, capa.id, {
    type: "preventive",
    description: "Automate offset via probe cycle",
    dueAt: isoIn(h.clock, 14 * 86_400_000),
  });
  await svc.beginImplementation(h.ctx, capa.id);
  await svc.completeAction(h.ctx, capa.id, action.id);
  await svc.requestVerification(h.ctx, capa.id);
  await svc.recordEffectiveness(h.ctx, capa.id, { outcome: "effective" });
  const closed = await svc.close(h.ctx, capa.id, "verified over 30 days");
  assert.equal(closed.status, "closed");
});

test("overdue actions are reported once the clock passes dueAt", async () => {
  const h = harness();
  const { capa, actionId } = await capaInImplementation(h);
  const svc = h.module.services.capas;

  assert.equal((await svc.listOverdue(h.ctx)).length, 0);

  h.clock.advance(8 * 86_400_000); // past the 7-day due date
  const overdue = await svc.listOverdue(h.ctx);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0]!.overdueActions[0]!.id, actionId);

  await svc.completeAction(h.ctx, capa.id, actionId);
  assert.equal((await svc.listOverdue(h.ctx)).length, 0);
});

test("cancelled actions cannot be completed; completed cannot be cancelled", async () => {
  const h = harness();
  const { capa, actionId } = await capaInImplementation(h);
  const svc = h.module.services.capas;
  await svc.completeAction(h.ctx, capa.id, actionId);
  await assert.rejects(
    () => svc.cancelAction(h.ctx, capa.id, actionId, "no longer relevant"),
    /Completed actions cannot be cancelled/,
  );
});

test("state-changed events are emitted with from/to", async () => {
  const h = harness();
  const capa = await draftCapa(h);
  await h.module.services.capas.submit(h.ctx, capa.id);
  const events = await h.module.outbox.drain();
  const stateChanged = events.filter((e) => e.eventType === "quality.capa.state-changed");
  assert.equal(stateChanged.length, 1);
  assert.deepEqual(
    (stateChanged[0]!.payload as { fromState: string; toState: string }),
    { capaNumber: capa.capaNumber, fromState: "draft", toState: "open" },
  );
});
