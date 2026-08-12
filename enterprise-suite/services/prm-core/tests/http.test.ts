import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createContainer } from "../src/infrastructure/container.js";
import { seedDemoData, type SeedResult } from "../src/infrastructure/seed.js";
import { createPrmServer } from "../src/http/server.js";
import { FixedClock, SequentialTokenIssuer } from "../src/infrastructure/memory/stores.js";

let server: Server;
let baseUrl: string;
let seeded: SeedResult;
const clock = new FixedClock("2026-01-05T00:00:00.000Z");

interface CallResult {
  readonly status: number;
  // Response bodies are the API's own JSON; tests assert on the fields they care about.
  readonly body: any;
}

/** Channel-side caller unless the test passes another `user`. */
async function call(
  method: string,
  path: string,
  options: { body?: unknown; tenant?: string | null; user?: string; roles?: string } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.tenant !== null) headers["x-tenant-id"] = options.tenant ?? "demo";
  headers["x-user-id"] = options.user ?? "channel-manager";
  headers["x-roles"] = options.roles ?? "prm.channel_manager";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
}

/** The partner's own portal admin, who files requests but may not approve them. */
function asPartner(user = "ada@contoso.example"): { user: string; roles: string } {
  return { user, roles: "partner.portal_admin" };
}

before(async () => {
  const container = createContainer({ clock, tokens: new SequentialTokenIssuer() });
  seeded = await seedDemoData(container, "demo");
  server = createPrmServer(container);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

describe("HTTP: plumbing", () => {
  it("health needs no tenant; everything else does", async () => {
    const health = await call("GET", "/health", { tenant: null });
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "prm-core");

    const anonymous = await call("GET", "/partners", { tenant: null });
    assert.equal(anonymous.status, 400);
    assert.equal(anonymous.body.code, "TENANT_REQUIRED");
  });

  it("maps domain errors and bad requests onto status codes", async () => {
    const unknownRoute = await call("GET", "/partner-portal");
    assert.equal(unknownRoute.status, 404);
    assert.equal(unknownRoute.body.code, "ROUTE_NOT_FOUND");

    const missing = await call("GET", "/partners/prt_nope");
    assert.equal(missing.status, 404);

    const invalid = await call("POST", "/partners", { body: { legalName: "No type given" } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "VALIDATION");

    const duplicate = await call("POST", "/partners", {
      body: { legalName: "Contoso Solutions Ltd", type: "var", countryCode: "GB" },
    });
    assert.equal(duplicate.status, 409);

    const badEnum = await call("GET", "/partners?status=vanished");
    assert.equal(badEnum.status, 400);
  });

  it("keeps tenants apart", async () => {
    const foreign = await call("GET", `/partners/${seeded.partners["contoso"]}`, { tenant: "other-co" });
    assert.equal(foreign.status, 404);
    const empty = await call("GET", "/partners", { tenant: "other-co" });
    assert.equal(empty.body.total, 0);
  });
});

describe("HTTP: seeded channel program", () => {
  it("lists and filters the partner base", async () => {
    const all = await call("GET", "/partners?pageSize=50");
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 4);

    const distributors = await call("GET", "/partners?type=distributor");
    assert.deepEqual(distributors.body.items.map((p: any) => p.displayName), ["Northwind"]);

    const inReview = await call("GET", "/partners?status=in_review");
    assert.deepEqual(inReview.body.items.map((p: any) => p.legalName), ["Fabrikam Systems Inc"]);

    const dach = await call("GET", "/partners?territory=AT");
    assert.equal(dach.body.total, 1);
  });

  it("returns the distributor tree", async () => {
    const tree = await call("GET", `/partners/${seeded.partners["northwind"]}/hierarchy`);
    assert.equal(tree.body.parent, undefined);
    assert.deepEqual(tree.body.children.map((c: any) => c.displayName), ["Contoso"]);

    const child = await call("GET", `/partners/${seeded.partners["contoso"]}/hierarchy`);
    assert.equal(child.body.parent.displayName, "Northwind");
  });

  it("assembles the partner dashboard in one round trip", async () => {
    const overview = await call("GET", `/partners/${seeded.partners["contoso"]}/overview`);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.partner.tierCode, "gold");
    assert.deepEqual(
      overview.body.effectiveContracts.map((c: any) => c.type),
      ["reseller"],
    );
    // Trailing 12 months from 2026-01-05: the oldest seeded quarter has already
    // rolled out of the window, leaving 62k + 71k + 95k.
    assert.equal(overview.body.trailingPerformance.bookedRevenue.amountMinor, 228_000_00);
    assert.equal(overview.body.certifications.certifiedIndividuals, 3);
    assert.equal(overview.body.portalUsers.length, 4);
    assert.equal(overview.body.tierEvaluation.currentTierCode, "gold");
  });

  it("resolves the discount that actually applies to a scope", async () => {
    const generic = await call("GET", `/partners/${seeded.partners["contoso"]}/pricing`);
    assert.equal(generic.body.bestDiscountBps, 1500);

    const analytics = await call(
      "GET",
      `/partners/${seeded.partners["contoso"]}/pricing?scope=analytics-suite`,
    );
    assert.equal(analytics.body.bestDiscountBps, 2200);
  });

  it("publishes the tier ladder and scores a partner against it", async () => {
    const tiers = await call("GET", "/tiers");
    assert.deepEqual(tiers.body.map((t: any) => t.code), ["registered", "silver", "gold", "platinum"]);

    const benefits = await call("GET", `/partners/${seeded.partners["contoso"]}/tier-benefits`);
    assert.equal(benefits.status, 200);
    assert.ok(benefits.body.mdfAccrualBps > 0);

    const noTier = await call("GET", `/partners/${seeded.partners["fabrikam"]}/tier-benefits`);
    assert.equal(noTier.status, 404);

    const facts = await call("GET", `/partners/${seeded.partners["contoso"]}/tier-facts`);
    assert.equal(facts.body.certifiedIndividuals, 3);
    assert.deepEqual(facts.body.heldCertificationCodes, ["sales-pro", "tech-pro"]);
    assert.equal(facts.body.hasActiveContract, true);
  });
});

