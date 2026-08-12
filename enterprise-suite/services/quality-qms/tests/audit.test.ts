import assert from "node:assert/strict";
import { test } from "node:test";
import type { Audit } from "../src/domain/audit.js";
import { harness, isoIn, type TestHarness } from "./helpers.js";

async function activeTemplate(h: TestHarness) {
  const template = await h.module.services.audits.createTemplate(h.ctx, {
    code: "ISO9001-INT",
    title: "ISO 9001:2015 internal audit",
    standard: "ISO 9001:2015",
    sections: [
      {
        title: "8.5 Production and service provision",
        items: [
          { question: "Are work instructions available at the workstation?", answerType: "conformity", requirementRef: "ISO9001:2015 §8.5.1", weight: 2 },
          { question: "Is process monitoring data recorded?", answerType: "conformity", requirementRef: "ISO9001:2015 §8.5.1" },
          { question: "Rate 5S condition of the area", answerType: "score" },
        ],
      },
      {
        title: "7.1.5 Monitoring and measuring resources",
        items: [
          { question: "Are gauges within calibration date?", answerType: "yes-no", requirementRef: "ISO9001:2015 §7.1.5" },
        ],
      },
    ],
  });
  return h.module.services.audits.activateTemplate(h.ctx, template.id);
}

async function startedAudit(h: TestHarness): Promise<Audit> {
  const template = await activeTemplate(h);
  const audit = await h.module.services.audits.planAudit(h.ctx, {
    templateId: template.id,
    auditType: "supplier",
    scope: "Machining line at Acme Castings",
    auditee: { supplierId: "SUP-100", site: "Plant 2" },
    plannedFrom: isoIn(h.clock, 86_400_000),
    plannedTo: isoIn(h.clock, 2 * 86_400_000),
  });
  return h.module.services.audits.startAudit(h.ctx, audit.id);
}

function allItems(audit: Audit) {
  return audit.sections.flatMap((s) => s.items);
}

test("templates need items to activate; audits snapshot the checklist", async () => {
  const h = harness();
  const empty = await h.module.services.audits.createTemplate(h.ctx, {
    code: "EMPTY",
    title: "Empty",
  });
  await assert.rejects(
    () => h.module.services.audits.activateTemplate(h.ctx, empty.id),
    /without items/,
  );

  const audit = await startedAudit(h);
  assert.equal(allItems(audit).length, 4);
  assert.match(audit.auditNumber, /^AUD-2026-\d{6}$/);
});

test("supplier audits require a supplier auditee", async () => {
  const h = harness();
  const template = await activeTemplate(h);
  await assert.rejects(
    () =>
      h.module.services.audits.planAudit(h.ctx, {
        templateId: template.id,
        auditType: "supplier",
        scope: "x",
        auditee: { site: "Plant 1" },
        plannedFrom: isoIn(h.clock, 0),
        plannedTo: isoIn(h.clock, 1),
      }),
    /supplierId/,
  );
});

test("answer types are enforced and review requires all items answered", async () => {
  const h = harness();
  const audit = await startedAudit(h);
  const svc = h.module.services.audits;
  const [i1, , i3] = allItems(audit);

  await assert.rejects(
    () => svc.answerItem(h.ctx, audit.id, i1!.id, { kind: "yes-no", value: "yes" }),
    /expects answer type 'conformity'/,
  );
  await assert.rejects(
    () => svc.answerItem(h.ctx, audit.id, i3!.id, { kind: "score", value: 7 }),
    /integers 0\.\.5/,
  );

  await svc.answerItem(h.ctx, audit.id, i1!.id, { kind: "conformity", value: "conform" });
  await assert.rejects(() => svc.moveToReview(h.ctx, audit.id), /3 checklist item\(s\) unanswered/);
});

