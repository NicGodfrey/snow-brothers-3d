import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Ulid } from "@enterprise-suite/shared-kernel";
import { addMonths, type DateOnly } from "../src/domain/dates.js";
import type { EligibilityAssessment, EligibilityCode } from "../src/domain/eligibility.js";
import type { SectionCode } from "../src/domain/qualification.js";
import { activeSupplier, expectRejects, world, type TestWorld } from "./helpers.js";

const PASSING: Readonly<Record<SectionCode, number>> = {
  quality_system: 88,
  manufacturing_capability: 84,
  delivery_performance: 82,
  financial_health: 80,
  esg_compliance: 78,
  information_security: 86,
  capacity_scalability: 84,
};

function codes(issues: readonly { code: EligibilityCode }[]): readonly EligibilityCode[] {
  return issues.map((issue) => issue.code);
}

function has(assessment: EligibilityAssessment, code: EligibilityCode): boolean {
  return codes(assessment.blockers).includes(code) || codes(assessment.warnings).includes(code);
}

/** A regulated category: qualification plus an ISO 9001 certificate. */
async function regulatedCategory(w: TestWorld) {
  return w.container.services.category.create(w.ctx, {
    code: "castings",
    name: "Castings",
    riskTier: "high",
    requiresQualification: true,
    requiredCertifications: ["iso9001"],
    requalificationMonths: 24,
  });
}

async function passAudit(w: TestWorld, supplierId: Ulid, categoryId: Ulid): Promise<void> {
  const { qualification } = w.container.services;
  const scheduled = await qualification.schedule(w.ctx, {
    supplierId,
    type: "initial",
    method: "onsite_audit",
    scheduledOn: w.today,
    categoryId,
  });
  await qualification.start(w.ctx, scheduled.id);
  for (const section of scheduled.sections) {
    await qualification.scoreSection(w.ctx, scheduled.id, section.code, PASSING[section.code]);
  }
  const { outcome } = await qualification.complete(w.ctx, scheduled.id);
  assert.equal(outcome, "passed");
}

async function certify(w: TestWorld, supplierId: Ulid, expiresOn: DateOnly) {
  const { qualification } = w.container.services;
  const certification = await qualification.recordCertification(w.ctx, {
    supplierId,
    type: "iso9001",
    issuer: "TUV",
    certificateNumber: `TUV-${supplierId.slice(-4)}`,
    issuedOn: "2025-06-01" as DateOnly,
    expiresOn,
  });
  return qualification.verifyCertification(w.ctx, certification.id);
}

/** Active, audited, certified and approved on the panel for the category. */
async function panelSupplier(
  w: TestWorld,
  code: string,
  categoryId: Ulid,
  options: { certExpiresOn?: DateOnly } = {},
) {
  const { supplier: suppliers } = w.container.services;
  const supplier = await activeSupplier(w, code);
  await certify(w, supplier.id, options.certExpiresOn ?? ("2028-01-01" as DateOnly));
  await passAudit(w, supplier.id, categoryId);
  await suppliers.assignCategory(w.ctx, supplier.id, categoryId);
  await suppliers.approveCategory(w.ctx, supplier.id, categoryId);
  return suppliers.get(w.ctx, supplier.id);
}

async function payable(w: TestWorld, supplierId: Ulid): Promise<void> {
  const { supplier: suppliers } = w.container.services;
  await suppliers.addBankAccount(w.ctx, supplierId, {
    label: "Operating account",
    bankName: "Deutsche Bank",
    countryCode: "DE",
    currency: "EUR",
    accountNumber: "DE89370400440532013000",
  });
  const withAccount = await suppliers.get(w.ctx, supplierId);
  await suppliers.verifyBankAccount(w.ctx, supplierId, withAccount.bankAccounts[0]!.id);
}

async function coverWithContract(w: TestWorld, supplierId: Ulid, categoryIds: Ulid[], effectiveTo: DateOnly) {
  const { contract } = w.container.services;
  const drafted = await contract.draft(w.ctx, {
    supplierId,
    type: "framework",
    title: "Castings framework",
    currency: "EUR",
    effectiveFrom: "2026-01-01" as DateOnly,
    effectiveTo,
    noticeDays: 60,
    categoryIds,
  });
  const supplierSide = await contract.addSignatory(w.ctx, drafted.id, { party: "supplier", name: "MD" });
  const buyerSide = await contract.addSignatory(w.ctx, drafted.id, { party: "buyer", name: "CPO" });
  await contract.sendForSignature(w.ctx, drafted.id);
  await contract.sign(w.ctx, drafted.id, supplierSide.id);
  await contract.sign(w.ctx, drafted.id, buyerSide.id);
  return contract.activate(w.ctx, drafted.id);
}

