import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createChannelServer } from "../src/http/server.js";
import { createContainer, type ChannelContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/memory/stores.js";
import { seedDemoData, type SeedResult } from "../src/infrastructure/seed.js";
import { addDays } from "../src/domain/protection.js";

/**
 * End-to-end over the wire. The seeded "demo" tenant covers reads and error
 * mapping; a second tenant on the same server runs a deal from partner
 * onboarding to a booked order, which also proves the stores are isolated.
 */

const clock = new FixedClock("2026-01-01T00:00:00.000Z");
let container: ChannelContainer;
let seeded: SeedResult;
let server: Server;
let baseUrl: string;

interface CallResult {
  readonly status: number;
  readonly body: any;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; tenant?: string | null; user?: string; roles?: string } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.tenant !== null) headers["x-tenant-id"] = options.tenant ?? "demo";
  headers["x-user-id"] = options.user ?? "http-tester";
  headers["x-roles"] = options.roles ?? "prm.admin";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
}

/** Calls that are expected to succeed; fails loudly with the server's message. */
async function ok(
  method: string,
  path: string,
  options: { body?: unknown; tenant?: string; user?: string; expect?: number } = {},
): Promise<any> {
  const result = await call(method, path, options);
  const expected = options.expect ?? (method === "POST" ? 201 : 200);
  assert.equal(
    result.status,
    expected,
    `${method} ${path} -> ${result.status} ${JSON.stringify(result.body)}`,
  );
  return result.body;
}

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

before(async () => {
  container = createContainer({ clock });
  seeded = await seedDemoData(container, "demo");
  server = createChannelServer(container);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

describe("HTTP plumbing", () => {
  it("serves health without a tenant and refuses everything else without one", async () => {
    const health = await call("GET", "/health", { tenant: null });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok", service: "channel-prm" });

    const anonymous = await call("GET", "/partners", { tenant: null });
    assert.equal(anonymous.status, 400);
    assert.equal(anonymous.body.code, "TENANT_REQUIRED");
  });

  it("maps unknown routes, bad JSON and domain errors onto statuses", async () => {
    assert.equal((await call("GET", "/nope")).status, 404);

    const missing = await call("GET", "/deal-registrations/dealregistration_nosuchthing");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");

    const badJson = await fetch(`${baseUrl}/partners`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "demo" },
      body: "{not json",
    });
    assert.equal(badJson.status, 400);
    assert.equal(((await badJson.json()) as { code: string }).code, "BAD_JSON");

    const invalid = await call("POST", "/partners", { body: { code: "X" } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "VALIDATION");
    assert.deepEqual(invalid.body.details.issues, [{ field: "contact", message: "must be an object" }]);

    // Approving an already-approved registration is a state error, not a 400.
    const state = await call("POST", `/deal-registrations/${seeded.registrations["contoso"]}/approve`);
    assert.equal(state.status, 422);
    assert.equal(state.body.code, "INVALID_STATE");
  });

  it("keeps tenants apart", async () => {
    const other = await call("GET", "/partners", { tenant: "someone-else" });
    assert.equal(other.status, 200);
    assert.equal(other.body.total, 0);
  });
});

describe("reading the seeded channel", () => {
  it("lists and filters partners, and exposes the tier policy on the detail view", async () => {
    const all = await ok("GET", "/partners?pageSize=50", { expect: 200 });
    assert.equal(all.total, 4);
    assert.deepEqual(
      all.items.map((p: any) => p.code).sort(),
      ["ATLAS-REF", "HELIOS", "MERIDIAN", "NORTHWIND"],
    );

    const platinum = await ok("GET", "/partners?tier=platinum", { expect: 200 });
    assert.deepEqual(platinum.items.map((p: any) => p.code), ["MERIDIAN"]);

    const emea = await ok("GET", "/partners?territory=DE", { expect: 200 });
    assert.deepEqual(emea.items.map((p: any) => p.code).sort(), ["HELIOS", "NORTHWIND"]);

    const detail = await ok("GET", `/partners/${seeded.partners["northwind"]}`, { expect: 200 });
    assert.equal(detail.canTransact, true);
    assert.equal(detail.policy.tier, "gold");
    assert.ok(detail.policy.protectionDays > 0);

    const byCode = await ok("GET", "/partners/NORTHWIND", { expect: 200 });
    assert.equal(byCode.id, seeded.partners["northwind"]);

    const badFilter = await call("GET", "/partners?tier=titanium");
    assert.equal(badFilter.status, 400);
  });

  it("returns a registration with its derived protection state", async () => {
    const view = await ok("GET", `/deal-registrations/${seeded.registrations["contoso"]}`, { expect: 200 });
    assert.equal(view.status, "closed_won");
    assert.equal(view.protectionStatus.protectedNow, true);
    assert.ok(view.protectionStatus.remainingDays > 0);
    assert.equal(view.quoteCount, 1);
    assert.equal(view.orderCount, 1);
    assert.equal(view.forecastCategory, "closed_won");
    assert.ok(view.cycleDays >= 0);
  });

  it("filters registrations by status, partner and expiry horizon", async () => {
    const approved = await ok("GET", "/deal-registrations?status=approved&pageSize=50", { expect: 200 });
    assert.ok(approved.items.every((r: any) => r.status === "approved"));

    const northwind = await ok(
      `GET`,
      `/deal-registrations?partnerId=${seeded.partners["northwind"]}&pageSize=50`,
      { expect: 200 },
    );
    assert.ok(northwind.total >= 2);
    assert.ok(northwind.items.every((r: any) => r.partnerId === seeded.partners["northwind"]));

    const soon = await ok("GET", "/deal-registrations?expiringWithinDays=365&pageSize=50", { expect: 200 });
    assert.ok(soon.items.every((r: any) => r.protection));

    const search = await ok("GET", "/deal-registrations?q=initech", { expect: 200 });
    assert.equal(search.total, 1);
  });

  it("walks the links from a registration to its conflicts, quotes and orders", async () => {
    const contoso = seeded.registrations["contoso"];
    const quotes = await ok("GET", `/deal-registrations/${contoso}/quotes`, { expect: 200 });
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].status, "ordered");

    const orders = await ok("GET", `/deal-registrations/${contoso}/orders`, { expect: 200 });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].salesOrderRef.number, "SO-009871");

    const conflicts = await ok("GET", `/deal-registrations/${contoso}/conflicts`, { expect: 200 });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, "partner_vs_partner");
    assert.equal(conflicts[0].open, true);
  });

  it("publishes the domain events to the diagnostics stream", async () => {
    const created = await ok("GET", "/events?type=prm.deal-registration.created", { expect: 200 });
    assert.equal(created.length, 6);
    assert.ok(created.every((e: any) => e.tenantId === "demo"));

    const approvals = await ok("GET", "/events?type=prm.deal-registration.approved", { expect: 200 });
    assert.ok(approvals.length >= 3);
    assert.ok(approvals[0].payload.protectionEndsAt);
  });
});