describe("HTTP: onboarding a partner end to end", () => {
  const tenant = "flow-co";
  const partnerSide = { tenant, ...asPartner("mika@fourthcoffee.example") };
  let partnerId: string;
  let contractId: string;

  it("registers an applicant and refuses to activate it early", async () => {
    const created = await call("POST", "/partners", {
      tenant,
      body: {
        legalName: "Fourth Coffee Systems",
        displayName: "Fourth Coffee",
        type: "systems_integrator",
        countryCode: "US",
        currency: "USD",
        territories: ["US-WEST"],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.number, "PRT-00001");
    assert.equal(created.body.status, "prospect");
    partnerId = created.body.id;

    const early = await call("POST", `/partners/${partnerId}/activate`, { tenant });
    assert.equal(early.status, 422);
  });

  it("walks the application through review to approval", async () => {
    const incomplete = await call("POST", `/partners/${partnerId}/application`, { tenant });
    assert.equal(incomplete.status, 400, "no primary contact or HQ address yet");

    const address = await call("POST", `/partners/${partnerId}/addresses`, {
      tenant,
      body: {
        kind: "headquarters",
        line1: "200 Pike St",
        city: "Seattle",
        postalCode: "98101",
        countryCode: "US",
      },
    });
    assert.equal(address.status, 201);

    const contact = await call("POST", `/partners/${partnerId}/contacts`, {
      tenant,
      body: {
        firstName: "Mika",
        lastName: "Sorensen",
        email: "mika@fourthcoffee.example",
        role: "primary",
        jobTitle: "Alliance Lead",
      },
    });
    assert.equal(contact.status, 201);

    assert.equal((await call("POST", `/partners/${partnerId}/application`, { tenant })).body.status, "applied");
    assert.equal((await call("POST", `/partners/${partnerId}/review`, { tenant })).body.status, "in_review");
    const approved = await call("POST", `/partners/${partnerId}/approve`, {
      tenant,
      body: { notes: "Strong public-sector practice" },
    });
    assert.equal(approved.body.status, "approved");
  });

  it("signs and activates the trading contract, then the partner", async () => {
    const drafted = await call("POST", "/contracts", {
      tenant,
      body: {
        partnerId,
        type: "reseller",
        title: "US West reseller agreement",
        currency: "USD",
        effectiveFrom: clock.now(),
        effectiveTo: "2028-01-05T00:00:00.000Z",
        baseDiscountBps: 1200,
        mdfEligible: true,
        mdfAccrualBps: 150,
      },
    });
    assert.equal(drafted.status, 201);
    assert.equal(drafted.body.number, "PCT-00001");
    contractId = drafted.body.id;

    const earlyActivation = await call("POST", `/contracts/${contractId}/activate`, { tenant });
    assert.equal(earlyActivation.status, 422, "an unsigned contract cannot go live");

    await call("POST", `/contracts/${contractId}/send`, { tenant });
    await call("POST", `/contracts/${contractId}/sign`, {
      tenant,
      body: {
        party: "partner",
        signatoryName: "Mika Sorensen",
        signatoryEmail: "mika@fourthcoffee.example",
      },
    });
    const selfCounterSign = await call("POST", `/contracts/${contractId}/sign`, {
      tenant,
      body: {
        party: "vendor",
        signatoryName: "Mika Sorensen",
        signatoryEmail: "mika@fourthcoffee.example",
      },
    });
    assert.equal(selfCounterSign.status, 422);
    assert.equal(selfCounterSign.body.code, "SEGREGATION_OF_DUTIES");

    await call("POST", `/contracts/${contractId}/sign`, {
      tenant,
      body: {
        party: "vendor",
        signatoryName: "Vendor Channel Chief",
        signatoryEmail: "chief@vendor.example",
      },
    });
    const active = await call("POST", `/contracts/${contractId}/activate`, { tenant });
    assert.equal(active.body.status, "active");

    const live = await call("POST", `/partners/${partnerId}/activate`, { tenant });
    assert.equal(live.body.status, "active");
  });

  it("refuses a second trading contract and files the NDA alongside", async () => {
    const second = await call("POST", "/contracts", {
      tenant,
      body: {
        partnerId,
        type: "distribution",
        title: "Competing distribution agreement",
        currency: "USD",
        effectiveFrom: clock.now(),
        effectiveTo: "2027-01-05T00:00:00.000Z",
        baseDiscountBps: 2500,
      },
    });
    await call("POST", `/contracts/${second.body.id}/send`, { tenant });
    await call("POST", `/contracts/${second.body.id}/sign`, {
      tenant,
      body: { party: "partner", signatoryName: "Mika Sorensen", signatoryEmail: "mika@fourthcoffee.example" },
    });
    await call("POST", `/contracts/${second.body.id}/sign`, {
      tenant,
      body: { party: "vendor", signatoryName: "Chief", signatoryEmail: "chief@vendor.example" },
    });
    const clash = await call("POST", `/contracts/${second.body.id}/activate`, { tenant });
    assert.equal(clash.status, 409);

    const contracts = await call("GET", `/partners/${partnerId}/contracts`, { tenant });
    assert.equal(contracts.body.filter((c: any) => c.status === "active").length, 1);
  });

  it("auto-assigns the entry tier the partner actually qualifies for", async () => {
    await call("POST", "/tiers/install-standard", { tenant });
    const review = await call("POST", `/partners/${partnerId}/tier/auto`, { tenant, body: {} });
    assert.equal(review.status, 200);
    assert.equal(review.body.applied, true);
    // No revenue history and no certifications yet: the ladder starts at the bottom.
    assert.equal(review.body.evaluation.eligibleTierCode, "registered");
    assert.equal(review.body.appliedTierCode, "registered");

    const forced = await call("POST", `/partners/${partnerId}/tier`, {
      tenant,
      body: { tierCode: "platinum", reason: "Wishful thinking" },
    });
    assert.equal(forced.status, 422);
    assert.equal(forced.body.code, "TIER_INELIGIBLE");

    const migrated = await call("POST", `/partners/${partnerId}/tier`, {
      tenant,
      body: { tierCode: "silver", reason: "Legacy program migration", override: true },
    });
    assert.equal(migrated.body.tierCode, "silver");
  });

  it("scopes portal identities to the partner and protects the last admin", async () => {
    const admin = await call("POST", "/portal-users", {
      tenant,
      body: {
        partnerId,
        email: "Mika@FourthCoffee.example",
        firstName: "Mika",
        lastName: "Sorensen",
        roles: ["portal_admin"],
      },
    });
    assert.equal(admin.status, 201);
    assert.equal(admin.body.email, "mika@fourthcoffee.example", "emails are normalised");
    assert.equal(admin.body.status, "invited");

    const duplicate = await call("POST", "/portal-users", {
      tenant,
      body: {
        partnerId,
        email: "mika@fourthcoffee.example",
        firstName: "Mika",
        lastName: "Duplicate",
        roles: ["sales_rep"],
      },
    });
    assert.equal(duplicate.status, 409);

    await call("POST", `/portal-users/${admin.body.id}/accept-invite`, { tenant });
    const demoted = await call("PUT", `/portal-users/${admin.body.id}/roles`, {
      tenant,
      body: { roles: ["sales_rep"] },
    });
    assert.equal(demoted.status, 422, "the last portal admin cannot demote themselves");

    const login = await call("POST", `/portal-users/${admin.body.id}/logins`, { ...partnerSide });
    assert.equal(login.body.loginCount, 1);
  });
});

describe("HTTP: market development funds", () => {
  let claimId: string;
  const requestId = () => seeded.pendingRequestId;

  it("reports the partner fund ledger", async () => {
    const balance = await call("GET", `/partners/${seeded.partners["contoso"]}/mdf/balance`);
    assert.equal(balance.status, 200);
    assert.equal(balance.body.allocated.amountMinor, 200_000_00);
    // 32k paid on the webinar claim; 25k of the trade show is still only requested.
    assert.equal(balance.body.paid.amountMinor, 32_000_00);
    assert.equal(balance.body.committed.amountMinor, 3_000_00, "webinar remainder stays committed");
    assert.equal(balance.body.available.amountMinor, 165_000_00);
  });

  it("refuses funds to a partner without an eligible contract", async () => {
    const eligibility = await call("GET", `/partners/${seeded.partners["fabrikam"]}/mdf/eligibility`);
    assert.equal(eligibility.body.eligible, false);
    assert.ok(eligibility.body.reasons.some((r: string) => r.includes("in_review")));

    const rejected = await call("POST", "/mdf/requests", {
      ...asPartner(),
      body: {
        partnerId: seeded.partners["fabrikam"],
        budgetId: seeded.budgetId,
        activityType: "event",
        title: "Launch event",
        description: "A launch event for a partner that is not live yet.",
        activityStart: "2026-02-10T00:00:00.000Z",
        activityEnd: "2026-02-12T00:00:00.000Z",
        requestedAmount: { amountMinor: 10_000_00, currency: "USD" },
      },
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.code, "INVALID_STATE");
  });

  it("keeps the requester out of the approval", async () => {
    const selfApproval = await call("POST", `/mdf/requests/${requestId()}/approve`, {
      ...asPartner(),
      body: {},
    });
    assert.equal(selfApproval.status, 422);
    assert.equal(selfApproval.body.code, "SEGREGATION_OF_DUTIES");
  });

  it("approves the trade-show request and commits the money", async () => {
    const approved = await call("POST", `/mdf/requests/${requestId()}/approve`, {
      body: {
        approvedAmount: { amountMinor: 20_000_00, currency: "USD" },
        notes: "Booth approved, staffing costs excluded",
      },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, "approved");
    assert.equal(approved.body.approvedAmount.amountMinor, 20_000_00);
    // The partner's own share is fixed against what it asked for (25k at the
    // budget's 50/50 matching rate), not against what the vendor granted.
    assert.equal(approved.body.partnerContribution.amountMinor, 12_500_00);
    // Activity ends 2026-02-13; the budget's claim window is 60 days.
    assert.equal(approved.body.claimDeadline, "2026-04-14T00:00:00.000Z");

    const balance = await call("GET", `/partners/${seeded.partners["contoso"]}/mdf/balance`);
    assert.equal(balance.body.committed.amountMinor, 23_000_00);
  });

  it("will not pay a claim without documented spend and proof of performance", async () => {
    const claim = await call("POST", "/mdf/claims", {
      ...asPartner(),
      body: {
        requestId: requestId(),
        claimedAmount: { amountMinor: 18_000_00, currency: "USD" },
        activitySummary: "Booth staffed for three days, 74 scanned badges.",
        actualLeads: 74,
      },
    });
    assert.equal(claim.status, 201);
    assert.equal(claim.body.number, "CLM-00002");
    claimId = claim.body.id;

    const bare = await call("POST", `/mdf/claims/${claimId}/submit`, asPartner());
    assert.equal(bare.status, 400);
    assert.match(bare.body.message, /invoice or receipt/);

    await call("POST", `/mdf/claims/${claimId}/proofs`, {
      ...asPartner(),
      body: {
        kind: "invoice",
        reference: "EXPO-2026-4471",
        amount: { amountMinor: 12_000_00, currency: "USD" },
        documentUrl: "https://files.example/invoices/expo-4471.pdf",
      },
    });
    await call("POST", `/mdf/claims/${claimId}/proofs`, {
      ...asPartner(),
      body: { kind: "attendee_list", reference: "BADGE-SCANS-74" },
    });

    const short = await call("POST", `/mdf/claims/${claimId}/submit`, asPartner());
    assert.equal(short.status, 422, "12k of invoices does not cover an 18k claim");

    const receipt = await call("POST", `/mdf/claims/${claimId}/proofs`, {
      ...asPartner(),
      body: { kind: "receipt", reference: "BOOTH-BUILD", amount: { amountMinor: 6_000_00, currency: "USD" } },
    });
    assert.equal(receipt.status, 201);

    const submitted = await call("POST", `/mdf/claims/${claimId}/submit`, asPartner());
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.status, "submitted");
  });

  it("short-pays with a reason and settles the ledger", async () => {
    await call("POST", `/mdf/claims/${claimId}/review`);
    const unexplained = await call("POST", `/mdf/claims/${claimId}/approve`, {
      body: { approvedAmount: { amountMinor: 15_000_00, currency: "USD" } },
    });
    assert.equal(unexplained.status, 400, "paying less than claimed has to be explained");

    const approved = await call("POST", `/mdf/claims/${claimId}/approve`, {
      body: {
        approvedAmount: { amountMinor: 15_000_00, currency: "USD" },
        notes: "Booth build was outside the approved scope",
      },
    });
    assert.equal(approved.body.approvedAmount.amountMinor, 15_000_00);

    const paid = await call("POST", `/mdf/claims/${claimId}/pay`, {
      body: { reference: "AP-2026-000902" },
    });
    assert.equal(paid.body.status, "paid");

    const balance = await call("GET", `/partners/${seeded.partners["contoso"]}/mdf/balance`);
    assert.equal(balance.body.paid.amountMinor, 47_000_00);
    assert.equal(balance.body.committed.amountMinor, 8_000_00);

    const closed = await call("POST", `/mdf/requests/${requestId()}/close`, {
      body: { reason: "Expo finished; releasing the unclaimed balance" },
    });
    assert.equal(closed.body.status, "closed");
    const after = await call("GET", `/partners/${seeded.partners["contoso"]}/mdf/balance`);
    assert.equal(after.body.committed.amountMinor, 3_000_00, "only the webinar remainder is left");
  });
});

describe("HTTP: enablement and entitlements", () => {
  it("serves the catalog and a user transcript", async () => {
    const courses = await call("GET", "/courses");
    assert.equal(courses.body.length, 5);

    const transcript = await call("GET", `/portal-users/${seeded.portalUsers["ada"]}/transcript`);
    assert.deepEqual(transcript.body.completedCourseCodes, ["sales-advanced", "sales-foundations"]);
    assert.deepEqual(transcript.body.certifications.map((c: any) => c.code), ["sales-pro"]);
    assert.equal(transcript.body.certifications[0].status, "active");
  });

  it("refuses a certification whose coursework is unfinished, then awards it", async () => {
    const samId = seeded.portalUsers["sam"];
    const premature = await call("POST", "/certifications", {
      body: { portalUserId: samId, certificationCode: "tech-pro" },
    });
    assert.equal(premature.status, 422);
    assert.equal(premature.body.code, "CERTIFICATION_REQUIREMENTS_NOT_MET");

    // Sam failed the first tech-foundations attempt in the seed; the retry passes.
    const enrollments = await call("GET", `/enrollments?portalUserId=${samId}&courseCode=tech-foundations`);
    const open = enrollments.body.items[0];
    assert.equal(open.status, "in_progress");
    assert.equal(open.bestScore, 54);
    const retry = await call("POST", `/enrollments/${open.id}/attempts`, {
      body: { score: 78, proctored: true },
    });
    assert.equal(retry.status, 201);
    assert.equal(retry.body.passed, true);

    const advanced = await call("POST", "/enrollments", {
      body: { portalUserId: samId, courseCode: "tech-advanced" },
    });
    await call("POST", `/enrollments/${advanced.body.id}/start`);
    await call("POST", `/enrollments/${advanced.body.id}/attempts`, { body: { score: 84 } });

    const awarded = await call("POST", "/certifications", {
      body: { portalUserId: samId, certificationCode: "tech-pro" },
    });
    assert.equal(awarded.status, 201);
    assert.equal(awarded.body.expiresAt, "2028-01-05T00:00:00.000Z");

    const summary = await call("GET", `/partners/${seeded.partners["contoso"]}/certifications`);
    assert.equal(summary.body.certifiedIndividuals, 3);
    assert.ok(summary.body.activeCertificationCodes.includes("tech-pro"));
  });

  it("blocks enrollment when the prerequisite is not held", async () => {
    const blocked = await call("POST", "/enrollments", {
      body: { portalUserId: seeded.portalUsers["nadia"], courseCode: "tech-architecture" },
    });
    assert.equal(blocked.status, 400);
    assert.deepEqual(blocked.body.details.issues, [
      { field: "prerequisites", message: "complete tech-advanced first" },
    ]);
  });

  it("drives the portal menu from tier, role, contract and certification facts", async () => {
    const menu = await call("GET", `/portal-users/${seeded.portalUsers["ada"]}/menu`);
    assert.equal(menu.status, 200);
    assert.ok(menu.body.granted.includes("deal_registration"));
    assert.ok(menu.body.granted.includes("mdf_requests"));

    const facts = await call("GET", `/portal-users/${seeded.portalUsers["tara"]}/entitlement-facts`);
    assert.deepEqual([...facts.body.roles].sort(), ["support_agent", "technical_lead"]);
    assert.ok(facts.body.userCertificationCodes.includes("tech-pro"));
  });

  it("honours explicit deny overrides over policy", async () => {
    const samId = seeded.portalUsers["sam"];
    const denied = await call("GET", `/portal-users/${samId}/entitlements?code=co_brandable_assets`);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "ENTITLEMENT_DENIED");
    assert.match(denied.body.details.reasons.join(" "), /Brand guideline/);

    const grants = await call("GET", `/entitlement-grants?portalUserId=${samId}`);
    assert.equal(grants.body.length, 1);
    const revoked = await call("DELETE", `/entitlement-grants/${grants.body[0].id}`);
    assert.equal(revoked.status, 200);

    // Revoking the override hands the decision back to policy, which still says
    // no: a sales rep is not a marketing role.
    const byPolicy = await call("GET", `/portal-users/${samId}/entitlements?code=co_brandable_assets`);
    assert.equal(byPolicy.status, 403);
    assert.match(byPolicy.body.details.reasons.join(" "), /roles \[portal_admin, marketing_manager\]/);

    const marketer = await call(
      "GET",
      `/portal-users/${seeded.portalUsers["ada"]}/entitlements?code=co_brandable_assets`,
    );
    assert.equal(marketer.status, 200);
    assert.equal(marketer.body.granted, true);
    assert.equal(marketer.body.source, "policy");
  });

  it("lets a partner-level allow override reach a partner still in review", async () => {
    const decisions = await call("GET", `/partners/${seeded.partners["fabrikam"]}/entitlements`);
    const training = decisions.body.find((d: any) => d.code === "training_library");
    assert.equal(training.granted, true);
    assert.equal(training.source, "explicit_allow");
    assert.ok(training.expiresAt, "the override is time-boxed to the review period");

    const other = decisions.body.find((d: any) => d.code === "deal_registration");
    assert.equal(other.granted, false);
    assert.match(other.reasons.join(" "), /partner is in_review/);
  });

  it("suspending a partner takes its portal access with it", async () => {
    const tailspin = seeded.partners["tailspin"];
    const suspended = await call("POST", `/partners/${tailspin}/suspend`, {
      body: { reason: "Payment 90 days overdue" },
    });
    assert.equal(suspended.body.status, "suspended");

    const decisions = await call("GET", `/partners/${tailspin}/entitlements`);
    assert.equal(decisions.body.every((d: any) => !d.granted), true);

    const reinstated = await call("POST", `/partners/${tailspin}/reinstate`, {
      body: { note: "Invoices settled" },
    });
    assert.equal(reinstated.body.status, "active");
  });
});

describe("HTTP: event stream", () => {
  it("exposes the tenant outbox, filtered by type and aggregate", async () => {
    const paid = await call("GET", "/events?type=prm.mdf-claim.paid");
    assert.equal(paid.status, 200);
    assert.equal(paid.body.length, 2, "the seeded webinar claim and the trade-show claim");
    assert.ok(paid.body.every((e: any) => e.aggregateType === "MdfClaim"));

    const contosoEvents = await call("GET", `/events?aggregateId=${seeded.partners["contoso"]}`);
    const types = contosoEvents.body.map((e: any) => e.eventType);
    assert.ok(types.includes("prm.partner.registered"));
    assert.ok(types.includes("prm.partner.activated"));
    assert.ok(types.includes("prm.partner.tier-assigned"));

    const foreign = await call("GET", "/events", { tenant: "other-co" });
    assert.deepEqual(foreign.body, []);
  });
});
