import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SrmEventTypes } from "../src/domain/events.js";
import { APPROVAL_MATRIX } from "../src/domain/onboarding.js";
import { actor, activate, expectRejects, tradingSupplier, world, type TestWorld } from "./helpers.js";

const STANDARD_QUESTIONS = [
  "financial-stability",
  "subcontracting",
  "single-source",
  "data-access",
  "labour-practices",
  "geo-exposure",
] as const;

/** Answers every required question with the same risk factor. */
async function answerAll(w: TestWorld, caseId: string, riskFactor: number) {
  for (const code of STANDARD_QUESTIONS) {
    await w.container.services.onboarding.answerQuestion(w.ctx, caseId as never, {
      code,
      value: `factor ${riskFactor}`,
      riskFactor,
    });
  }
}

async function caseFor(w: TestWorld, templateCode = "indirect-low-risk", code = "ACME-PARTS") {
  const supplier = await tradingSupplier(w, code);
  const onboarding = await w.container.services.onboarding.start(w.ctx, { supplierId: supplier.id, templateCode });
  return { supplier, onboarding };
}

describe("onboarding case creation", () => {
  it("instantiates the template checklist and moves the supplier into onboarding", async () => {
    const w = world();
    const { supplier, onboarding } = await caseFor(w);
    assert.equal(onboarding.number, "ONB-00001");
    assert.equal(onboarding.status, "in_progress");
    assert.deepEqual(
      onboarding.steps.map((step) => step.code),
      ["legal-entity", "tax-forms", "risk-questionnaire", "bank-verification", "code-of-conduct"],
    );
    assert.deepEqual(
      onboarding.documents.filter((doc) => doc.required).map((doc) => doc.code),
      ["tax-form", "coc"],
    );

    const reloaded = await w.container.services.supplier.get(w.ctx, supplier.id);
    assert.equal(reloaded.status, "onboarding");
    assert.equal(reloaded.onboardingCaseId, onboarding.id);
  });

  it("rejects an unknown template and a second open case", async () => {
    const w = world();
    const { supplier } = await caseFor(w);
    const fresh = await tradingSupplier(w, "FRESH-CO");
    await expectRejects(
      w.container.services.onboarding.start(w.ctx, { supplierId: fresh.id, templateCode: "made-up" }),
      "VALIDATION",
      "unknown template",
    );
    await expectRejects(
      w.container.services.onboarding.start(w.ctx, {
        supplierId: supplier.id,
        templateCode: "indirect-low-risk",
      }),
      "INVALID_STATE",
      "already has an open onboarding case",
    );
  });

  it("numbers cases per tenant", async () => {
    const w = world();
    const { onboarding } = await caseFor(w, "indirect-low-risk", "FIRST");
    const second = await caseFor(w, "indirect-low-risk", "SECOND");
    assert.equal(onboarding.number, "ONB-00001");
    assert.equal(second.onboarding.number, "ONB-00002");
  });
});