test("scoring: weighted factors, n/a excluded, major-nc caps outcome", async () => {
  const h = harness();
  const audit = await startedAudit(h);
  const svc = h.module.services.audits;
  const [i1, i2, i3, i4] = allItems(audit);

  // i1 (weight 2): conform -> 2.0 ; i2: minor-nc -> 0.5 ; i3: score 4/5 -> 0.8 ; i4: n/a excluded
  await svc.answerItem(h.ctx, audit.id, i1!.id, { kind: "conformity", value: "conform" });
  await svc.answerItem(h.ctx, audit.id, i2!.id, { kind: "conformity", value: "minor-nc" });
  await svc.answerItem(h.ctx, audit.id, i3!.id, { kind: "score", value: 4 });
  await svc.answerItem(h.ctx, audit.id, i4!.id, { kind: "yes-no", value: "not-applicable" });

  await svc.recordFinding(h.ctx, audit.id, {
    classification: "minor-nc",
    description: "SPC chart missing for op 30",
    itemId: i2!.id,
  });

  await svc.moveToReview(h.ctx, audit.id);
  const { result } = await svc.completeAudit(h.ctx, audit.id, "solid overall");
  // achieved = 2 + 0.5 + 0.8 = 3.3 of max 4 => 82.5%
  assert.equal(result.scorePercent, 82.5);
  assert.equal(result.outcome, "conditional");
});

test("a major-nc finding caps a passing score at conditional", async () => {
  const h = harness();
  const audit = await startedAudit(h);
  const svc = h.module.services.audits;
  for (const item of allItems(audit)) {
    if (item.answerType === "conformity") {
      await svc.answerItem(h.ctx, audit.id, item.id, { kind: "conformity", value: "conform" });
    } else if (item.answerType === "score") {
      await svc.answerItem(h.ctx, audit.id, item.id, { kind: "score", value: 5 });
    } else {
      await svc.answerItem(h.ctx, audit.id, item.id, { kind: "yes-no", value: "yes" });
    }
  }
  await svc.recordFinding(h.ctx, audit.id, {
    classification: "major-nc",
    description: "Uncalibrated gauge in active use",
  });
  await svc.moveToReview(h.ctx, audit.id);
  const { result } = await svc.completeAudit(h.ctx, audit.id);
  assert.equal(result.scorePercent, 100);
  assert.equal(result.outcome, "conditional");
});

test("closing requires major-nc findings linked to NCR or CAPA; supplier event recorded", async () => {
  const h = harness();
  const audit = await startedAudit(h);
  const svc = h.module.services.audits;
  for (const item of allItems(audit)) {
    if (item.answerType === "conformity") {
      await svc.answerItem(h.ctx, audit.id, item.id, { kind: "conformity", value: "conform" });
    } else if (item.answerType === "score") {
      await svc.answerItem(h.ctx, audit.id, item.id, { kind: "score", value: 5 });
    } else {
      await svc.answerItem(h.ctx, audit.id, item.id, { kind: "yes-no", value: "yes" });
    }
  }
  const { finding } = await svc.recordFinding(h.ctx, audit.id, {
    classification: "major-nc",
    description: "No traceability for heat lots",
    requirementRef: "ISO9001:2015 §8.5.2",
  });
  await svc.moveToReview(h.ctx, audit.id);
  await svc.completeAudit(h.ctx, audit.id);

  // Supplier audit with major NC -> supplier quality event
  const supplierEvents = await h.module.services.supplierQuality.listEvents(h.ctx, {
    supplierId: "SUP-100",
  });
  assert.equal(supplierEvents.length, 1);
  assert.equal(supplierEvents[0]!.eventType, "audit-finding");
  assert.equal(supplierEvents[0]!.linkage.auditId, audit.id);

  await assert.rejects(() => svc.closeAudit(h.ctx, audit.id), /not yet linked/);

  // Escalate the finding to an NCR, link it, then close
  const ncr = await h.module.services.ncrs.createNcr(
    h.ctx,
    {
      title: "Traceability breakdown at Acme",
      description: "Heat lot traceability missing on machined castings",
      source: "audit",
      severity: "major",
      linkage: { auditId: audit.id, supplierId: "SUP-100" },
    },
    { autoSubmit: true, recordSupplierEvent: false },
  );
  await svc.linkFinding(h.ctx, audit.id, finding.id, { ncrId: ncr.id });
  const closed = await svc.closeAudit(h.ctx, audit.id);
  assert.equal(closed.status, "closed");
});

test("linking a finding to a non-existent NCR fails", async () => {
  const h = harness();
  const audit = await startedAudit(h);
  const svc = h.module.services.audits;
  const { finding } = await svc.recordFinding(h.ctx, audit.id, {
    classification: "observation",
    description: "Shadow board incomplete",
  });
  await assert.rejects(
    () =>
      svc.linkFinding(h.ctx, audit.id, finding.id, {
        ncrId: "ncr_does_not_exist" as never,
      }),
    /not found/,
  );
});
