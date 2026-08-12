import { createTenantContext, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { SrmContainer } from "./container.js";
import { addDays, addMonths, type DateOnly } from "../domain/dates.js";
import { periodContaining, previousPeriod } from "../domain/period.js";
import type { Supplier } from "../domain/supplier.js";

/**
 * Demo dataset: a small but complete SRM tenant — a category tree with real
 * sourcing policy, five suppliers at different stages of their lifecycle, a
 * qualification that passed and one that came back conditional, certificates
 * (one of them about to lapse), two contracts with service levels and price
 * tiers, and a published scorecard per active supplier.
 *
 * Every date is derived from the container's clock, so the fixture behaves
 * identically under the deterministic test clock and under a real one.
 */

export interface SeedResult {
  readonly ctx: TenantContext;
  readonly categories: Readonly<Record<string, Ulid>>;
  readonly suppliers: Readonly<Record<string, Supplier>>;
  readonly contracts: Readonly<Record<string, Ulid>>;
  readonly onboardingCaseId: Ulid;
}

export async function seedDemoData(container: SrmContainer, tenant = "demo"): Promise<SeedResult> {
  const ctx = createTenantContext(tenant, "seed-bot", [
    "srm.admin",
    "srm.compliance",
    "srm.quality",
    "srm.category-manager",
  ]);
  const { services } = container;
  const today = container.clock.today();

  // --- category tree with inherited sourcing policy -------------------------

  const direct = await services.category.create(ctx, {
    code: "direct",
    name: "Direct materials",
    riskTier: "high",
    requiresQualification: true,
    requiredCertifications: ["iso9001"],
    requalificationMonths: 24,
  });
  const electronics = await services.category.create(ctx, {
    code: "electronics",
    name: "Electronic components",
    parentId: direct.id,
    riskTier: "critical",
    requiredCertifications: ["iso14001"],
    requalificationMonths: 12,
  });
  const metals = await services.category.create(ctx, {
    code: "metals",
    name: "Metals & alloys",
    parentId: direct.id,
    riskTier: "high",
  });
  const indirect = await services.category.create(ctx, {
    code: "indirect",
    name: "Indirect spend",
    riskTier: "low",
  });
  const itServices = await services.category.create(ctx, {
    code: "it-services",
    name: "IT services",
    parentId: indirect.id,
    riskTier: "high",
    requiresQualification: true,
    requiredCertifications: ["iso27001", "soc2_type2"],
    requalificationMonths: 12,
  });
  const facilities = await services.category.create(ctx, {
    code: "facilities",
    name: "Facilities",
    parentId: indirect.id,
    riskTier: "low",
  });

  await services.performance.seedStandardKpis(ctx);

  // --- suppliers ------------------------------------------------------------

  const nordic = await registerTradingSupplier(container, ctx, {
    code: "NORDIC-STEEL",
    legalName: "Nordic Steel Works AB",
    tradeName: "Nordic Steel",
    countryCode: "SE",
    taxId: "SE556677889901",
    currency: "EUR",
    paymentTermsCode: "NET45",
    siteCode: "NS-MALMO",
    siteName: "Malmö rolling mill",
    siteType: "manufacturing",
    city: "Malmö",
    capabilities: ["hot-rolling", "cold-rolling", "galvanising"],
    contactName: "Ingrid Lund",
    contactEmail: "ingrid.lund@nordicsteel.example",
    tags: ["eu", "long-term"],
  });

  const shenzhen = await registerTradingSupplier(container, ctx, {
    code: "SHENZHEN-CIRCUITS",
    legalName: "Shenzhen Precision Circuits Co., Ltd",
    tradeName: "SZ Circuits",
    countryCode: "CN",
    taxId: "CN91440300MA5F",
    currency: "USD",
    paymentTermsCode: "2_10_NET30",
    siteCode: "SZC-BAOAN",
    siteName: "Bao'an SMT plant",
    siteType: "manufacturing",
    city: "Shenzhen",
    capabilities: ["smt", "conformal-coating", "ict-test"],
    contactName: "Wei Zhang",
    contactEmail: "wei.zhang@szcircuits.example",
    tags: ["apac", "single-source"],
  });

  const facilitiesSupplier = await registerTradingSupplier(container, ctx, {
    code: "ACME-FACILITIES",
    legalName: "Acme Facilities Services LLC",
    countryCode: "US",
    taxId: "US47-1234567",
    currency: "USD",
    paymentTermsCode: "NET30",
    siteCode: "ACME-CHI",
    siteName: "Chicago service hub",
    siteType: "service",
    city: "Chicago",
    capabilities: ["cleaning", "hvac-maintenance"],
    contactName: "Dana Reyes",
    contactEmail: "dana.reyes@acmefacilities.example",
    tags: ["us", "tail-spend"],
  });

  const brightPack = await services.supplier.register(ctx, {
    code: "BRIGHT-PACK",
    legalName: "Bright Packaging Solutions Ltd",
    countryCode: "GB",
    defaultCurrency: "GBP",
    tags: ["prospect"],
  });

  // --- certifications -------------------------------------------------------

  await recordVerifiedCertification(container, ctx, nordic.id, nordic.code, "iso9001", "DNV", "DNV-9001-77812", addMonths(today, 18));
  await recordVerifiedCertification(container, ctx, shenzhen.id, shenzhen.code, "iso9001", "SGS", "SGS-9001-40122", addMonths(today, 9));
  // Deliberately close to expiry so the compliance sweep has something to warn about.
  await recordVerifiedCertification(container, ctx, shenzhen.id, shenzhen.code, "iso14001", "SGS", "SGS-14001-40123", addDays(today, 45));

  // --- qualifications -------------------------------------------------------

  const nordicAudit = await services.qualification.schedule(ctx, {
    supplierId: nordic.id,
    categoryId: metals.id,
    type: "initial",
    method: "onsite_audit",
    scheduledOn: addDays(today, -30),
  });
  await services.qualification.start(ctx, nordicAudit.id);
  for (const [section, score] of [
    ["quality_system", 92],
    ["manufacturing_capability", 88],
    ["delivery_performance", 85],
    ["financial_health", 90],
    ["esg_compliance", 78],
    ["information_security", 70],
    ["capacity_scalability", 82],
  ] as const) {
    await services.qualification.scoreSection(ctx, nordicAudit.id, section, score);
  }
  await services.qualification.complete(ctx, nordicAudit.id, "Mature quality system, no significant findings");

  const shenzhenAudit = await services.qualification.schedule(ctx, {
    supplierId: shenzhen.id,
    categoryId: electronics.id,
    type: "initial",
    method: "virtual_audit",
    scheduledOn: addDays(today, -21),
  });
  await services.qualification.start(ctx, shenzhenAudit.id);
  for (const [section, score] of [
    ["quality_system", 84],
    ["manufacturing_capability", 86],
    ["delivery_performance", 74],
    ["financial_health", 72],
    ["esg_compliance", 62],
    ["information_security", 68],
    ["capacity_scalability", 80],
  ] as const) {
    await services.qualification.scoreSection(ctx, shenzhenAudit.id, section, score);
  }
  await services.qualification.raiseFinding(ctx, shenzhenAudit.id, {
    section: "esg_compliance",
    severity: "major",
    description: "Working-hour records incomplete for the SMT night shift",
    capa: { action: "Deploy time-tracking and provide three months of records", dueOn: addMonths(today, 3) },
  });
  await services.qualification.complete(ctx, shenzhenAudit.id, "Capable supplier; ESG record-keeping needs work");

  // --- category panel -------------------------------------------------------

  await services.supplier.assignCategory(ctx, nordic.id, metals.id, "Primary steel source for EU plants");
  await services.supplier.approveCategory(ctx, nordic.id, metals.id);
  await services.supplier.assignCategory(ctx, shenzhen.id, electronics.id, "PCBA for the controller family");
  await services.supplier.approveCategory(ctx, shenzhen.id, electronics.id);
  await services.supplier.assignCategory(ctx, facilitiesSupplier.id, facilities.id);
  await services.supplier.approveCategory(ctx, facilitiesSupplier.id, facilities.id);
  await services.supplier.classify(ctx, nordic.id, "strategic", "Sole EU source of galvanised coil");
  await services.supplier.classify(ctx, shenzhen.id, "preferred", "Cost leader, watch the ESG findings");
  await services.supplier.classify(ctx, facilitiesSupplier.id, "tail");

  // --- contracts ------------------------------------------------------------

  const nordicContract = await services.contract.draft(ctx, {
    supplierId: nordic.id,
    type: "framework",
    title: "Framework supply agreement — galvanised coil",
    effectiveFrom: addMonths(today, -6),
    effectiveTo: addMonths(today, 18),
    autoRenew: true,
    renewalTermMonths: 12,
    noticeDays: 60,
    categoryIds: [metals.id],
    minimumCommitmentMinor: 250_000_00,
  });
  const nordicBuyer = await services.contract.addSignatory(ctx, nordicContract.id, {
    party: "buyer",
    name: "P. Okafor",
    title: "Category manager",
  });
  const nordicSupplierSignatory = await services.contract.addSignatory(ctx, nordicContract.id, {
    party: "supplier",
    name: "I. Lund",
    title: "Sales director",
  });
  await services.contract.addPriceLine(ctx, nordicContract.id, {
    itemCode: "COIL-GALV-1.5",
    description: "Galvanised coil 1.5mm",
    uom: "KG",
    unitPriceMinor: 142,
    minQuantity: 1,
    validFrom: addMonths(today, -6),
  });
  await services.contract.addPriceLine(ctx, nordicContract.id, {
    itemCode: "COIL-GALV-1.5",
    description: "Galvanised coil 1.5mm — volume tier",
    uom: "KG",
    unitPriceMinor: 129,
    minQuantity: 20_000,
    validFrom: addMonths(today, -6),
  });
  await services.contract.addCommitment(ctx, nordicContract.id, {
    metric: "on_time_delivery",
    target: 96,
    tolerance: 1,
    window: "quarterly",
    graceBreaches: 1,
    penalty: { kind: "service_credit_percent", percent: 2 },
    creditCapPercent: 10,
    escalations: [
      { afterBreaches: 2, action: "Quarterly business review with the supplier's COO" },
      { afterBreaches: 3, action: "Dual-source the affected items" },
    ],
  });
  await services.contract.sendForSignature(ctx, nordicContract.id);
  await services.contract.sign(ctx, nordicContract.id, nordicBuyer.id);
  await services.contract.sign(ctx, nordicContract.id, nordicSupplierSignatory.id);
  await services.contract.activate(ctx, nordicContract.id);

  const shenzhenContract = await services.contract.draft(ctx, {
    supplierId: shenzhen.id,
    type: "pricing_agreement",
    title: "PCBA pricing agreement 2026",
    effectiveFrom: addMonths(today, -3),
    effectiveTo: addMonths(today, 9),
    noticeDays: 30,
    categoryIds: [electronics.id],
  });
  const szBuyer = await services.contract.addSignatory(ctx, shenzhenContract.id, { party: "buyer", name: "P. Okafor" });
  const szSupplier = await services.contract.addSignatory(ctx, shenzhenContract.id, { party: "supplier", name: "W. Zhang" });
  await services.contract.addPriceLine(ctx, shenzhenContract.id, {
    itemCode: "PCBA-CTRL-A",
    description: "Controller board assembly rev A",
    uom: "EA",
    unitPriceMinor: 18_40,
    minQuantity: 1,
    validFrom: addMonths(today, -3),
  });
  await services.contract.addPriceLine(ctx, shenzhenContract.id, {
    itemCode: "PCBA-CTRL-A",
    description: "Controller board assembly rev A — 5k tier",
    uom: "EA",
    unitPriceMinor: 16_75,
    minQuantity: 5_000,
    validFrom: addMonths(today, -3),
  });
  await services.contract.addCommitment(ctx, shenzhenContract.id, {
    metric: "quality_ppm",
    target: 800,
    tolerance: 200,
    window: "quarterly",
    penalty: { kind: "service_credit_percent", percent: 3 },
    creditCapPercent: 15,
  });
  await services.contract.sendForSignature(ctx, shenzhenContract.id);
  await services.contract.sign(ctx, shenzhenContract.id, szBuyer.id);
  await services.contract.sign(ctx, shenzhenContract.id, szSupplier.id);
  await services.contract.activate(ctx, shenzhenContract.id);

  // --- performance ----------------------------------------------------------

  const lastQuarter = previousPeriod(periodContaining(today, "quarter"));
  await publishScorecard(container, ctx, nordic.id, lastQuarter.code, {
    "on-time-delivery": 97.2,
    "quality-ppm": 420,
    "price-variance": 0.8,
    "fill-rate": 98.5,
    "invoice-accuracy": 99.4,
  });
  await publishScorecard(container, ctx, shenzhen.id, lastQuarter.code, {
    "on-time-delivery": 91.4,
    "quality-ppm": 1_450,
    "price-variance": 1.9,
    "fill-rate": 95.2,
    "esg-rating": 48,
  });

  // --- risk -----------------------------------------------------------------

  await services.risk.raiseFlag(ctx, shenzhen.id, {
    category: "geopolitical",
    title: "Single-source exposure in a tariff-sensitive region",
    description: "No qualified alternative for the controller board assembly",
    source: "internal",
    likelihood: 3,
    impact: 4,
    detectedOn: addDays(today, -14),
    reviewDueOn: addMonths(today, 3),
  });

  // --- onboarding in flight -------------------------------------------------

  const cloudops = await services.supplier.register(ctx, {
    code: "CLOUDOPS-LTD",
    legalName: "CloudOps Managed Services Ltd",
    countryCode: "IE",
    taxId: "IE9876543X",
    defaultCurrency: "EUR",
    tags: ["it", "data-processor"],
  });
  await services.supplier.addSite(ctx, cloudops.id, {
    code: "CO-DUB",
    name: "Dublin operations centre",
    type: "service",
    address: { line1: "12 Grand Canal Quay", city: "Dublin", countryCode: "IE" },
    capabilities: ["managed-hosting", "24x7-noc"],
  });
  await services.supplier.addContact(ctx, cloudops.id, {
    name: "Aoife Byrne",
    email: "aoife.byrne@cloudops.example",
    role: "primary",
  });
  const onboarding = await services.onboarding.start(ctx, {
    supplierId: cloudops.id,
    templateCode: "critical-service",
    targetGoLiveOn: addMonths(today, 2),
  });
  await services.onboarding.completeStep(ctx, onboarding.id, "legal-entity", "companies-registry-check.pdf");
  await services.onboarding.receiveDocument(ctx, onboarding.id, "tax-form", "cloudops-tax.pdf");
  await services.onboarding.verifyDocument(ctx, onboarding.id, "tax-form");
  await services.onboarding.completeStep(ctx, onboarding.id, "tax-forms");
  for (const [code, value, riskFactor] of [
    ["financial-stability", "Audited, profitable, 8 years trading", 0.2],
    ["subcontracting", "20% of NOC staffing subcontracted", 0.4],
    ["single-source", "Yes for the hosting platform", 0.8],
    ["data-access", "Processes customer personal data", 0.9],
    ["labour-practices", "Self-assessment complete, no issues", 0.2],
    ["geo-exposure", "EU only", 0.1],
  ] as const) {
    await services.onboarding.answerQuestion(ctx, onboarding.id, { code, value, riskFactor });
  }

  return {
    ctx,
    categories: {
      direct: direct.id,
      electronics: electronics.id,
      metals: metals.id,
      indirect: indirect.id,
      "it-services": itServices.id,
      facilities: facilities.id,
    },
    suppliers: {
      [nordic.code]: nordic,
      [shenzhen.code]: shenzhen,
      [facilitiesSupplier.code]: facilitiesSupplier,
      [brightPack.code]: brightPack,
      [cloudops.code]: cloudops,
    },
    contracts: { nordic: nordicContract.id, shenzhen: shenzhenContract.id },
    onboardingCaseId: onboarding.id,
  };
}

interface TradingSupplierInput {
  readonly code: string;
  readonly legalName: string;
  readonly tradeName?: string;
  readonly countryCode: string;
  readonly taxId: string;
  readonly currency: string;
  readonly paymentTermsCode: string;
  readonly siteCode: string;
  readonly siteName: string;
  readonly siteType: "manufacturing" | "service" | "warehouse" | "distribution";
  readonly city: string;
  readonly capabilities: readonly string[];
  readonly contactName: string;
  readonly contactEmail: string;
  readonly tags: readonly string[];
}

/** Registers a supplier and walks it all the way to `active`. */
async function registerTradingSupplier(
  container: SrmContainer,
  ctx: TenantContext,
  input: TradingSupplierInput,
): Promise<Supplier> {
  const { services } = container;
  const supplier = await services.supplier.register(ctx, {
    code: input.code,
    legalName: input.legalName,
    tradeName: input.tradeName,
    countryCode: input.countryCode,
    taxId: input.taxId,
    defaultCurrency: input.currency,
    paymentTermsCode: input.paymentTermsCode,
    tags: input.tags,
  });
  await services.supplier.addSite(ctx, supplier.id, {
    code: input.siteCode,
    name: input.siteName,
    type: input.siteType,
    address: { line1: "1 Industrial Way", city: input.city, countryCode: input.countryCode },
    capabilities: input.capabilities,
    leadTimeDays: 21,
  });
  await services.supplier.addContact(ctx, supplier.id, {
    name: input.contactName,
    email: input.contactEmail,
    role: "primary",
  });
  await services.supplier.addBankAccount(ctx, supplier.id, {
    label: "Operating account",
    bankName: "Nordea",
    countryCode: input.countryCode,
    currency: input.currency,
    accountNumber: `${input.code.replace(/[^0-9A-Z]/g, "")}00112233`,
  });
  const withBank = await services.supplier.get(ctx, supplier.id);
  await services.supplier.verifyBankAccount(ctx, supplier.id, withBank.bankAccounts[0]!.id);
  const onboardingCase = await container.services.onboarding.start(ctx, {
    supplierId: supplier.id,
    templateCode: "indirect-low-risk",
  });
  await fastTrackOnboarding(container, ctx, onboardingCase.id);
  return services.supplier.get(ctx, supplier.id);
}

/** Runs a low-risk case end to end: evidence, questionnaire, approval. */
async function fastTrackOnboarding(container: SrmContainer, ctx: TenantContext, caseId: Ulid): Promise<void> {
  const { services } = container;
  const approverCtx: TenantContext = { ...ctx, userId: createTenantContext(ctx.tenantId, "approver-1").userId };
  await services.onboarding.completeStep(ctx, caseId, "legal-entity", "registry-extract.pdf");
  for (const code of ["tax-form", "coc"]) {
    await services.onboarding.receiveDocument(ctx, caseId, code, `${code}.pdf`);
    await services.onboarding.verifyDocument(ctx, caseId, code);
  }
  await services.onboarding.completeStep(ctx, caseId, "tax-forms");
  for (const [code, value, riskFactor] of [
    ["financial-stability", "Audited financials provided", 0.1],
    ["subcontracting", "None", 0.1],
    ["single-source", "No", 0.1],
    ["data-access", "No personal data", 0.1],
    ["labour-practices", "Self-assessment complete", 0.1],
    ["geo-exposure", "Low-risk jurisdiction", 0.1],
  ] as const) {
    await services.onboarding.answerQuestion(ctx, caseId, { code, value, riskFactor });
  }
  await services.onboarding.completeStep(ctx, caseId, "risk-questionnaire");
  await services.onboarding.completeStep(ctx, caseId, "bank-verification", "penny-test-passed");
  await services.onboarding.completeStep(ctx, caseId, "code-of-conduct");
  await services.onboarding.submit(ctx, caseId);
  await services.onboarding.decide(approverCtx, caseId, "procurement", "approved", "Standard low-risk supplier");
}

async function recordVerifiedCertification(
  container: SrmContainer,
  ctx: TenantContext,
  supplierId: Ulid,
  supplierCode: string,
  type: "iso9001" | "iso14001" | "iso27001" | "soc2_type2",
  issuer: string,
  certificateNumber: string,
  expiresOn: DateOnly,
): Promise<void> {
  const certification = await container.services.qualification.recordCertification(ctx, {
    supplierId,
    type,
    issuer,
    certificateNumber,
    issuedOn: addMonths(container.clock.today(), -12),
    expiresOn,
    scope: `${supplierCode} manufacturing operations`,
  });
  await container.services.qualification.verifyCertification(ctx, certification.id);
}

async function publishScorecard(
  container: SrmContainer,
  ctx: TenantContext,
  supplierId: Ulid,
  periodCode: string,
  measurements: Readonly<Record<string, number>>,
): Promise<void> {
  const scorecard = await container.services.performance.openScorecard(ctx, supplierId, periodCode);
  for (const [kpiCode, value] of Object.entries(measurements)) {
    await container.services.performance.recordMeasurement(ctx, scorecard.id, { kpiCode, value });
  }
  await container.services.performance.submitForReview(ctx, scorecard.id, "Quarterly business review pack");
  await container.services.performance.publish(ctx, scorecard.id);
}