describe("onboarding checklist", () => {
  it("enforces step prerequisites in both start and complete", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;

    await expectRejects(
      service.startStep(w.ctx, onboarding.id, "bank-verification"),
      "INVALID_STATE",
      "blocked by legal-entity, tax-forms",
    );
    await service.completeStep(w.ctx, onboarding.id, "legal-entity", "registry-extract.pdf");
    await expectRejects(
      service.completeStep(w.ctx, onboarding.id, "bank-verification"),
      "INVALID_STATE",
      "blocked by tax-forms",
    );
  });

  it("keeps a document step open until its evidence is verified", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;
    await service.completeStep(w.ctx, onboarding.id, "legal-entity");

    await expectRejects(
      service.completeStep(w.ctx, onboarding.id, "tax-forms"),
      "INVALID_STATE",
      "needs verified documents: tax-form",
    );
    await service.receiveDocument(w.ctx, onboarding.id, "tax-form", "w9.pdf");
    await expectRejects(
      service.completeStep(w.ctx, onboarding.id, "tax-forms"),
      "INVALID_STATE",
      "needs verified documents",
    );
    await service.verifyDocument(w.ctx, onboarding.id, "tax-form");
    const step = await service.completeStep(w.ctx, onboarding.id, "tax-forms");
    assert.equal(step.status, "completed");
  });

  it("walks a document through received, rejected and re-submitted", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;

    await expectRejects(
      service.verifyDocument(w.ctx, onboarding.id, "tax-form"),
      "INVALID_STATE",
      "only received documents can be verified",
    );
    await service.receiveDocument(w.ctx, onboarding.id, "tax-form", "wrong-form.pdf");
    const rejected = await service.rejectDocument(w.ctx, onboarding.id, "tax-form", "Wrong jurisdiction");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectedReason, "Wrong jurisdiction");

    const resubmitted = await service.receiveDocument(w.ctx, onboarding.id, "tax-form", "correct-form.pdf");
    assert.equal(resubmitted.status, "received");
    assert.equal(resubmitted.rejectedReason, undefined, "a fresh submission clears the rejection");
    assert.equal((await service.verifyDocument(w.ctx, onboarding.id, "tax-form")).status, "verified");
  });

  it("only waives a required step with a reason and counts it as done", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;
    await expectRejects(service.waiveStep(w.ctx, onboarding.id, "legal-entity", "  "), "VALIDATION", "reason");

    const waived = await service.waiveStep(w.ctx, onboarding.id, "legal-entity", "Verified during the RFQ");
    assert.equal(waived.status, "waived");
    assert.equal(waived.waivedReason, "Verified during the RFQ");
    const progress = service.progress(await service.get(w.ctx, onboarding.id));
    assert.equal(progress.completion, 0.2, "a waiver satisfies the prerequisite chain and the progress count");
    assert.ok(!progress.outstandingSteps.includes("legal-entity"));
  });

  it("adds an ad-hoc step with validated prerequisites", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;
    await expectRejects(
      service.addStep(w.ctx, onboarding.id, {
        code: "regulator-notice",
        name: "Notify the regulator",
        type: "form",
        ownerRole: "compliance",
        prerequisites: ["does-not-exist"],
      }),
      "VALIDATION",
      "unknown step",
    );
    const step = await service.addStep(w.ctx, onboarding.id, {
      code: "Regulator Notice",
      name: "Notify the regulator",
      type: "form",
      ownerRole: "compliance",
      prerequisites: ["legal-entity"],
    });
    assert.equal(step.code, "regulator-notice", "step codes are slugged");
    assert.equal(step.sequence, 60, "new steps land after the template's last step");
  });
});

describe("onboarding risk scoring", () => {
  it("scores the questionnaire and picks the approval matrix from the tier", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;

    await answerAll(w, onboarding.id, 0.1);
    let progress = service.progress(await service.get(w.ctx, onboarding.id));
    assert.equal(progress.riskScore, 10);
    assert.equal(progress.riskTier, "low");
    assert.deepEqual(progress.requiredRoles, APPROVAL_MATRIX.low);

    // Re-answering replaces rather than stacks, and pushes the tier up.
    await answerAll(w, onboarding.id, 0.8);
    progress = service.progress(await service.get(w.ctx, onboarding.id));
    assert.equal(progress.riskScore, 80);
    assert.equal(progress.riskTier, "critical");
    assert.deepEqual(progress.requiredRoles, APPROVAL_MATRIX.critical);
  });

  it("applies the template's minimum tier as a floor", async () => {
    const w = world();
    const { onboarding } = await caseFor(w, "direct-material");
    await answerAll(w, onboarding.id, 0);
    const progress = w.container.services.onboarding.progress(
      await w.container.services.onboarding.get(w.ctx, onboarding.id),
    );
    assert.equal(progress.riskScore, 0);
    assert.equal(progress.riskTier, "medium", "a direct-material supplier is never low risk");
  });

  it("validates the answer against the template's questions", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;
    await expectRejects(
      service.answerQuestion(w.ctx, onboarding.id, { code: "favourite-colour", value: "blue", riskFactor: 0 }),
      "VALIDATION",
      "unknown question",
    );
    await expectRejects(
      service.answerQuestion(w.ctx, onboarding.id, {
        code: "geo-exposure",
        value: "Everywhere",
        riskFactor: 7,
      }),
      "VALIDATION",
      "between 0 and 1",
    );
  });
});