describe("award eligibility", () => {
  it("clears a supplier that satisfies the whole category policy", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id);
    await payable(w, supplier.id);
    const contract = await coverWithContract(w, supplier.id, [category.id], "2027-12-31" as DateOnly);

    const assessment = await w.container.services.eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(assessment.eligible, true);
    assert.deepEqual(assessment.blockers, []);
    assert.deepEqual(assessment.warnings, []);
    assert.equal(assessment.governingContractId, contract.id, "the award is covered by the framework");
    assert.equal(assessment.asOf, w.today);
  });

  it("names every reason a buyer cannot award, not just the first", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await activeSupplier(w, "GAPS-CO");
    await w.container.services.supplier.suspend(w.ctx, supplier.id, "Quality escape under investigation");

    const assessment = await w.container.services.eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(assessment.eligible, false);
    assert.deepEqual(codes(assessment.blockers).sort(), [
      "category_not_assigned",
      "certification_missing",
      "qualification_missing",
      "supplier_not_active",
    ]);
    assert.match(
      assessment.blockers.find((issue) => issue.code === "supplier_not_active")?.message ?? "",
      /suspended/,
      "the message says what the status actually is",
    );
  });

  it("treats an assigned-but-unapproved panel seat as a blocker", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await activeSupplier(w);
    await certify(w, supplier.id, "2028-01-01" as DateOnly);
    await passAudit(w, supplier.id, category.id);
    await w.container.services.supplier.assignCategory(w.ctx, supplier.id, category.id);

    const pending = await w.container.services.eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.deepEqual(codes(pending.blockers), ["category_not_approved"]);

    await w.container.services.supplier.approveCategory(w.ctx, supplier.id, category.id);
    const approved = await w.container.services.eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(approved.eligible, true);

    await w.container.services.supplier.restrictCategory(w.ctx, supplier.id, category.id, "Capacity shortfall");
    const restricted = await w.container.services.eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.deepEqual(codes(restricted.blockers), ["category_restricted"]);
    assert.match(restricted.blockers[0]?.message ?? "", /Capacity shortfall/);
  });

  it("separates a lapsed certificate from one that was never held", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id, {
      certExpiresOn: "2026-03-31" as DateOnly,
    });
    const { eligibility, qualification } = w.container.services;

    w.clock.set("2026-02-15T00:00:00.000Z");
    const warned = await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(warned.eligible, true, "a certificate inside its warning window still supports an award");
    const expiring = warned.warnings.find((issue) => issue.code === "certification_expiring");
    assert.ok(expiring);
    assert.equal(
      (expiring.detail as { daysToExpiry: number }).daysToExpiry,
      44,
      "the buyer is told how long they have",
    );

    w.clock.set("2026-04-01T00:00:00.000Z");
    await qualification.runComplianceSweep(w.ctx);
    const lapsed = await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(lapsed.eligible, false);
    assert.ok(codes(lapsed.blockers).includes("certification_expired"));
    assert.ok(
      codes(lapsed.blockers).includes("hold_active"),
      "the sweep also held sourcing on the categories that demand the certificate",
    );
  });

  it("blocks on an expired qualification and warns on a conditional one", async () => {
    const w = world();
    const { category, eligibility, qualification, supplier: suppliers } = w.container.services;
    const shortLived = await category.create(w.ctx, {
      code: "fasteners",
      name: "Fasteners",
      requiresQualification: true,
      requalificationMonths: 6,
    });
    const supplier = await activeSupplier(w);

    const scheduled = await qualification.schedule(w.ctx, {
      supplierId: supplier.id,
      type: "initial",
      method: "desk_review",
      scheduledOn: w.today,
      categoryId: shortLived.id,
    });
    await qualification.start(w.ctx, scheduled.id);
    for (const section of scheduled.sections) {
      await qualification.scoreSection(w.ctx, scheduled.id, section.code, PASSING[section.code]);
    }
    await qualification.raiseFinding(w.ctx, scheduled.id, {
      section: "quality_system",
      severity: "major",
      description: "Calibration records are not retained for the required period",
      capa: { action: "Introduce a calibration register", dueOn: addMonths(w.today, 2) },
    });
    const { outcome } = await qualification.complete(w.ctx, scheduled.id);
    assert.equal(outcome, "conditional", "an open major finding caps the audit at conditional");

    await suppliers.assignCategory(w.ctx, supplier.id, shortLived.id);
    await suppliers.approveCategory(w.ctx, supplier.id, shortLived.id);
    const conditional = await eligibility.assess(w.ctx, supplier.id, { categoryId: shortLived.id });
    assert.equal(conditional.eligible, true, "conditional qualifies, it just travels with a caveat");
    assert.ok(codes(conditional.warnings).includes("qualification_conditional"));

    w.clock.set("2026-08-01T00:00:00.000Z");
    await qualification.runComplianceSweep(w.ctx);
    const expired = await eligibility.assess(w.ctx, supplier.id, { categoryId: shortLived.id });
    assert.deepEqual(codes(expired.blockers), ["qualification_expired"]);
  });

  it("stops the award on a sourcing hold but ignores a payment hold", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id);
    const { eligibility, risk } = w.container.services;

    const payment = await risk.placeHold(w.ctx, supplier.id, {
      type: "payment",
      reasonCode: "unverified_bank_details",
    });
    assert.equal(
      (await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id })).eligible,
      true,
      "a payment hold is finance's problem, not sourcing's",
    );

    const sourcing = await risk.placeHold(w.ctx, supplier.id, {
      type: "sourcing",
      reasonCode: "litigation",
      scope: "categories",
      categoryIds: [category.id],
    });
    const blocked = await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(blocked.eligible, false);
    assert.deepEqual(codes(blocked.blockers), ["hold_active"]);
    assert.equal((blocked.blockers[0]?.detail as { holdId: string }).holdId, sourcing.id);

    await risk.releaseHold(w.ctx, supplier.id, sourcing.id, "Claim settled");
    await risk.releaseHold(w.ctx, supplier.id, payment.id, "Bank details verified");
    assert.equal((await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id })).eligible, true);
  });

  it("blocks a probation rating and only warns on a watch rating", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id);
    const { eligibility, performance, risk } = w.container.services;
    await performance.seedStandardKpis(w.ctx);

    const publish = async (periodCode: string, values: Record<string, number>) => {
      const scorecard = await performance.openScorecard(w.ctx, supplier.id, periodCode);
      for (const [kpiCode, value] of Object.entries(values)) {
        await performance.recordMeasurement(w.ctx, scorecard.id, { kpiCode, value });
      }
      return performance.publish(w.ctx, scorecard.id);
    };

    const bad = await publish("2026-Q1", {
      "on-time-delivery": 86,
      "quality-ppm": 9000,
      "price-variance": 6,
    });
    assert.equal(bad.rating, "probation");
    const onProbation = await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(onProbation.eligible, false);
    assert.ok(codes(onProbation.blockers).includes("rating_probation"));
    assert.ok(
      codes(onProbation.blockers).includes("hold_active"),
      "probation also enforces itself through a sourcing hold",
    );

    // A better quarter supersedes the last one: the assessment reads the newest.
    for (const hold of await risk.holds(w.ctx, supplier.id)) {
      if (hold.status === "active") await risk.releaseHold(w.ctx, supplier.id, hold.id, "Recovery plan agreed");
    }
    const better = await publish("2026-Q2", {
      "on-time-delivery": 92,
      "quality-ppm": 3000,
      "price-variance": 3,
    });
    assert.equal(better.rating, "watch");
    const onWatch = await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.equal(onWatch.eligible, true);
    assert.ok(codes(onWatch.warnings).includes("rating_watch"));
    assert.equal(
      (onWatch.warnings.find((issue) => issue.code === "rating_watch")?.detail as { periodCode: string }).periodCode,
      "2026-Q2",
    );
  });

  it("warns when the award would be a spot purchase or run past the contract", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id);
    await payable(w, supplier.id);
    const { eligibility } = w.container.services;

    const uncovered = await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.deepEqual(codes(uncovered.warnings), ["no_active_contract"]);
    assert.equal(uncovered.eligible, true, "spot buying is allowed, it is just worth knowing");

    await coverWithContract(w, supplier.id, [category.id], "2026-02-20" as DateOnly);
    const expiring = await eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.deepEqual(codes(expiring.warnings), ["contract_expiring"]);
    assert.match(expiring.warnings[0]?.message ?? "", /expires in 50 days/);
  });

  it("flags an unpayable supplier without stopping the award", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id);
    await coverWithContract(w, supplier.id, [category.id], "2027-12-31" as DateOnly);

    const unpayable = await w.container.services.eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.deepEqual(codes(unpayable.warnings), ["not_payable"]);
    assert.equal(unpayable.eligible, true);

    await payable(w, supplier.id);
    const settled = await w.container.services.eligibility.assess(w.ctx, supplier.id, { categoryId: category.id });
    assert.deepEqual(settled.warnings, []);
  });

  it("blocks a supplier with no site that can deliver", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { eligibility, supplier: suppliers } = w.container.services;
    const site = (await suppliers.get(w.ctx, supplier.id)).sites[0]!;

    await expectRejects(
      suppliers.deactivateSite(w.ctx, supplier.id, site.id, "Plant closed"),
      "INVALID_STATE",
      "last active site",
    );
    await suppliers.suspend(w.ctx, supplier.id, "Plant closure");
    await suppliers.deactivateSite(w.ctx, supplier.id, site.id, "Plant closed");

    const assessment = await eligibility.assess(w.ctx, supplier.id);
    assert.deepEqual(codes(assessment.blockers).sort(), ["no_operational_site", "supplier_not_active"]);
  });

  it("assesses without a category when the question is just 'can we trade at all'", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    await payable(w, supplier.id);
    const assessment = await w.container.services.eligibility.assess(w.ctx, supplier.id);
    assert.equal(assessment.eligible, true);
    assert.equal(assessment.categoryId, undefined);
    assert.deepEqual(codes(assessment.warnings), ["no_active_contract"], "no policy means no policy blockers");
  });

  it("answers as of a past date when a buyer backdates an award", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id, {
      certExpiresOn: "2026-06-30" as DateOnly,
    });
    const { eligibility } = w.container.services;

    const later = await eligibility.assess(w.ctx, supplier.id, {
      categoryId: category.id,
      asOf: "2026-06-01" as DateOnly,
    });
    assert.ok(has(later, "certification_expiring"), "the certificate is inside its window in June");
    const early = await eligibility.assess(w.ctx, supplier.id, {
      categoryId: category.id,
      asOf: "2026-01-15" as DateOnly,
    });
    assert.equal(has(early, "certification_expiring"), false, "in January it was nowhere near expiry");
  });
});

