import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Ulid } from "@enterprise-suite/shared-kernel";
import { addMonths, type DateOnly } from "../src/domain/dates.js";
import { SrmEventTypes } from "../src/domain/events.js";
import { deriveOutcome, type SectionCode } from "../src/domain/qualification.js";
import { activeSupplier, expectRejects, world, type TestWorld } from "./helpers.js";

const FULL_SCORES: Readonly<Record<SectionCode, number>> = {
  quality_system: 88,
  manufacturing_capability: 84,
  delivery_performance: 80,
  financial_health: 78,
  esg_compliance: 76,
  information_security: 90,
  capacity_scalability: 82,
};

/** Schedules, starts and scores an audit, leaving it in progress. */
async function auditInProgress(
  w: TestWorld,
  supplierId: Ulid,
  overrides: { scores?: Partial<Record<SectionCode, number>>; categoryId?: Ulid; validityMonths?: number } = {},
) {
  const { qualification } = w.container.services;
  const scheduled = await qualification.schedule(w.ctx, {
    supplierId,
    type: "initial",
    method: "onsite_audit",
    scheduledOn: w.today,
    categoryId: overrides.categoryId,
    validityMonths: overrides.validityMonths,
  });
  await qualification.start(w.ctx, scheduled.id);
  const scores = { ...FULL_SCORES, ...(overrides.scores ?? {}) };
  for (const section of scheduled.sections) {
    await qualification.scoreSection(w.ctx, scheduled.id, section.code, scores[section.code]);
  }
  return qualification.get(w.ctx, scheduled.id);
}

describe("qualification outcome derivation", () => {
  it("lets a critical finding fail an otherwise perfect audit", () => {
    const critical = [{ severity: "critical", status: "open" }] as never;
    assert.equal(deriveOutcome(100, critical), "failed");
  });

  it("caps a high score at conditional while a major finding is open", () => {
    const major = [{ severity: "major", status: "open" }] as never;
    assert.equal(deriveOutcome(95, major), "conditional");
  });

  it("uses the score thresholds when nothing serious is open", () => {
    assert.equal(deriveOutcome(75, []), "passed");
    assert.equal(deriveOutcome(74.9, []), "conditional");
    assert.equal(deriveOutcome(60, []), "conditional");
    assert.equal(deriveOutcome(59.9, []), "failed");
  });
});

