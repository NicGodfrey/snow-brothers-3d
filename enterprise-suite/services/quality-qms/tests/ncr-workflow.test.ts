import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, isoIn } from "./helpers.js";

async function openNcr(h: ReturnType<typeof harness>, severity: "critical" | "major" | "minor" = "major") {
  return h.module.services.ncrs.createNcr(
    h.ctx,
    {
      title: "Cracked housing",
      description: "Housings cracked around mounting boss",
      source: "production",
      severity,
      quantityAffected: 40,
      uom: "EA",
      materialCode: "MAT-HSG",
    },
    { autoSubmit: true },
  );
}

test("NCR numbering and submit", async () => {
  const h = harness();
  const ncr = await openNcr(h);
  assert.match(ncr.ncrNumber, /^NCR-2026-\d{6}$/);
  assert.equal(ncr.status, "open");
});

test("containment: actions must exist and be done before disposition", async () => {
  const h = harness();
  const ncr = await openNcr(h);
  await h.module.services.ncrs.startContainment(h.ctx, ncr.id);

  await assert.rejects(
    () => h.module.services.ncrs.moveToDisposition(h.ctx, ncr.id),
    /at least one containment action/,
  );

  const { action } = await h.module.services.ncrs.addContainmentAction(h.ctx, ncr.id, {
    description: "Quarantine affected bin",
    dueAt: isoIn(h.clock, 86_400_000),
  });
  await assert.rejects(
    () => h.module.services.ncrs.moveToDisposition(h.ctx, ncr.id),
    /still open/,
  );

  await h.module.services.ncrs.completeContainmentAction(h.ctx, ncr.id, action.id, "bin locked");
  const moved = await h.module.services.ncrs.moveToDisposition(h.ctx, ncr.id);
  assert.equal(moved.status, "disposition");
});

test("only minor NCRs may skip containment", async () => {
  const h = harness();
  const major = await openNcr(h, "major");
  await assert.rejects(
    () => h.module.services.ncrs.moveToDisposition(h.ctx, major.id),
    /only minor NCRs may skip containment/,
  );

  const minor = await openNcr(h, "minor");
  const moved = await h.module.services.ncrs.moveToDisposition(h.ctx, minor.id);
  assert.equal(moved.status, "disposition");
});

test("use-as-is requires four-eyes approval by a quality manager", async () => {
  const h = harness();
  const ncr = await openNcr(h, "minor");
  await h.module.services.ncrs.moveToDisposition(h.ctx, ncr.id);
  await h.module.services.ncrs.recordDisposition(h.ctx, ncr.id, {
    type: "use-as-is",
    justification: "Cosmetic only, customer waiver on file",
  });

  // Close blocked until approved
  await assert.rejects(() => h.module.services.ncrs.close(h.ctx, ncr.id), /requires approval/);
  // Approval needs the quality-manager role
  await assert.rejects(
    () => h.module.services.ncrs.approveDisposition(h.ctx, ncr.id),
    /quality-manager/,
  );

  await h.module.services.ncrs.approveDisposition(h.qmCtx, ncr.id);
  const closed = await h.module.services.ncrs.close(h.ctx, ncr.id, "done");
  assert.equal(closed.status, "closed");
});

test("four-eyes rule: decider cannot approve their own disposition", async () => {
  const h = harness();
  const ncr = await openNcr(h, "minor");
  await h.module.services.ncrs.moveToDisposition(h.ctx, ncr.id);
  // qm records the disposition AND tries to approve it
  await h.module.services.ncrs.recordDisposition(h.qmCtx, ncr.id, {
    type: "use-as-is",
    justification: "waiver",
  });
  await assert.rejects(
    () => h.module.services.ncrs.approveDisposition(h.qmCtx, ncr.id),
    /four-eyes/,
  );
});

test("scrap disposition on a minor NCR closes without approval", async () => {
  const h = harness();
  const ncr = await openNcr(h, "minor");
  await h.module.services.ncrs.moveToDisposition(h.ctx, ncr.id);
  await h.module.services.ncrs.recordDisposition(h.ctx, ncr.id, {
    type: "scrap",
    justification: "Not economically repairable",
  });
  const closed = await h.module.services.ncrs.close(h.ctx, ncr.id);
  assert.equal(closed.status, "closed");
});

test("return-to-supplier requires a linked supplier", async () => {
  const h = harness();
  const ncr = await openNcr(h, "minor");
  await h.module.services.ncrs.moveToDisposition(h.ctx, ncr.id);
  await assert.rejects(
    () =>
      h.module.services.ncrs.recordDisposition(h.ctx, ncr.id, {
        type: "return-to-supplier",
        justification: "Vendor fault",
      }),
    /requires a linked supplierId/,
  );
});

test("supplier-linked NCR records a supplier quality event on open", async () => {
  const h = harness();
  await h.module.services.ncrs.createNcr(
    h.ctx,
    {
      title: "Wrong plating",
      description: "Zinc instead of nickel plating",
      source: "supplier",
      severity: "major",
      linkage: { supplierId: "SUP-042" },
    },
    { autoSubmit: true },
  );
  const events = await h.module.services.supplierQuality.listEvents(h.ctx, { supplierId: "SUP-042" });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.eventType, "ncr-issued");
});

test("escalation creates a linked CAPA with copied source linkage", async () => {
  const h = harness();
  const ncr = await openNcr(h, "critical");
  const { ncr: updated, capa } = await h.module.services.ncrs.escalateToCapa(h.ctx, ncr.id);

  assert.equal(updated.capaId, capa.id);
  assert.deepEqual(capa.source.ncrIds, [ncr.id]);
  assert.equal(capa.priority, "urgent"); // critical NCR -> urgent CAPA
  assert.match(capa.capaNumber, /^CAPA-2026-\d{6}$/);

  // Cannot escalate twice
  await assert.rejects(
    () => h.module.services.ncrs.escalateToCapa(h.ctx, ncr.id),
    /already escalated/,
  );
});

test("cancelled NCRs are terminal", async () => {
  const h = harness();
  const ncr = await openNcr(h);
  await h.module.services.ncrs.cancel(h.ctx, ncr.id, "duplicate of NCR-2026-000001");
  await assert.rejects(
    () => h.module.services.ncrs.startContainment(h.ctx, ncr.id),
    /terminal state/,
  );
});