describe("a deal registered, contested, quoted and booked over HTTP", () => {
  const tenant = "greenfield";
  let incumbent: string;
  let challenger: string;
  let registration: any;

  it("onboards two partners", async () => {
    const northstar = await ok("POST", "/partners", {
      tenant,
      body: {
        code: "NORTHSTAR",
        name: "Northstar Networks",
        type: "reseller",
        tier: "gold",
        territories: ["NA"],
        productLines: ["network-security", "endpoint"],
        currency: "USD",
        contact: { name: "Ada Okafor", email: "ada@northstar.example" },
      },
    });
    assert.equal(northstar.status, "onboarding");
    incumbent = northstar.id;

    const early = await ok("POST", "/deal-registrations/precheck", {
      tenant,
      expect: 200,
      body: {
        partnerId: incumbent,
        endCustomer: { name: "Tailwind Traders", domain: "tailwindtraders.com", country: "US" },
        productLines: ["network-security"],
      },
    });
    assert.equal(early.eligible, false, "an onboarding partner cannot register yet");

    const activated = await ok("POST", `/partners/${incumbent}/activate`, { tenant, expect: 200 });
    assert.equal(activated.status, "active");
    assert.equal(activated.canTransact, true);

    const rival = await ok("POST", "/partners", {
      tenant,
      body: {
        code: "SOUTHPAW",
        name: "Southpaw Integration",
        type: "reseller",
        tier: "silver",
        territories: ["NA"],
        productLines: ["network-security"],
        contact: { name: "Ben Alvarez", email: "ben@southpaw.example" },
      },
    });
    challenger = rival.id;
    await ok("POST", `/partners/${challenger}/activate`, { tenant, expect: 200 });
  });

  it("pre-checks before anything is written", async () => {
    const precheck = await ok("POST", "/deal-registrations/precheck", {
      tenant,
      expect: 200,
      body: {
        partnerId: incumbent,
        endCustomer: { name: "Tailwind Traders", domain: "tailwindtraders.com", country: "US" },
        productLines: ["network-security"],
        estimatedValue: usd(40_000_000),
      },
    });
    assert.equal(precheck.eligible, true);
    assert.deepEqual(precheck.findings, []);
    assert.equal(precheck.customerKey, "domain:tailwindtraders.com");

    const empty = await ok("GET", "/deal-registrations", { tenant, expect: 200 });
    assert.equal(empty.total, 0, "a pre-check writes nothing");
  });

  it("registers, submits and approves the deal", async () => {
    registration = await ok("POST", "/deal-registrations", {
      tenant,
      body: {
        partnerId: incumbent,
        endCustomer: { name: "Tailwind Traders", domain: "tailwindtraders.com", country: "US", city: "Austin" },
        productLines: ["network-security"],
        estimatedValue: usd(40_000_000),
        expectedCloseDate: addDays(clock.now(), 90),
        description: "Datacentre firewall consolidation across three regions after an audit finding.",
        competitors: ["Fortinet"],
      },
    });
    assert.equal(registration.status, "draft");
    assert.match(registration.number, /^DR-\d{5}$/);

    const submitted = await ok("POST", `/deal-registrations/${registration.id}/submit`, { tenant, expect: 200 });
    assert.equal(submitted.registration.status, "submitted");
    assert.equal(submitted.autoApproved, false, "40k is well past the auto-approval bar");
    assert.ok(submitted.registration.slaDueAt);

    await ok("POST", `/deal-registrations/${registration.id}/review`, { tenant, expect: 200 });
    const approved = await ok("POST", `/deal-registrations/${registration.id}/approve`, {
      tenant,
      expect: 200,
      body: { notes: "Clean displacement case" },
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.protectionStatus.protectedNow, true);
    assert.equal(approved.tierAtApproval, "gold");
    assert.ok(approved.discountBps > 0);
  });

  it("refuses a second partner walking into live protection, and adjudicates the case", async () => {
    const draft = await ok("POST", "/deal-registrations", {
      tenant,
      body: {
        partnerId: challenger,
        endCustomer: { name: "Tailwind Traders Inc", domain: "tailwindtraders.com", country: "US" },
        productLines: ["network-security"],
        estimatedValue: usd(9_000_000),
        expectedCloseDate: addDays(clock.now(), 60),
        description: "The Austin team asked us to quote the same firewall consolidation programme.",
      },
    });

    const contested = await ok("POST", `/deal-registrations/${draft.id}/submit`, { tenant, expect: 200 });
    assert.equal(contested.conflicts.length, 1);
    const conflict = contested.conflicts[0];
    assert.equal(conflict.kind, "partner_vs_partner");
    assert.equal(conflict.incumbentRegistrationId, registration.id);
    assert.equal(conflict.recommendedOutcome, "incumbent_upheld");
    assert.ok(conflict.recommendationRationale.length > 0);

    await ok("POST", `/conflicts/${conflict.id}/evidence`, {
      tenant,
      body: { source: "claimant", note: "Head of infrastructure emailed us first; thread attached." },
    });
    await ok("POST", `/conflicts/${conflict.id}/review`, { tenant, expect: 200 });

    const resolved = await ok("POST", `/conflicts/${conflict.id}/resolve`, {
      tenant,
      expect: 200,
      body: {
        outcome: "incumbent_upheld",
        rationale: "Northstar registered first and has a proposal in front of the customer.",
      },
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.open, false);

    const loser = await ok("GET", `/deal-registrations/${draft.id}`, { tenant, expect: 200 });
    assert.equal(loser.status, "rejected");
    assert.equal(loser.rejection.reasonCode, "conflict_lost");

    const winner = await ok("GET", `/deal-registrations/${registration.id}`, { tenant, expect: 200 });
    assert.equal(winner.status, "approved");
    assert.equal(winner.protectionStatus.protectedNow, true);
  });

  it("prices the deal through a channel quote", async () => {
    const quote = await ok("POST", "/channel-quotes", {
      tenant,
      body: {
        partnerId: incumbent,
        registrationId: registration.id,
        notes: "Three-year term",
        lines: [
          {
            productLine: "network-security",
            sku: "NGFW-4400",
            quantity: 20,
            listUnitPrice: usd(1_500_000),
            requestedUnitPrice: usd(1_275_000),
          },
        ],
      },
    });
    assert.equal(quote.status, "draft");
    assert.deepEqual(quote.totals.list, usd(30_000_000));
    assert.equal(quote.totals.requestedDiscountBps, 1_500);

    const line = await ok("POST", `/channel-quotes/${quote.id}/lines`, {
      tenant,
      body: { productLine: "network-security", sku: "NGFW-SUB-3Y", quantity: 20, listUnitPrice: usd(500_000) },
    });
    await ok("PATCH", `/channel-quotes/${quote.id}/lines/${line.id}`, {
      tenant,
      expect: 200,
      body: { quantity: 22 },
    });
    assert.equal((await call("DELETE", `/channel-quotes/${quote.id}/lines/${line.id}`, { tenant })).status, 204);

    const submitted = await ok("POST", `/channel-quotes/${quote.id}/submit`, {
      tenant,
      expect: 200,
      body: { validityDays: 30 },
    });
    assert.equal(submitted.quote.status, "submitted");
    assert.equal(submitted.authority.protectedByRegistration, true);
    assert.ok(submitted.authority.ceilingBps >= 1_500, "a protected registration unlocks the full band");
    assert.equal(submitted.autoApproved, false, "15% is above the band the approval promised");

    const greedy = await call("POST", `/channel-quotes/${quote.id}/approve`, {
      tenant,
      body: { discountBps: submitted.authority.ceilingBps + 1 },
    });
    assert.equal(greedy.status, 422);
    assert.equal(greedy.body.code, "POLICY_VIOLATION");

    const approved = await ok("POST", `/channel-quotes/${quote.id}/approve`, {
      tenant,
      expect: 200,
      body: {
        discountBps: 1_400,
        notes: "14% against a 15% ask",
        salesQuoteRef: { system: "sales-erp", id: "quo_tailwind_1", number: "Q-1001" },
      },
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.totals.effectiveDiscountBps, 1_400);
    assert.deepEqual(approved.totals.approved, usd(25_800_000));

    const linked = await ok("GET", `/deal-registrations/${registration.id}`, { tenant, expect: 200 });
    assert.equal(linked.quoteCount, 1);

    const order = await ok("POST", "/channel-orders", {
      tenant,
      body: {
        partnerId: incumbent,
        channelQuoteId: quote.id,
        salesOrderRef: { system: "sales-erp", id: "so_tailwind_1", number: "SO-2001" },
        poNumber: "PO-TW-4471",
      },
    });
    assert.equal(order.status, "placed");
    assert.deepEqual(order.netValue, usd(25_800_000));
    assert.equal(order.sourceType, "partner_sourced");

    const duplicate = await call("POST", "/channel-orders", {
      tenant,
      body: {
        partnerId: incumbent,
        salesOrderRef: { system: "sales-erp", id: "so_tailwind_1" },
        netValue: usd(1_000),
      },
    });
    assert.equal(duplicate.status, 409, "a sales order maps to exactly one channel order");

    const won = await ok("GET", `/deal-registrations/${registration.id}`, { tenant, expect: 200 });
    assert.equal(won.status, "closed_won");
    assert.deepEqual(won.closure.value, usd(25_800_000));

    const invoiced = await ok("POST", `/channel-orders/${order.id}/invoice`, {
      tenant,
      expect: 200,
      body: { invoiceRef: { system: "finance-erp", id: "inv_tailwind_1" } },
    });
    assert.equal(invoiced.status, "invoiced");
    const fulfilled = await ok("POST", `/channel-orders/${order.id}/fulfill`, { tenant, expect: 200 });
    assert.equal(fulfilled.status, "fulfilled");
    assert.equal((await call("POST", `/channel-orders/${order.id}/cancel`, { tenant, body: { reason: "oops" } })).status, 422);
  });

  it("reports attainment and analytics for the tenant it was asked about", async () => {
    const attainment = await ok("GET", `/partners/${incumbent}/attainment`, { tenant, expect: 200 });
    assert.deepEqual(attainment.bookedValue, usd(25_800_000));
    assert.deepEqual(attainment.registeredValue, usd(25_800_000));
    assert.equal(attainment.orderCount, 1);

    const partners = await ok("GET", "/analytics/partners", { tenant, expect: 200 });
    const northstar = partners.partners.find((p: any) => p.partnerId === incumbent);
    assert.equal(northstar.wonCount, 1);
    assert.equal(northstar.winRateBps, 10_000);

    const funnel = await ok("GET", "/analytics/funnel", { tenant, expect: 200 });
    const won = funnel.steps.find((s: any) => s.step === "deals_won");
    assert.equal(won.count, 1);
  });
});

describe("house accounts, referrals and the analytics surface", () => {
  it("blocks registrations against a house account and unblocks when it is removed", async () => {
    const tenant = "housekeeping";
    const partner = await ok("POST", "/partners", {
      tenant,
      body: {
        code: "KEYSTONE",
        name: "Keystone Partners",
        type: "reseller",
        tier: "silver",
        territories: ["NA"],
        productLines: ["endpoint"],
        contact: { name: "Ivy Chen", email: "ivy@keystone.example" },
      },
    });
    await ok("POST", `/partners/${partner.id}/activate`, { tenant, expect: 200 });

    await ok("POST", "/house-accounts", {
      tenant,
      body: { customerKey: "domain:globex.com", reason: "named account owned by the direct team" },
    });
    const claims = await ok("GET", "/house-accounts", { tenant, expect: 200 });
    assert.equal(claims.length, 1);

    const body = {
      partnerId: partner.id,
      endCustomer: { name: "Globex Corporation", domain: "globex.com", country: "US" },
      productLines: ["endpoint"],
      estimatedValue: usd(2_000_000),
      expectedCloseDate: addDays(clock.now(), 45),
      description: "Endpoint refresh for the Globex head office and two regional sites.",
    };
    const blocked = await ok("POST", "/deal-registrations", { tenant, body });
    const refused = await call("POST", `/deal-registrations/${blocked.id}/submit`, { tenant });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "DEAL_CONFLICT");
    assert.equal(refused.body.details.findings[0].kind, "partner_vs_direct");

    assert.equal(
      (await call("DELETE", "/house-accounts/domain%3Aglobex.com", { tenant })).status,
      204,
    );
    const allowed = await ok("POST", `/deal-registrations/${blocked.id}/submit`, { tenant, expect: 200 });
    assert.equal(allowed.registration.status, "approved", "2m clears the silver auto-approval bar");
    assert.equal(allowed.autoApproved, true);
  });

  it("runs a referral from introduction to paid commission", async () => {
    const tenant = "referrals";
    const agent = await ok("POST", "/partners", {
      tenant,
      body: {
        code: "ATLAS",
        name: "Atlas Advisory",
        type: "referral_agent",
        tier: "registered",
        territories: ["NA"],
        productLines: ["cloud-platform"],
        contact: { name: "Priya Nair", email: "priya@atlas.example" },
      },
    });
    await ok("POST", `/partners/${agent.id}/activate`, { tenant, expect: 200 });

    const referral = await ok("POST", "/referrals", {
      tenant,
      body: {
        partnerId: agent.id,
        contact: { name: "Sofia Marchetti", email: "sofia@umbrella.example", title: "VP Platform" },
        company: { name: "Umbrella Logistics", domain: "umbrella-logistics.com", country: "US" },
        productLines: ["cloud-platform"],
        estimatedValue: usd(6_000_000),
      },
    });
    assert.equal(referral.status, "submitted");
    assert.match(referral.number, /^REF-\d{5}$/);

    // A referral agent may not register deals itself.
    const overreach = await call("POST", "/deal-registrations", {
      tenant,
      body: {
        partnerId: agent.id,
        endCustomer: { name: "Umbrella Logistics", domain: "umbrella-logistics.com", country: "US" },
        productLines: ["cloud-platform"],
        estimatedValue: usd(6_000_000),
        expectedCloseDate: addDays(clock.now(), 60),
        description: "Referral agents introduce customers; they do not carry the paper.",
      },
    });
    assert.equal(overreach.status, 422);
    assert.equal(overreach.body.code, "POLICY_VIOLATION");

    const accepted = await ok("POST", `/referrals/${referral.id}/accept`, {
      tenant,
      expect: 200,
      body: { attributionDays: 180 },
    });
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.attributedNow, true);
    assert.ok(accepted.commissionBps > 0);

    const handedOff = await ok("POST", `/referrals/${referral.id}/hand-off`, {
      tenant,
      expect: 200,
      body: { opportunityRef: "opp_umbrella_9912" },
    });
    assert.equal(handedOff.status, "converted");
    assert.equal(handedOff.conversion.opportunityRef, "opp_umbrella_9912");

    const won = await ok("POST", `/referrals/${referral.id}/win`, {
      tenant,
      expect: 200,
      body: { value: usd(6_400_000) },
    });
    assert.equal(won.referral.status, "closed_won");
    assert.ok(won.commission.amount.amountMinor > 0);

    const unpaid = await call("POST", `/referrals/${referral.id}/commission/pay`, {
      tenant,
      body: { paymentRef: "pay_1" },
    });
    assert.equal(unpaid.status, 422, "commission is approved before it is paid");

    await ok("POST", `/referrals/${referral.id}/commission/approve`, { tenant, expect: 200 });
    const paid = await ok("POST", `/referrals/${referral.id}/commission/pay`, {
      tenant,
      expect: 200,
      body: { paymentRef: "pay_1" },
    });
    assert.equal(paid.commission.status, "paid");

    const ledger = await ok("GET", "/commission-ledger", { tenant, expect: 200 });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].partnerId, agent.id);
    assert.deepEqual(ledger[0].paid, won.commission.amount);
    assert.equal(ledger[0].accrued.amountMinor, 0);
  });

  it("serves every analytics report over the seeded channel", async () => {
    const pipeline = await ok("GET", "/analytics/pipeline", { expect: 200 });
    assert.equal(pipeline.currency, "USD");
    assert.ok(pipeline.openCount >= 1);
    assert.equal(
      pipeline.buckets.reduce((sum: number, b: any) => sum + b.count, 0),
      pipeline.openCount,
    );

    const forecast = await ok("GET", "/analytics/forecast", { expect: 200 });
    assert.deepEqual(
      forecast.map((b: any) => b.category),
      ["omitted", "pipeline", "best_case", "commit", "closed_won"],
    );

    const tiers = await ok("GET", "/analytics/tiers", { expect: 200 });
    assert.ok(tiers.some((t: any) => t.tier === "gold"));

    const expiry = await ok("GET", "/analytics/protection-expiry", { expect: 200 });
    assert.ok(expiry.buckets.length > 0);

    const split = await ok("GET", "/analytics/source-split", { expect: 200 });
    assert.ok(split.partnerSourced.amountMinor > 0);

    const cohorts = await ok("GET", "/analytics/cohorts?granularity=month", { expect: 200 });
    assert.ok(cohorts.length >= 1);
    assert.equal((await call("GET", "/analytics/cohorts?granularity=fortnight")).status, 400);

    const scorecards = await ok("GET", "/analytics/scorecards", { expect: 200 });
    assert.equal(scorecards.scorecards.length, 3, "the referral agent has no pipeline to score");
    assert.ok(scorecards.scorecards[0].score >= scorecards.scorecards[1].score);

    const hygiene = await ok("GET", "/analytics/hygiene", { expect: 200 });
    assert.ok(Array.isArray(hygiene.stalled));
    assert.ok(Array.isArray(hygiene.slipped));
  });

  it("drives time-based transitions through the sweep endpoint", async () => {
    const before = await ok("POST", "/operations/expiry-sweep", { expect: 200 });
    assert.deepEqual(before.protectionExpired, []);

    const meridian = seeded.registrations["initech"];
    const detail = await ok("GET", `/deal-registrations/${meridian}`, { expect: 200 });
    clock.set(detail.protection.endsAt);

    const after = await ok("POST", "/operations/expiry-sweep", { expect: 200 });
    assert.ok(after.protectionExpired.length >= 1);
    const expired = await ok("GET", `/deal-registrations/${meridian}`, { expect: 200 });
    assert.equal(expired.status, "expired");
    assert.equal(expired.protectionStatus.protectedNow, false);
  });
});