describe("qualification workflow", () => {
  it("weights the sections rather than averaging them", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const audit = await auditInProgress(w, supplier.id, {
      scores: { quality_system: 100, information_security: 0, capacity_scalability: 0 },
    });
    // (30x100 + 20x84 + 15x80 + 15x78 + 10x76 + 5x0 + 5x0) / 100 weight.
    assert.equal(audit.weightedScore(), 78.1);
  });

  it("refuses to complete while a weighted section is unscored", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification } = w.container.services;
    const scheduled = await qualification.schedule(w.ctx, {
      supplierId: supplier.id,
      type: "initial",
      method: "desk_review",
      scheduledOn: w.today,
    });
    await qualification.start(w.ctx, scheduled.id);
    await qualification.scoreSection(w.ctx, scheduled.id, "quality_system", 90);
    await expectRejects(qualification.complete(w.ctx, scheduled.id), "INVALID_STATE", "unscored sections");
  });

  it("drops zero-weight sections instead of blocking on them", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification } = w.container.services;
    const scheduled = await qualification.schedule(w.ctx, {
      supplierId: supplier.id,
      type: "surveillance",
      method: "self_assessment",
      scheduledOn: w.today,
      sectionWeights: { manufacturing_capability: 0, capacity_scalability: 0, information_security: 0 },
    });
    assert.deepEqual(
      scheduled.sections.map((section) => section.code),
      ["quality_system", "delivery_performance", "financial_health", "esg_compliance"],
    );
    await qualification.start(w.ctx, scheduled.id);
    for (const section of scheduled.sections) {
      await qualification.scoreSection(w.ctx, scheduled.id, section.code, 90);
    }
    const { outcome } = await qualification.complete(w.ctx, scheduled.id);
    assert.equal(outcome, "passed");
  });

  it("only accepts scores and findings while the audit is running", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification } = w.container.services;
    const scheduled = await qualification.schedule(w.ctx, {
      supplierId: supplier.id,
      type: "initial",
      method: "virtual_audit",
      scheduledOn: w.today,
    });
    await expectRejects(
      qualification.scoreSection(w.ctx, scheduled.id, "quality_system", 80),
      "INVALID_STATE",
      "expected in_progress",
    );
    await qualification.start(w.ctx, scheduled.id);
    await expectRejects(qualification.start(w.ctx, scheduled.id), "INVALID_STATE");
    await expectRejects(
      qualification.scoreSection(w.ctx, scheduled.id, "quality_system", 140),
      "VALIDATION",
      "between 0 and 100",
    );
  });

  it("demands a corrective action plan for major and critical findings", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const audit = await auditInProgress(w, supplier.id);
    const { qualification } = w.container.services;
    await expectRejects(
      qualification.raiseFinding(w.ctx, audit.id, {
        section: "quality_system",
        severity: "major",
        description: "Calibration records missing for the CMM",
      }),
      "VALIDATION",
      "corrective action plan",
    );
    const finding = await qualification.raiseFinding(w.ctx, audit.id, {
      section: "quality_system",
      severity: "major",
      description: "Calibration records missing for the CMM",
      capa: { action: "Recalibrate and file records", dueOn: addMonths(w.today, 2) },
    });
    assert.equal(finding.capa?.ownerId, w.ctx.userId, "the auditor owns the CAPA unless told otherwise");
  });

  it("halves the validity of a conditional pass and restores it on CAPA closure", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const audit = await auditInProgress(w, supplier.id, { validityMonths: 24 });
    const { qualification } = w.container.services;
    const finding = await qualification.raiseFinding(w.ctx, audit.id, {
      section: "delivery_performance",
      severity: "major",
      description: "No formal escalation path for late shipments",
      capa: { action: "Publish an escalation matrix", dueOn: addMonths(w.today, 1) },
    });

    const { outcome } = await qualification.complete(w.ctx, audit.id, "Capable, with gaps");
    assert.equal(outcome, "conditional", "an open major finding caps the outcome");
    let current = await qualification.get(w.ctx, audit.id);
    assert.equal(current.validUntil, addMonths(w.today, 12), "conditional buys half the runway");
    assert.equal(current.conditions.length, 1);

    const rerated = await qualification.closeFinding(w.ctx, audit.id, finding.id, "Matrix published 2026-02-01");
    assert.equal(rerated.outcome, "passed");
    assert.equal(rerated.validUntil, addMonths(w.today, 24), "a full pass restores the full window");
    assert.deepEqual(rerated.conditions, []);

    current = await qualification.get(w.ctx, audit.id);
    const rerate = w.container.outbox
      .entries(w.ctx.tenantId)
      .filter((event) => event.eventType === SrmEventTypes.QualificationCompleted)
      .at(-1);
    assert.equal((rerate?.payload as { rerated?: boolean }).rerated, true);
    assert.equal((rerate?.payload as { previousOutcome?: string }).previousOutcome, "conditional");
  });

  it("waives an observation but never a major finding", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const audit = await auditInProgress(w, supplier.id);
    const { qualification } = w.container.services;
    const observation = await qualification.raiseFinding(w.ctx, audit.id, {
      section: "esg_compliance",
      severity: "observation",
      description: "Sustainability report is a year old",
    });
    const major = await qualification.raiseFinding(w.ctx, audit.id, {
      section: "financial_health",
      severity: "major",
      description: "Debt covenant close to breach",
      capa: { action: "Provide quarterly management accounts", dueOn: addMonths(w.today, 3) },
    });
    await expectRejects(
      qualification.waiveFinding(w.ctx, audit.id, major.id, "Accepted by the CPO"),
      "INVALID_STATE",
      "cannot be waived",
    );
    const waived = await qualification.waiveFinding(w.ctx, audit.id, observation.id, "Refresh due next quarter");
    assert.equal(waived.findings.find((entry) => entry.id === observation.id)?.status, "waived");
  });

  it("holds sourcing and raises a quality risk flag when the audit fails", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const category = await w.container.services.category.create(w.ctx, {
      code: "castings",
      name: "Castings",
      requiresQualification: true,
    });
    const audit = await auditInProgress(w, supplier.id, {
      categoryId: category.id,
      scores: { quality_system: 20, manufacturing_capability: 30 },
    });
    const { qualification } = w.container.services;
    await qualification.raiseFinding(w.ctx, audit.id, {
      section: "quality_system",
      severity: "critical",
      description: "No incoming inspection at all",
      capa: { action: "Stand up incoming inspection", dueOn: addMonths(w.today, 1) },
    });
    const { outcome } = await qualification.complete(w.ctx, audit.id);
    assert.equal(outcome, "failed");
    assert.equal((await qualification.get(w.ctx, audit.id)).validUntil, undefined);

    const clearance = await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: category.id });
    assert.equal(clearance.cleared, false);
    assert.equal(clearance.holds[0]?.reasonCode, "failed_audit");
    assert.equal(clearance.holds[0]?.scope, "categories", "the hold is scoped to the audited category");

    const profile = await w.container.repos.riskProfiles.bySupplier(w.ctx.tenantId, supplier.id);
    const flag = profile?.openFlags().find((entry) => entry.source === "audit");
    assert.equal(flag?.category, "quality");
    assert.equal(flag?.inherentScore, 20, "a critical finding pushes impact to 5");

    // A failed audit cannot be talked back up; it needs a new one.
    await expectRejects(
      qualification.closeFinding(w.ctx, audit.id, (await qualification.get(w.ctx, audit.id)).findings[0]!.id, "Fixed"),
      "INVALID_STATE",
      "schedule a new qualification",
    );
  });

  it("takes the requalification interval from the category policy", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const parent = await w.container.services.category.create(w.ctx, {
      code: "electronics",
      name: "Electronics",
      requalificationMonths: 18,
    });
    const child = await w.container.services.category.create(w.ctx, {
      code: "smt",
      name: "SMT",
      parentId: parent.id,
      requalificationMonths: 12,
    });
    const audit = await auditInProgress(w, supplier.id, { categoryId: child.id });
    await w.container.services.qualification.complete(w.ctx, audit.id);
    const completed = await w.container.services.qualification.get(w.ctx, audit.id);
    assert.equal(completed.validUntil, addMonths(w.today, 12), "the shortest inherited interval wins");
  });

  it("lists what is coming due for requalification", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const audit = await auditInProgress(w, supplier.id, { validityMonths: 6 });
    await w.container.services.qualification.complete(w.ctx, audit.id);
    const { qualification } = w.container.services;
    assert.equal((await qualification.dueForRequalification(w.ctx, 30)).length, 0);
    assert.equal((await qualification.dueForRequalification(w.ctx, 200)).length, 1);
  });
});