describe("onboarding submission and approval", () => {
  it("lists every blocker instead of failing on the first one", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    await expectRejects(
      w.container.services.onboarding.submit(w.ctx, onboarding.id),
      "INVALID_STATE",
      "documents: tax-form, coc",
    );
  });

  it("requires every role in the matrix, one vote each, and not from the submitter", async () => {
    const w = world();
    const { supplier, onboarding } = await caseFor(w, "direct-material", "DIRECT-CO");
    const { onboarding: service } = w.container.services;

    // Drive a medium-risk direct-material case to submission.
    await service.completeStep(w.ctx, onboarding.id, "legal-entity");
    for (const code of ["tax-form", "coc", "iso9001", "insurance"]) {
      await service.receiveDocument(w.ctx, onboarding.id, code, `${code}.pdf`);
      await service.verifyDocument(w.ctx, onboarding.id, code);
    }
    await service.completeStep(w.ctx, onboarding.id, "tax-forms");
    await answerAll(w, onboarding.id, 0.1);
    await service.completeStep(w.ctx, onboarding.id, "risk-questionnaire");
    await service.completeStep(w.ctx, onboarding.id, "quality-certificates");
    await service.completeStep(w.ctx, onboarding.id, "capability-assessment");
    await service.completeStep(w.ctx, onboarding.id, "site-audit", "audit-report-2026-01.pdf");
    await service.completeStep(w.ctx, onboarding.id, "bank-verification");
    await service.completeStep(w.ctx, onboarding.id, "code-of-conduct");
    const submitted = await service.submit(w.ctx, onboarding.id);
    assert.equal(submitted.status, "pending_approval");
    assert.deepEqual(service.progress(submitted).requiredRoles, ["procurement", "compliance"]);

    await expectRejects(
      service.decide(w.ctx, onboarding.id, "procurement", "approved"),
      "INVALID_STATE",
      "cannot approve their own",
    );
    await expectRejects(
      service.decide(actor(w.ctx, "cfo"), onboarding.id, "executive", "approved"),
      "INVALID_STATE",
      "not part of the approval matrix",
    );

    await service.decide(actor(w.ctx, "cat-manager"), onboarding.id, "procurement", "approved");
    await expectRejects(
      service.decide(actor(w.ctx, "someone-else"), onboarding.id, "procurement", "approved"),
      "INVALID_STATE",
      "has already decided",
    );
    assert.equal(
      (await w.container.services.supplier.get(w.ctx, supplier.id)).status,
      "onboarding",
      "a partial approval does not go live",
    );

    const approved = await service.decide(actor(w.ctx, "compliance-1"), onboarding.id, "compliance", "approved");
    assert.equal(approved.status, "approved");
    assert.equal((await w.container.services.supplier.get(w.ctx, supplier.id)).status, "active");
  });

  it("materialises verified dated documents into tracked certifications on go-live", async () => {
    const w = world();
    const supplier = await tradingSupplier(w);
    await activate(w, supplier.id);

    const certifications = await w.container.repos.certifications.bySupplier(w.ctx.tenantId, supplier.id);
    assert.deepEqual(
      certifications.map((certification) => certification.type).sort(),
      ["code_of_conduct", "tax_form"],
    );
    const taxForm = certifications.find((certification) => certification.type === "tax_form")!;
    assert.equal(taxForm.status, "valid", "onboarding already checked the evidence");
    assert.equal(taxForm.expiresOn, "2027-01-01", "undated paperwork still gets a review date a year out");
  });

  it("turns a high-risk questionnaire into a standing risk flag", async () => {
    const w = world();
    const { supplier, onboarding } = await caseFor(w, "critical-service", "DATA-CO");
    const { onboarding: service } = w.container.services;

    await service.completeStep(w.ctx, onboarding.id, "legal-entity");
    for (const code of ["tax-form", "coc", "soc2", "dpa-doc", "insurance"]) {
      await service.receiveDocument(w.ctx, onboarding.id, code, `${code}.pdf`);
      await service.verifyDocument(w.ctx, onboarding.id, code);
    }
    await service.completeStep(w.ctx, onboarding.id, "tax-forms");
    await answerAll(w, onboarding.id, 0.9);
    await service.completeStep(w.ctx, onboarding.id, "risk-questionnaire");
    await service.completeStep(w.ctx, onboarding.id, "security-review");
    await service.completeStep(w.ctx, onboarding.id, "dpa");
    await service.completeStep(w.ctx, onboarding.id, "bcp-review");
    await service.completeStep(w.ctx, onboarding.id, "bank-verification");
    await service.completeStep(w.ctx, onboarding.id, "exec-briefing");
    await service.submit(w.ctx, onboarding.id);

    for (const role of ["procurement", "compliance", "finance", "executive"] as const) {
      await service.decide(actor(w.ctx, `${role}-approver`), onboarding.id, role, "approved");
    }

    const profile = await w.container.repos.riskProfiles.bySupplier(w.ctx.tenantId, supplier.id);
    const flag = profile?.openFlags().find((entry) => entry.source === "questionnaire");
    assert.ok(flag, "a critical questionnaire result outlives the case");
    assert.equal(flag.category, "operational");
    assert.equal(flag.inherentScore, 20, "likelihood 4 x impact 5 on the critical path");
    assert.equal(profile?.tier, "critical");
  });

  it("rejects with a mandatory comment and lands the supplier in rejected", async () => {
    const w = world();
    const supplier = await tradingSupplier(w, "NOPE-CO");
    const { onboarding: service } = w.container.services;
    const onboarding = await service.start(w.ctx, {
      supplierId: supplier.id,
      templateCode: "indirect-low-risk",
    });
    await service.completeStep(w.ctx, onboarding.id, "legal-entity");
    for (const code of ["tax-form", "coc"]) {
      await service.receiveDocument(w.ctx, onboarding.id, code, `${code}.pdf`);
      await service.verifyDocument(w.ctx, onboarding.id, code);
    }
    await service.completeStep(w.ctx, onboarding.id, "tax-forms");
    await answerAll(w, onboarding.id, 0.1);
    await service.completeStep(w.ctx, onboarding.id, "risk-questionnaire");
    await service.completeStep(w.ctx, onboarding.id, "bank-verification");
    await service.completeStep(w.ctx, onboarding.id, "code-of-conduct");
    await service.submit(w.ctx, onboarding.id);

    await expectRejects(
      service.decide(actor(w.ctx, "reviewer"), onboarding.id, "procurement", "rejected"),
      "VALIDATION",
      "comment is required",
    );
    const rejected = await service.decide(
      actor(w.ctx, "reviewer"),
      onboarding.id,
      "procurement",
      "rejected",
      "Beneficial ownership could not be established",
    );
    assert.equal(rejected.status, "rejected");
    assert.equal((await w.container.services.supplier.get(w.ctx, supplier.id)).status, "rejected");

    const types = w.container.outbox.entries(w.ctx.tenantId).map((event) => event.eventType);
    assert.ok(types.includes(SrmEventTypes.OnboardingRejected));
    assert.ok(!types.includes(SrmEventTypes.OnboardingApproved));
  });

  it("freezes the case once it is submitted or withdrawn", async () => {
    const w = world();
    const { onboarding } = await caseFor(w);
    const { onboarding: service } = w.container.services;
    const withdrawn = await service.withdraw(w.ctx, onboarding.id, "Supplier pulled out of the bid");
    assert.equal(withdrawn.status, "withdrawn");
    await expectRejects(
      service.completeStep(w.ctx, onboarding.id, "legal-entity"),
      "INVALID_STATE",
      "is withdrawn",
    );
    await expectRejects(
      service.withdraw(w.ctx, onboarding.id, "again"),
      "INVALID_STATE",
      "cannot be withdrawn",
    );
  });
});
