import {
  createTenantContext,
  money,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { addDays, addMonths, fiscalPeriod } from "../domain/dates.js";
import type { PrmContainer } from "./container.js";

/**
 * Demo fixture: a small channel program with one distributor, a tier-2 VAR
 * that has been through onboarding, training and an MDF campaign, a referral
 * partner, and an applicant still in review.
 *
 * Everything runs through the application services, so seeding exercises the
 * same invariants as the API: contracts are signed by two parties before a
 * partner can go live, certifications are only awarded after courses are
 * passed, and MDF money is committed and settled through the budget ledger.
 */

export interface SeedResult {
  readonly ctx: TenantContext;
  readonly partners: Readonly<Record<string, Ulid>>;
  readonly contracts: Readonly<Record<string, Ulid>>;
  readonly portalUsers: Readonly<Record<string, Ulid>>;
  readonly budgetId: Ulid;
  readonly paidClaimId: Ulid;
  readonly pendingRequestId: Ulid;
  readonly period: string;
}

/** Fiscal quarter label containing `at`, e.g. `FY26-Q3`. */
function periodCodeFor(at: IsoDateTime): string {
  const date = new Date(Date.parse(at));
  const year = String(date.getUTCFullYear() - 2000).padStart(2, "0");
  return `FY${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** The four quarters of the fiscal year before the one containing `at`. */
function priorYearQuarters(at: IsoDateTime): string[] {
  const year = String(new Date(Date.parse(at)).getUTCFullYear() - 1 - 2000).padStart(2, "0");
  return [1, 2, 3, 4].map((q) => `FY${year}-Q${q}`);
}

export async function seedDemoData(container: PrmContainer, tenant = "demo"): Promise<SeedResult> {
  const { services, clock } = container;
  const ctx = createTenantContext(tenant, "seed-bot", ["prm.admin"]);
  const channelManager = createTenantContext(tenant, "channel-manager", ["prm.channel_manager"]);
  const now = clock.now();

  // --- program configuration -------------------------------------------------
  await services.tier.installStandardProgram(ctx);
  await services.entitlement.installStandardCatalog(ctx);

  await services.training.createCourse(ctx, {
    code: "sales-foundations",
    title: "Selling the platform",
    track: "sales",
    deliveryMode: "self_paced",
    durationMinutes: 180,
    passingScore: 70,
  });
  await services.training.createCourse(ctx, {
    code: "sales-advanced",
    title: "Competitive selling and value engineering",
    track: "sales",
    deliveryMode: "virtual_classroom",
    durationMinutes: 480,
    passingScore: 75,
    prerequisiteCourseCodes: ["sales-foundations"],
  });
  await services.training.createCourse(ctx, {
    code: "tech-foundations",
    title: "Platform architecture essentials",
    track: "technical",
    deliveryMode: "self_paced",
    durationMinutes: 240,
    passingScore: 70,
  });
  await services.training.createCourse(ctx, {
    code: "tech-advanced",
    title: "Deployment and integration lab",
    track: "technical",
    deliveryMode: "lab",
    durationMinutes: 960,
    passingScore: 80,
    prerequisiteCourseCodes: ["tech-foundations"],
  });
  await services.training.createCourse(ctx, {
    code: "tech-architecture",
    title: "Reference architecture design",
    track: "technical",
    deliveryMode: "in_person",
    durationMinutes: 1440,
    passingScore: 85,
    prerequisiteCourseCodes: ["tech-advanced"],
  });

  await services.training.createCertificationDefinition(ctx, {
    code: "sales-pro",
    name: "Certified Sales Professional",
    track: "sales",
    level: "professional",
    requiredCourseCodes: ["sales-foundations", "sales-advanced"],
    renewalCourseCodes: ["sales-advanced"],
    validityMonths: 24,
  });
  await services.training.createCertificationDefinition(ctx, {
    code: "tech-pro",
    name: "Certified Technical Professional",
    track: "technical",
    level: "professional",
    requiredCourseCodes: ["tech-foundations", "tech-advanced"],
    renewalCourseCodes: ["tech-advanced"],
    validityMonths: 24,
  });
  await services.training.createCertificationDefinition(ctx, {
    code: "tech-expert",
    name: "Certified Solution Architect",
    track: "technical",
    level: "expert",
    requiredCourseCodes: ["tech-advanced", "tech-architecture"],
    validityMonths: 36,
  });

  // --- partners --------------------------------------------------------------
  const northwind = await services.partner.register(ctx, {
    legalName: "Northwind Distribution GmbH",
    displayName: "Northwind",
    type: "distributor",
    countryCode: "DE",
    currency: "USD",
    websiteUrl: "https://northwind.example",
    territories: ["DE", "AT", "CH"],
    specializations: ["logistics", "public_sector"],
    channelManagerId: channelManager.userId,
  });
  const contoso = await services.partner.register(ctx, {
    legalName: "Contoso Solutions Ltd",
    displayName: "Contoso",
    type: "var",
    countryCode: "GB",
    currency: "USD",
    parentPartnerId: northwind.id,
    websiteUrl: "https://contoso.example",
    territories: ["GB", "IE"],
    specializations: ["manufacturing", "analytics"],
    channelManagerId: channelManager.userId,
  });
  const tailspin = await services.partner.register(ctx, {
    legalName: "Tailspin Referrals LLC",
    type: "referral",
    countryCode: "US",
    currency: "USD",
    territories: ["US-WEST"],
  });
  const fabrikam = await services.partner.register(ctx, {
    legalName: "Fabrikam Systems Inc",
    type: "systems_integrator",
    countryCode: "US",
    currency: "USD",
    territories: ["US-EAST"],
  });

  const onboard = async (
    partnerId: Ulid,
    contact: { first: string; last: string; email: string },
    address: { line1: string; city: string; postalCode: string; countryCode: string },
  ) => {
    await services.partner.addAddress(ctx, partnerId, { kind: "headquarters", ...address });
    await services.partner.addContact(ctx, partnerId, {
      firstName: contact.first,
      lastName: contact.last,
      email: contact.email,
      role: "primary",
      jobTitle: "Alliance Director",
    });
    await services.partner.submitApplication(ctx, partnerId);
    await services.partner.startReview(channelManager, partnerId);
  };

  await onboard(
    northwind.id,
    { first: "Nadia", last: "Braun", email: "nadia@northwind.example" },
    { line1: "Hafenstrasse 12", city: "Hamburg", postalCode: "20457", countryCode: "DE" },
  );
  await onboard(
    contoso.id,
    { first: "Ada", last: "Nkemelu", email: "ada@contoso.example" },
    { line1: "1 Channel Way", city: "Reading", postalCode: "RG1 1AA", countryCode: "GB" },
  );
  await onboard(
    tailspin.id,
    { first: "Tom", last: "Rivera", email: "tom@tailspin.example" },
    { line1: "500 Mission St", city: "San Francisco", postalCode: "94105", countryCode: "US" },
  );
  await onboard(
    fabrikam.id,
    { first: "Faye", last: "Oyelaran", email: "faye@fabrikam.example" },
    { line1: "77 Beacon St", city: "Boston", postalCode: "02108", countryCode: "US" },
  );

  await services.partner.approve(channelManager, northwind.id, "Strategic distributor for DACH");
  await services.partner.approve(channelManager, contoso.id, "Strong analytics practice");
  await services.partner.approve(channelManager, tailspin.id, "Referral-only agreement");
  // Fabrikam stays in review so the demo has a live application in the pipeline.

  // --- contracts -------------------------------------------------------------
  const twoYearTerm = { effectiveFrom: now, effectiveTo: addMonths(now, 24) };

  const signAndActivate = async (contractId: Ulid, partnerSignatory: { name: string; email: string }) => {
    await services.contract.sendForSignature(ctx, contractId);
    await services.contract.sign(ctx, contractId, {
      party: "partner",
      signatoryName: partnerSignatory.name,
      signatoryEmail: partnerSignatory.email,
      signatoryTitle: "Managing Director",
    });
    await services.contract.sign(channelManager, contractId, {
      party: "vendor",
      signatoryName: "Vendor Channel Chief",
      signatoryEmail: "channel-chief@vendor.example",
      signatoryTitle: "VP Channels",
    });
    return services.contract.activate(channelManager, contractId);
  };

  const northwindContract = await services.contract.draft(ctx, {
    partnerId: northwind.id,
    type: "distribution",
    title: "DACH distribution agreement",
    currency: "USD",
    ...twoYearTerm,
    autoRenew: true,
    renewalTermMonths: 12,
    noticeDays: 90,
    baseDiscountBps: 2000,
    mdfEligible: true,
    mdfAccrualBps: 200,
    revenueCommitment: money(200_000_00, "USD"),
    governingLaw: "Germany",
  });
  await services.contract.addDiscountLine(ctx, northwindContract.id, {
    scope: "*",
    discountBps: 2000,
    note: "Standard distribution discount",
  });
  await services.contract.addDiscountLine(ctx, northwindContract.id, {
    scope: "support-services",
    discountBps: 1000,
    note: "Services resold at half the product discount",
  });
  await services.contract.addObligation(ctx, northwindContract.id, {
    code: "quarterly-forecast",
    description: "Submit a rolling 90-day forecast every quarter",
    dueAt: addMonths(now, 3),
  });
  await signAndActivate(northwindContract.id, { name: "Nadia Braun", email: "nadia@northwind.example" });

  const contosoContract = await services.contract.draft(ctx, {
    partnerId: contoso.id,
    type: "reseller",
    title: "UK & Ireland reseller agreement",
    currency: "USD",
    ...twoYearTerm,
    autoRenew: true,
    renewalTermMonths: 12,
    baseDiscountBps: 1500,
    mdfEligible: true,
    mdfAccrualBps: 200,
    paymentTermsDays: 45,
  });
  await services.contract.addDiscountLine(ctx, contosoContract.id, { scope: "*", discountBps: 1500 });
  await services.contract.addDiscountLine(ctx, contosoContract.id, {
    scope: "analytics-suite",
    discountBps: 2200,
    minAnnualVolume: money(50_000_00, "USD"),
    note: "Practice-aligned uplift",
  });
  await signAndActivate(contosoContract.id, { name: "Ada Nkemelu", email: "ada@contoso.example" });

  const tailspinContract = await services.contract.draft(ctx, {
    partnerId: tailspin.id,
    type: "referral",
    title: "Referral agreement",
    currency: "USD",
    ...twoYearTerm,
    baseDiscountBps: 0,
  });
  await services.contract.updateTerms(ctx, tailspinContract.id, { baseDiscountBps: 500 });
  await signAndActivate(tailspinContract.id, { name: "Tom Rivera", email: "tom@tailspin.example" });

  await services.partner.activate(channelManager, northwind.id);
  await services.partner.activate(channelManager, contoso.id);
  await services.partner.activate(channelManager, tailspin.id);

  // --- performance history ---------------------------------------------------
  const quarters = priorYearQuarters(now);
  const contosoRevenue = [40_000_00, 62_000_00, 71_000_00, 95_000_00];
  for (const [index, period] of quarters.entries()) {
    await services.partner.recordPerformance(ctx, contoso.id, {
      period,
      bookedRevenue: money(contosoRevenue[index]!, "USD"),
      dealsRegistered: 6 + index,
      dealsWon: 3 + index,
      newLogos: 1 + index,
      source: "sales_erp",
    });
    await services.partner.recordPerformance(ctx, northwind.id, {
      period,
      bookedRevenue: money(120_000_00 + index * 15_000_00, "USD"),
      dealsRegistered: 20 + index * 2,
      dealsWon: 11 + index,
      newLogos: 4,
      source: "sales_erp",
    });
  }

  // --- portal users ----------------------------------------------------------
  const invite = async (
    partnerId: Ulid,
    input: { first: string; last: string; email: string; roles: Parameters<typeof services.portal.invite>[1]["roles"] },
  ) => {
    const user = await services.portal.invite(ctx, {
      partnerId,
      email: input.email,
      firstName: input.first,
      lastName: input.last,
      roles: input.roles,
      jobTitle: "Partner staff",
    });
    await services.portal.acceptInvite(ctx, user.id);
    return user;
  };

  const ada = await invite(contoso.id, {
    first: "Ada",
    last: "Nkemelu",
    email: "ada@contoso.example",
    roles: ["portal_admin", "marketing_manager"],
  });
  const sam = await invite(contoso.id, {
    first: "Sam",
    last: "Okafor",
    email: "sam@contoso.example",
    roles: ["sales_rep"],
  });
  const tara = await invite(contoso.id, {
    first: "Tara",
    last: "Lindqvist",
    email: "tara@contoso.example",
    roles: ["technical_lead", "support_agent"],
  });
  const nadia = await invite(northwind.id, {
    first: "Nadia",
    last: "Braun",
    email: "nadia@northwind.example",
    roles: ["portal_admin", "sales_rep"],
  });
  // Invited but not yet accepted: shows the pending-invite state in the portal.
  const pendingUser = await services.portal.invite(ctx, {
    partnerId: contoso.id,
    email: "new-hire@contoso.example",
    firstName: "Noor",
    lastName: "Haddad",
    roles: ["sales_rep"],
  });

  // --- enablement ------------------------------------------------------------
  const completeCourse = async (portalUserId: Ulid, courseCode: string, score: number) => {
    const enrollment = await services.training.enroll(ctx, { portalUserId, courseCode });
    await services.training.startEnrollment(ctx, enrollment.id);
    await services.training.recordAttempt(ctx, enrollment.id, { score, proctored: true });
    return enrollment;
  };

  for (const user of [ada.id, sam.id, nadia.id]) {
    await completeCourse(user, "sales-foundations", 88);
    await completeCourse(user, "sales-advanced", 82);
    await services.training.award(ctx, { portalUserId: user, certificationCode: "sales-pro" });
  }
  await completeCourse(tara.id, "tech-foundations", 91);
  await completeCourse(tara.id, "tech-advanced", 86);
  await services.training.award(ctx, { portalUserId: tara.id, certificationCode: "tech-pro" });

  // Sam's first attempt at the technical track failed; the retry is pending.
  const samTech = await services.training.enroll(ctx, {
    portalUserId: sam.id,
    courseCode: "tech-foundations",
  });
  await services.training.startEnrollment(ctx, samTech.id);
  await services.training.recordAttempt(ctx, samTech.id, { score: 54 });

  // --- tiering ---------------------------------------------------------------
  // At program launch nobody has tenure yet, so the earned tier is "registered"
  // and the strategic accounts are migrated in with a recorded override.
  await services.tier.autoAssign(channelManager, tailspin.id);
  await services.tier.assign(channelManager, contoso.id, {
    tierCode: "gold",
    reason: "Program launch migration: legacy Gold status and 2025 revenue carried over",
    override: true,
  });
  await services.tier.assign(channelManager, northwind.id, {
    tierCode: "platinum",
    reason: "Program launch migration: sole DACH distributor, contractual tier commitment",
    override: true,
  });

  // --- MDF -------------------------------------------------------------------
  const period = periodCodeFor(now);
  const quarter = fiscalPeriod(period);
  const budget = await services.mdfBudget.create(ctx, {
    code: `MDF-${period}`,
    name: `Channel marketing fund ${period}`,
    period,
    total: money(500_000_00, "USD"),
    claimWindowDays: 60,
    matchingRateBps: 5000,
  });
  await services.mdfBudget.open(ctx, budget.id);
  await services.mdfBudget.allocate(ctx, budget.id, {
    partnerId: contoso.id,
    amount: money(200_000_00, "USD"),
    note: "Analytics practice demand generation",
  });
  await services.mdfBudget.allocate(ctx, budget.id, {
    partnerId: northwind.id,
    amount: money(150_000_00, "USD"),
    note: "DACH distribution enablement",
  });

  const partnerCtx = createTenantContext(tenant, "ada@contoso.example", ["partner.portal_admin"]);
  const campaign = await services.mdf.createRequest(partnerCtx, {
    partnerId: contoso.id,
    budgetId: budget.id,
    activityType: "digital_campaign",
    title: "Manufacturing analytics webinar series",
    description: "Three-part webinar series with paid social promotion across UK and IE.",
    activityStart: quarter.start,
    activityEnd: addDays(quarter.start, 21),
    requestedAmount: money(40_000_00, "USD"),
    expectedLeads: 120,
    expectedPipeline: money(400_000_00, "USD"),
  });
  await services.mdf.submitRequest(partnerCtx, campaign.id);
  await services.mdf.approveRequest(channelManager, campaign.id, {
    approvedAmount: money(35_000_00, "USD"),
    notes: "Approved without the paid-social overspend; social budget capped at 5k.",
  });

  const claim = await services.mdf.createClaim(partnerCtx, {
    requestId: campaign.id,
    claimedAmount: money(32_000_00, "USD"),
    activitySummary: "Three webinars delivered, 143 registrations, 96 attendees.",
    actualLeads: 96,
    actualPipeline: money(510_000_00, "USD"),
  });
  await services.mdf.addProof(partnerCtx, claim.id, {
    kind: "invoice",
    reference: "AGENCY-2026-0114",
    amount: money(28_000_00, "USD"),
    documentUrl: "https://files.example/invoices/agency-2026-0114.pdf",
  });
  await services.mdf.addProof(partnerCtx, claim.id, {
    kind: "receipt",
    reference: "SOCIAL-ADS-Q1",
    amount: money(5_000_00, "USD"),
  });
  await services.mdf.addProof(partnerCtx, claim.id, {
    kind: "lead_export",
    reference: "CRM-EXPORT-96-LEADS",
    documentUrl: "https://files.example/leads/webinar-series.csv",
  });
  await services.mdf.submitClaim(partnerCtx, claim.id);
  await services.mdf.startClaimReview(channelManager, claim.id);
  await services.mdf.approveClaim(channelManager, claim.id);
  await services.mdf.payClaim(channelManager, claim.id, "AP-2026-000771");

  // A second request left awaiting approval so the demo has open workflow.
  const tradeShow = await services.mdf.createRequest(partnerCtx, {
    partnerId: contoso.id,
    budgetId: budget.id,
    activityType: "trade_show",
    title: "Smart Factory Expo booth",
    description: "Shared booth at the Smart Factory Expo with two demo stations and staff.",
    activityStart: addDays(quarter.start, 40),
    activityEnd: addDays(quarter.start, 43),
    requestedAmount: money(25_000_00, "USD"),
    expectedLeads: 60,
  });
  await services.mdf.submitRequest(partnerCtx, tradeShow.id);

  // --- entitlement overrides -------------------------------------------------
  await services.entitlement.grant(channelManager, {
    entitlementCode: "training_library",
    subject: "partner",
    subjectId: fabrikam.id,
    effect: "allow",
    reason: "Pre-onboarding enablement while the application is in review",
    expiresAt: addMonths(now, 3),
  });
  await services.entitlement.grant(channelManager, {
    entitlementCode: "co_brandable_assets",
    subject: "user",
    subjectId: sam.id,
    effect: "deny",
    reason: "Brand guideline violation under review",
  });

  return {
    ctx,
    partners: {
      northwind: northwind.id,
      contoso: contoso.id,
      tailspin: tailspin.id,
      fabrikam: fabrikam.id,
    },
    contracts: {
      northwind: northwindContract.id,
      contoso: contosoContract.id,
      tailspin: tailspinContract.id,
    },
    portalUsers: {
      ada: ada.id,
      sam: sam.id,
      tara: tara.id,
      nadia: nadia.id,
      pending: pendingUser.id,
    },
    budgetId: budget.id,
    paidClaimId: claim.id,
    pendingRequestId: tradeShow.id,
    period,
  };
}