describe("certifications", () => {
  it("rejects a certificate whose expiry does not follow its issue date", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    await expectRejects(
      w.container.services.qualification.recordCertification(w.ctx, {
        supplierId: supplier.id,
        type: "iso9001",
        issuer: "TUV",
        certificateNumber: "TUV-1",
        issuedOn: w.today,
        expiresOn: w.today,
      }),
      "VALIDATION",
      "must be after issuedOn",
    );
  });

  it("refuses the same certificate twice and points at renewal instead", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification } = w.container.services;
    const input = {
      supplierId: supplier.id,
      type: "iso9001" as const,
      issuer: "TUV Rheinland",
      certificateNumber: "TUV-9001-2026",
      issuedOn: w.today,
      expiresOn: addMonths(w.today, 36),
    };
    await qualification.recordCertification(w.ctx, input);
    await expectRejects(qualification.recordCertification(w.ctx, input), "INVALID_STATE", "renew it instead");
  });

  it("only verifies pending certificates and never an expired one", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification } = w.container.services;
    const certification = await qualification.recordCertification(w.ctx, {
      supplierId: supplier.id,
      type: "iso14001",
      issuer: "BSI",
      certificateNumber: "BSI-14001",
      issuedOn: "2025-01-01" as DateOnly,
      expiresOn: "2025-12-31" as DateOnly,
    });
    await expectRejects(
      qualification.verifyCertification(w.ctx, certification.id),
      "INVALID_STATE",
      "record a renewal instead",
    );
  });

  it("requires a renewal to extend the coverage it replaces", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification } = w.container.services;
    const certification = await qualification.recordCertification(w.ctx, {
      supplierId: supplier.id,
      type: "iso9001",
      issuer: "TUV",
      certificateNumber: "TUV-1",
      issuedOn: w.today,
      expiresOn: addMonths(w.today, 12),
    });
    await qualification.verifyCertification(w.ctx, certification.id);
    await expectRejects(
      qualification.renewCertification(w.ctx, certification.id, {
        certificateNumber: "TUV-2",
        issuedOn: w.today,
        expiresOn: addMonths(w.today, 6),
      }),
      "VALIDATION",
      "must extend beyond the current expiry",
    );
    const renewed = await qualification.renewCertification(w.ctx, certification.id, {
      certificateNumber: "TUV-2",
      issuedOn: w.today,
      expiresOn: addMonths(w.today, 24),
    });
    assert.equal(renewed.certificateNumber, "TUV-2");
    assert.equal(renewed.renewals[0]?.certificateNumber, "TUV-1", "the superseded certificate stays on record");
  });
});

