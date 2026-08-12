import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDemeritPoints } from "../src/domain/supplier-quality.js";
import { harness, isoIn, type TestHarness } from "./helpers.js";

async function recordEvent(h: TestHarness, severity: "critical" | "major" | "minor" = "major") {
  return h.module.services.supplierQuality.recordEvent(h.ctx, {
    supplierId: "SUP-100",
    supplierName: "Acme Castings",
    eventType: "incoming-inspection-failure",
    severity,
    description: "Porosity found in castings",
    linkage: { purchaseOrderRef: "PO-1", materialCode: "MAT-CAST" },
  });
}

test("default demerit points combine severity and event-type factor", () => {
  assert.equal(defaultDemeritPoints("incoming-inspection-failure", "major"), 10);
  assert.equal(defaultDemeritPoints("ncr-issued", "major"), 12);
  assert.equal(defaultDemeritPoints("field-failure", "critical"), 40);
  assert.equal(defaultDemeritPoints("delivery-quality", "minor"), 2);
  assert.equal(defaultDemeritPoints("certification-lapse", "minor"), 5);
});

test("SCAR lifecycle: issue, respond, accept, resolve", async () => {
  const h = harness();
  const svc = h.module.services.supplierQuality;
  const event = await recordEvent(h);

  await svc.acknowledge(h.ctx, event.id);
  const withScar = await svc.issueScar(h.ctx, event.id, { dueAt: isoIn(h.clock, 14 * 86_400_000) });
  assert.equal(withScar.status, "in-remediation");
  assert.match(withScar.scar!.scarNumber, /^SCAR-2026-\d{6}$/);

  // Cannot resolve while the SCAR response is outstanding
  await assert.rejects(() => svc.resolve(h.ctx, event.id), /SCAR response is outstanding/);

  // Rejected response keeps the event open
  await svc.recordScarResponse(h.ctx, event.id, {
    responseSummary: "Will inspect 100% at source",
    accepted: false,
  });
  await assert.rejects(() => svc.resolve(h.ctx, event.id), /has not been accepted/);

  // Supplier re-submits, response accepted, event resolves
  await svc.recordScarResponse(h.ctx, event.id, {
    responseSummary: "Added degassing step + X-ray sampling, evidence attached",
    accepted: true,
  });
  const resolved = await svc.resolve(h.ctx, event.id, "verified at next receipt");
  assert.equal(resolved.status, "resolved");
});

test("in-remediation requires a SCAR; events without SCAR resolve directly", async () => {
  const h = harness();
  const svc = h.module.services.supplierQuality;
  const event = await recordEvent(h);
  await svc.acknowledge(h.ctx, event.id);
  const resolved = await svc.resolve(h.ctx, event.id, "one-off, tooling damaged in transit");
  assert.equal(resolved.status, "resolved");
});

test("SCAR overdue detection uses the clock", async () => {
  const h = harness();
  const svc = h.module.services.supplierQuality;
  const event = await recordEvent(h);
  await svc.issueScar(h.ctx, event.id, { dueAt: isoIn(h.clock, 5 * 86_400_000) });

  let summary = await svc.supplierSummary(h.ctx, "SUP-100");
  assert.equal(summary.openScars, 1);
  assert.equal(summary.overdueScars, 0);

  h.clock.advance(6 * 86_400_000);
  summary = await svc.supplierSummary(h.ctx, "SUP-100");
  assert.equal(summary.overdueScars, 1);
});

test("write-off zeroes demerit points and summary bands respond", async () => {
  const h = harness();
  const svc = h.module.services.supplierQuality;

  const e1 = await recordEvent(h, "critical"); // 20 points
  await recordEvent(h, "major"); // 10 points

  let summary = await svc.supplierSummary(h.ctx, "SUP-100");
  assert.equal(summary.totalDemerits, 30);
  assert.equal(summary.band, "C");

  await svc.writeOff(h.ctx, e1.id, "root cause was our own storage handling");
  summary = await svc.supplierSummary(h.ctx, "SUP-100");
  assert.equal(summary.totalDemerits, 10);
  assert.equal(summary.band, "B");
  assert.equal(summary.openEvents, 1);
});

test("summary aggregates by severity and type", async () => {
  const h = harness();
  const svc = h.module.services.supplierQuality;
  await recordEvent(h, "critical");
  await recordEvent(h, "major");
  await svc.recordEvent(h.ctx, {
    supplierId: "SUP-100",
    eventType: "delivery-quality",
    severity: "minor",
    description: "Damaged packaging",
  });

  const summary = await svc.supplierSummary(h.ctx, "SUP-100");
  assert.equal(summary.totalEvents, 3);
  assert.deepEqual(summary.bySeverity, { critical: 1, major: 1, minor: 1 });
  assert.equal(summary.byType["incoming-inspection-failure"], 2);
  assert.equal(summary.byType["delivery-quality"], 1);
});

test("terminal events reject further transitions", async () => {
  const h = harness();
  const svc = h.module.services.supplierQuality;
  const event = await recordEvent(h);
  await svc.writeOff(h.ctx, event.id, "not supplier caused");
  await assert.rejects(() => svc.acknowledge(h.ctx, event.id), /terminal state/);
  await assert.rejects(
    () => svc.issueScar(h.ctx, event.id, { dueAt: isoIn(h.clock, 86_400_000) }),
    /written-off/,
  );
});