describe("category panel review", () => {
  it("assesses every supplier on the panel, eligible ones first", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const good = await panelSupplier(w, "GOOD-CO", category.id);
    const held = await panelSupplier(w, "HELD-CO", category.id);
    await activeSupplier(w, "OFF-PANEL-CO");
    const { eligibility, risk } = w.container.services;
    await risk.placeHold(w.ctx, held.id, { type: "sourcing", reasonCode: "quality_incident" });

    const panel = await eligibility.assessCategoryPanel(w.ctx, category.id);
    assert.deepEqual(
      panel.map((entry) => entry.supplierCode),
      ["GOOD-CO", "HELD-CO"],
      "off-panel suppliers are not assessed at all",
    );
    assert.deepEqual(
      panel.map((entry) => entry.eligible),
      [true, false],
    );

    const shortlist = await eligibility.assessCategoryPanel(w.ctx, category.id, { eligibleOnly: true });
    assert.deepEqual(
      shortlist.map((entry) => entry.supplierId),
      [good.id],
    );
  });
});

describe("supplier overview", () => {
  it("rolls the aggregates up into one panel a buyer can read", async () => {
    const w = world();
    const category = await regulatedCategory(w);
    const supplier = await panelSupplier(w, "ACME-PARTS", category.id, {
      certExpiresOn: "2026-02-20" as DateOnly,
    });
    const { eligibility, performance, qualification, risk } = w.container.services;
    await coverWithContract(w, supplier.id, [category.id], "2027-12-31" as DateOnly);
    await risk.raiseFlag(w.ctx, supplier.id, {
      category: "geopolitical",
      title: "Port congestion on the inbound lane",
      source: "news",
      likelihood: 3,
      impact: 3,
      detectedOn: w.today,
    });
    await performance.seedStandardKpis(w.ctx);
    const scorecard = await performance.openScorecard(w.ctx, supplier.id, "2026-Q1");
    for (const [kpiCode, value] of Object.entries({
      "on-time-delivery": 97,
      "quality-ppm": 800,
      "price-variance": 0.5,
    })) {
      await performance.recordMeasurement(w.ctx, scorecard.id, { kpiCode, value });
    }
    await performance.publish(w.ctx, scorecard.id);
    await qualification.schedule(w.ctx, {
      supplierId: supplier.id,
      type: "surveillance",
      method: "self_assessment",
      scheduledOn: addMonths(w.today, 6),
    });

    const overview = await eligibility.overview(w.ctx, supplier.id);
    assert.equal(overview.supplier.code, "ACME-PARTS");
    assert.equal(overview.riskTier, "medium");
    assert.equal(overview.riskScore, 32);
    assert.equal(overview.activeHolds, 0);
    assert.equal(overview.validCertifications, 3, "ISO 9001 plus the tax form and code of conduct from onboarding");
    assert.equal(overview.expiringCertifications, 1, "only the ISO certificate lapses inside the warning window");
    assert.equal(overview.activeContracts, 1);
    assert.equal(overview.openQualifications, 1, "the surveillance audit is still planned");
    assert.equal(overview.latestScorecard?.periodCode, "2026-Q1");
    assert.equal(overview.latestScorecard?.rating, "excellent");
  });
});