describe("compliance sweep", () => {
  /** Supplier approved in a category that demands ISO 9001, holding one. */
  async function certifiedSupplier(w: TestWorld, expiresOn: DateOnly) {
    const supplier = await activeSupplier(w);
    const category = await w.container.services.category.create(w.ctx, {
      code: "machined-parts",
      name: "Machined parts",
      requiredCertifications: ["iso9001"],
    });
    const certification = await w.container.services.qualification.recordCertification(w.ctx, {
      supplierId: supplier.id,
      type: "iso9001",
      issuer: "TUV",
      certificateNumber: "TUV-9001",
      issuedOn: "2025-06-01" as DateOnly,
      expiresOn,
    });
    await w.container.services.qualification.verifyCertification(w.ctx, certification.id);
    await w.container.services.supplier.assignCategory(w.ctx, supplier.id, category.id);
    await w.container.services.supplier.approveCategory(w.ctx, supplier.id, category.id);
    return { supplier, category, certification };
  }

  it("warns once inside the window and then expires the certificate", async () => {
    const w = world();
    const { certification } = await certifiedSupplier(w, "2026-02-15" as DateOnly);
    const { qualification } = w.container.services;

    const first = await qualification.runComplianceSweep(w.ctx);
    assert.deepEqual(first.certificationsExpiring, ["TUV-9001"], "45 days out is inside the 60-day window");
    const second = await qualification.runComplianceSweep(w.ctx);
    assert.deepEqual(second.certificationsExpiring, [], "the warning fires once, not nightly");

    w.clock.set("2026-02-16T00:00:00.000Z");
    const third = await qualification.runComplianceSweep(w.ctx);
    assert.deepEqual(third.certificationsExpired, ["TUV-9001"]);
    assert.equal(third.holdsPlaced, 1);
    assert.equal((await qualification.getCertification(w.ctx, certification.id)).status, "expired");
  });

  it("scopes the expiry hold to the categories that actually demand the certificate", async () => {
    const w = world();
    const { supplier, category } = await certifiedSupplier(w, "2026-01-05" as DateOnly);
    const other = await w.container.services.category.create(w.ctx, { code: "stationery", name: "Stationery" });
    await w.container.services.supplier.assignCategory(w.ctx, supplier.id, other.id);
    await w.container.services.supplier.approveCategory(w.ctx, supplier.id, other.id);

    w.clock.advanceDays(10);
    await w.container.services.qualification.runComplianceSweep(w.ctx);

    const blocked = await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: category.id });
    assert.equal(blocked.cleared, false);
    assert.equal(blocked.holds[0]?.reasonCode, "expired_certification");
    const unaffected = await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: other.id });
    assert.equal(unaffected.cleared, true, "stationery never needed ISO 9001");
  });

  it("leaves a voluntary certificate alone when no category requires it", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { qualification } = w.container.services;
    await qualification.recordCertification(w.ctx, {
      supplierId: supplier.id,
      type: "ecovadis",
      issuer: "EcoVadis",
      certificateNumber: "EV-2025",
      issuedOn: "2025-01-01" as DateOnly,
      expiresOn: "2025-12-31" as DateOnly,
    });
    const sweep = await qualification.runComplianceSweep(w.ctx);
    assert.equal(sweep.holdsPlaced, 0, "an unverified, unrequired certificate does not stop trade");
  });

  it("lets a renewal lift the hold its expiry caused", async () => {
    const w = world();
    const { supplier, certification, category } = await certifiedSupplier(w, "2026-01-05" as DateOnly);
    w.clock.advanceDays(10);
    await w.container.services.qualification.runComplianceSweep(w.ctx);
    assert.equal((await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: category.id })).cleared, false);

    await w.container.services.qualification.renewCertification(w.ctx, certification.id, {
      certificateNumber: "TUV-9001-B",
      issuedOn: w.clock.today(),
      expiresOn: addMonths(w.clock.today(), 36),
    });
    const cleared = await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: category.id });
    assert.equal(cleared.cleared, true, "the fact that caused the hold is gone, so the hold goes");
  });

  it("holds immediately on revocation and expires stale qualifications", async () => {
    const w = world();
    const { supplier, certification, category } = await certifiedSupplier(w, "2027-01-01" as DateOnly);
    const audit = await auditInProgress(w, supplier.id, { validityMonths: 6 });
    await w.container.services.qualification.complete(w.ctx, audit.id);

    await w.container.services.qualification.revokeCertification(w.ctx, certification.id, "Certifying body withdrew it");
    const held = await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: category.id });
    assert.equal(held.cleared, false);
    assert.equal(held.holds[0]?.reasonCode, "expired_certification");

    w.clock.set("2026-08-01T00:00:00.000Z");
    const sweep = await w.container.services.qualification.runComplianceSweep(w.ctx);
    assert.deepEqual(sweep.qualificationsExpired, [(await w.container.services.qualification.get(w.ctx, audit.id)).reference]);
    assert.equal((await w.container.services.qualification.get(w.ctx, audit.id)).status, "expired");
  });

  it("lets time-boxed holds fall away on their own", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    await w.container.services.risk.placeHold(w.ctx, supplier.id, {
      type: "sourcing",
      reasonCode: "unverified_bank_details",
      note: "Bank details changed; penny test in flight",
      expiresOn: "2026-01-10" as DateOnly,
    });
    w.clock.set("2026-01-11T00:00:00.000Z");
    const sweep = await w.container.services.qualification.runComplianceSweep(w.ctx);
    assert.equal(sweep.holdsExpired, 1);
    assert.equal((await w.container.services.risk.clearance(w.ctx, supplier.id, "sourcing")).cleared, true);
  });
});
