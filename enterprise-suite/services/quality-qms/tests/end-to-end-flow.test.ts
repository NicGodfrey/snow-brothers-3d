/**
 * The full quality loop in one scenario:
 * plan -> goods-receipt lot -> failed inspection -> reject decision
 *   -> auto NCR + supplier quality event
 *   -> NCR containment/disposition (return-to-supplier)
 *   -> escalation to CAPA -> CAPA through closure
 *   -> SCAR issued & resolved
 * and the outbox tells the whole story in order.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { QualityEventTypes } from "../src/domain/events.js";
import { harness, activePlan, failingLot, isoIn } from "./helpers.js";

test("reject flow wires lot -> NCR -> supplier event -> CAPA -> SCAR end to end", async () => {
  const h = harness();
  const { lots, ncrs, capas, supplierQuality } = h.module.services;

  // 1. Inspect and reject the lot
  const plan = await activePlan(h);
  const lot = await failingLot(h, plan.id);
  const outcome = await lots.decideUsage(h.ctx, lot.id, { decision: "reject" });

  assert.equal(outcome.lot.usageDecision?.rejectedQuantity, 1000);
  assert.ok(outcome.ncr, "reject must auto-create an NCR");
  assert.ok(outcome.supplierEvent, "goods-receipt reject must record a supplier event");

  // 2. NCR carries the linkage back to lot and supplier
  const ncr = outcome.ncr!;
  assert.equal(ncr.status, "open");
  assert.equal(ncr.severity, "major"); // DIA (major) failed
  assert.equal(ncr.linkage.inspectionLotId, lot.id);
  assert.equal(ncr.linkage.supplierId, "SUP-001");
  assert.equal(ncr.linkage.purchaseOrderRef, "PO-2026-0042");
  assert.equal(ncr.quantityAffected, 1000);

  // Exactly one supplier event (the NCR must not double-report)
  const supplierEvents = await supplierQuality.listEvents(h.ctx, { supplierId: "SUP-001" });
  assert.equal(supplierEvents.length, 1);
  assert.equal(supplierEvents[0]!.eventType, "incoming-inspection-failure");
  assert.equal(supplierEvents[0]!.linkage.ncrId, ncr.id);
  assert.equal(supplierEvents[0]!.linkage.inspectionLotId, lot.id);

  // 3. Work the NCR: containment, disposition return-to-supplier
  await ncrs.startContainment(h.ctx, ncr.id);
  const { action } = await ncrs.addContainmentAction(h.ctx, ncr.id, {
    description: "Block stock in receiving bay",
    dueAt: isoIn(h.clock, 86_400_000),
  });
  await ncrs.completeContainmentAction(h.ctx, ncr.id, action.id);
  await ncrs.moveToDisposition(h.ctx, ncr.id);
  await ncrs.recordDisposition(h.ctx, ncr.id, {
    type: "return-to-supplier",
    justification: "Out-of-spec bores across the lot; supplier to rework",
  });

  // 4. Escalate to CAPA before closing the NCR
  const { capa } = await ncrs.escalateToCapa(h.ctx, ncr.id);
  assert.equal(capa.source.supplierId, "SUP-001");

  const closedNcr = await ncrs.close(h.ctx, ncr.id, "material returned under RMA-9");
  assert.equal(closedNcr.status, "closed");

  // 5. Drive the CAPA to closure
  await capas.submit(h.ctx, capa.id);
  await capas.startInvestigation(h.ctx, capa.id);
  await capas.recordRootCause(h.ctx, capa.id, {
    method: "8d",
    summary: "Supplier honing fixture worn; SPC not in place at supplier",
    causes: [{ category: "machine", description: "Worn honing fixture" }],
  });
  await capas.moveToActionPlanning(h.ctx, capa.id);
  const { action: capaAction } = await capas.addAction(h.ctx, capa.id, {
    type: "corrective",
    description: "Supplier to replace fixture and add SPC on bore diameter",
    dueAt: isoIn(h.clock, 14 * 86_400_000),
  });
  await capas.defineEffectivenessCheck(h.ctx, capa.id, {
    criteria: "Three consecutive lots with Cpk >= 1.33",
    dueAt: isoIn(h.clock, 45 * 86_400_000),
  });
  await capas.beginImplementation(h.ctx, capa.id);
  await capas.completeAction(h.ctx, capa.id, capaAction.id, "fixture replaced, SPC live");
  await capas.requestVerification(h.ctx, capa.id);
  await capas.recordEffectiveness(h.ctx, capa.id, { outcome: "effective" });
  const closedCapa = await capas.close(h.ctx, capa.id);
  assert.equal(closedCapa.status, "closed");

  // 6. SCAR on the supplier event
  const event = supplierEvents[0]!;
  await supplierQuality.issueScar(h.ctx, event.id, { dueAt: isoIn(h.clock, 10 * 86_400_000) });
  await supplierQuality.recordScarResponse(h.ctx, event.id, {
    responseSummary: "Fixture replaced; capability study attached (Cpk 1.51)",
    accepted: true,
  });
  const resolved = await supplierQuality.resolve(h.ctx, event.id);
  assert.equal(resolved.status, "resolved");

  // 7. The outbox recorded the full trail
  const events = await h.module.outbox.drain();
  const types = events.map((e) => e.eventType);
  for (const expected of [
    QualityEventTypes.InspectionPlanActivated,
    QualityEventTypes.InspectionLotCreated,
    QualityEventTypes.InspectionLotDecided,
    QualityEventTypes.NcrCreated,
    QualityEventTypes.NcrOpened,
    QualityEventTypes.SupplierQualityEventRecorded,
    QualityEventTypes.NcrDispositioned,
    QualityEventTypes.NcrEscalatedToCapa,
    QualityEventTypes.CapaCreated,
    QualityEventTypes.NcrClosed,
    QualityEventTypes.CapaClosed,
    QualityEventTypes.ScarIssued,
    QualityEventTypes.SupplierQualityEventResolved,
  ]) {
    assert.ok(types.includes(expected), `missing event ${expected}`);
  }

  // Ordering spot-checks: decision before NCR opened before CAPA created
  assert.ok(
    types.indexOf(QualityEventTypes.InspectionLotDecided) <
      types.indexOf(QualityEventTypes.NcrOpened),
  );
  assert.ok(
    types.indexOf(QualityEventTypes.NcrOpened) < types.indexOf(QualityEventTypes.CapaCreated),
  );

  // Supplier summary reflects the resolved incident
  const summary = await supplierQuality.supplierSummary(h.ctx, "SUP-001");
  assert.equal(summary.totalEvents, 1);
  assert.equal(summary.openEvents, 0);
  assert.equal(summary.totalDemerits, 10); // incoming-inspection-failure, major
  assert.equal(summary.band, "B");
});
