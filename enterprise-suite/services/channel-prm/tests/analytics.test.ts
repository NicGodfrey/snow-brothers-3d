import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money } from "@enterprise-suite/shared-kernel";
import { ChannelEventTypes } from "../src/domain/events.js";
import { DEFAULT_TIER_POLICIES } from "../src/domain/partner.js";
import { addDays } from "../src/domain/protection.js";
import { eventsOfType, makeApprovedRegistration, makePartner, makeRegistration, usd, world, type TestWorld } from "./helpers.js";

const GOLD = DEFAULT_TIER_POLICIES.gold;

/**
 * A small channel: two resellers, a won deal with an order, an open deal, a
 * lost deal, and an unregistered order. Enough for every roll-up to have
 * something non-trivial to say.
 */
async function channel(w: TestWorld) {
  const northwind = await makePartner(w, { code: "NORTHWIND", tier: "gold" });
  const helios = await makePartner(w, { code: "HELIOS", tier: "silver", territories: ["EMEA"] });

  const won = await makeApprovedRegistration(w, northwind, { value: usd(20_000_000) });
  await w.container.services.registration.updateForecast(w.ctx, won.id, { stage: "negotiation" });
  w.clock.advanceDays(30);
  await w.container.services.order.place(w.ctx, {
    partnerId: northwind.id,
    registrationId: won.id,
    salesOrderRef: { system: "sales-erp", id: "so_won" },
    netValue: usd(19_000_000),
  });

  const open = await makeApprovedRegistration(w, northwind, {
    customerName: "Fabrikam AG",
    domain: "fabrikam.de",
    country: "DE",
    value: usd(8_000_000),
  });
  await w.container.services.registration.updateForecast(w.ctx, open.id, { stage: "proposal" });

  const lost = await makeApprovedRegistration(w, helios, {
    customerName: "Acme Retail",
    domain: "acmeretail.eu",
    country: "NL",
    value: usd(3_000_000),
  });
  await w.container.services.registration.markLost(w.ctx, lost.id, { reason: "price" });

  await w.container.services.order.place(w.ctx, {
    partnerId: helios.id,
    salesOrderRef: { system: "sales-erp", id: "so_direct" },
    netValue: usd(1_000_000),
    sourceType: "vendor_sourced",
    customerKey: "domain:initech.io",
    customerName: "Initech",
  });

  return { northwind, helios, won, open, lost };
}

describe("analytics over live aggregates", () => {
  it("projects open pipeline by stage in the tenant's dominant currency", async () => {
    const w = world();
    const { open } = await channel(w);
    const report = await w.container.services.analytics.pipelineByStage(w.ctx);

    assert.equal(report.currency, "USD");
    assert.equal(report.openCount, 1, "won and lost deals leave the pipeline");
    assert.deepEqual(report.openValue, usd(8_000_000));
    const proposal = report.buckets.find((b) => b.stage === "proposal")!;
    assert.equal(proposal.count, 1);
    assert.deepEqual(proposal.weightedValue, usd(4_000_000));
    assert.equal(open.probability, 50);
  });

  it("reports per-partner performance and rolls it up by tier", async () => {
    const w = world();
    const { northwind, helios } = await channel(w);
    const report = await w.container.services.analytics.pipelineByPartner(w.ctx);

    const gold = report.partners.find((p) => p.partnerId === northwind.id)!;
    assert.equal(gold.tier, "gold");
    assert.equal(gold.wonCount, 1);
    assert.equal(gold.lostCount, 0);
    assert.equal(gold.winRateBps, 10_000);
    assert.equal(gold.approvalRateBps, 10_000);
    assert.deepEqual(gold.bookedValue, usd(19_000_000));
    assert.deepEqual(gold.openValue, usd(8_000_000));

    const silver = report.partners.find((p) => p.partnerId === helios.id)!;
    assert.equal(silver.winRateBps, 0);
    assert.deepEqual(silver.bookedValue, usd(1_000_000));

    const tiers = await w.container.services.analytics.pipelineByTier(w.ctx);
    assert.deepEqual(tiers.map((t) => t.tier).sort(), ["gold", "silver"]);
  });

  it("splits sourced from vendor-sourced revenue", async () => {
    const w = world();
    await channel(w);
    const split = await w.container.services.analytics.sourceSplit(w.ctx);
    assert.deepEqual(split.partnerSourced, usd(19_000_000));
    assert.deepEqual(split.vendorSourced, usd(1_000_000));
    assert.equal(split.partnerSourcedShareBps, 9_500);
  });

  it("reports what protection is about to lapse", async () => {
    const w = world();
    const { open } = await channel(w);
    // Wind the clock to a week before the open deal's window closes.
    w.clock.set(addDays(open.protection!.endsAt, -5));
    const report = await w.container.services.analytics.protectionExpiry(w.ctx);

    assert.deepEqual(report.buckets.find((b) => b.label === "0-7d")!.registrationNumbers, [open.number]);
    assert.deepEqual(report.atRiskValue, usd(8_000_000));
  });

  it("scores partners and names the conflicts against them", async () => {
    const w = world();
    const { northwind, helios } = await channel(w);
    // Helios walks into Northwind's protected Fabrikam deal.
    const contested = await makeRegistration(w, helios, {
      customerName: "Fabrikam AG",
      domain: "fabrikam.de",
      country: "DE",
      productLines: ["network-security"],
      value: usd(1_000_000),
    });
    await w.container.services.registration.submit(w.ctx, contested.id);

    const scorecards = await w.container.services.analytics.scorecards(w.ctx);
    const gold = scorecards.find((s) => s.partnerId === northwind.id)!;
    const silver = scorecards.find((s) => s.partnerId === helios.id)!;

    assert.equal(gold.conflictCount, 1, "the incumbent is a party to the case too");
    assert.equal(silver.conflictCount, 1);
    assert.ok(gold.score > silver.score, "the partner delivering revenue scores higher");
    assert.equal(gold.components.reduce((sum, c) => sum + c.max, 0), 100);
  });

  it("cohorts by submission period and follows the funnel end to end", async () => {
    const w = world();
    await channel(w);
    const cohorts = await w.container.services.analytics.cohorts(w.ctx, "month");
    assert.deepEqual(cohorts.map((c) => c.period), ["2026-01"]);
    assert.equal(cohorts[0]!.registrations, 3);
    assert.equal(cohorts[0]!.won, 1);
    assert.equal(cohorts[0]!.lost, 1);
    assert.equal(cohorts[0]!.open, 1);

    const funnel = await w.container.services.analytics.funnel(w.ctx);
    const steps = Object.fromEntries(funnel.steps.map((s) => [s.step, s.count]));
    assert.equal(steps["registrations_submitted"], 3);
    assert.equal(steps["registrations_approved"], 3);
    assert.equal(steps["deals_ordered"], 2);
    assert.equal(steps["deals_won"], 1);
  });

  it("filters a report down to one partner", async () => {
    const w = world();
    const { helios } = await channel(w);
    const report = await w.container.services.analytics.pipelineByPartner(w.ctx, { partnerId: helios.id });
    assert.equal(report.partners.length, 1);
    assert.equal(report.partners[0]!.partnerId, helios.id);
  });

  it("names the stalled and slipped deals a channel manager has to chase", async () => {
    const w = world();
    const { open } = await channel(w);
    w.clock.advanceDays(30);
    const hygiene = await w.container.services.analytics.hygiene(w.ctx);
    assert.deepEqual(hygiene.stalled.map((d) => d.number), [open.number]);
    assert.ok(hygiene.stalled[0]!.idleDays > hygiene.stalled[0]!.thresholdDays);
    assert.deepEqual(hygiene.slipped, [], "nothing is past its close date yet");

    w.clock.advanceDays(90);
    const later = await w.container.services.analytics.hygiene(w.ctx);
    assert.deepEqual(later.slipped.map((d) => d.number), [open.number]);
  });

  it("reports in an explicitly requested currency, excluding the rest", async () => {
    const w = world();
    await channel(w);
    const report = await w.container.services.analytics.pipelineByStage(w.ctx, { currency: "EUR" });
    assert.equal(report.currency, "EUR");
    assert.equal(report.openCount, 0);
    assert.ok(report.excludedByCurrency > 0);
    assert.deepEqual(report.openValue, money(0, "EUR"));
  });
});

describe("the expiry sweep", () => {
  it("warns once before a window lapses, then expires it once", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeApprovedRegistration(w, partner);

    const quiet = await w.container.services.expiry.sweep(w.ctx);
    assert.deepEqual(quiet.protectionWarned, []);
    assert.deepEqual(quiet.protectionExpired, []);

    w.clock.advanceDays(GOLD.protectionDays - 3);
    const warning = await w.container.services.expiry.sweep(w.ctx);
    assert.deepEqual(warning.protectionWarned, [registration.number]);
    const repeated = await w.container.services.expiry.sweep(w.ctx);
    assert.deepEqual(repeated.protectionWarned, [], "one warning per window");

    w.clock.advanceDays(5);
    const lapsed = await w.container.services.expiry.sweep(w.ctx);
    assert.deepEqual(lapsed.protectionExpired, [registration.number]);
    assert.equal(registration.status, "expired");
    assert.deepEqual((await w.container.services.expiry.sweep(w.ctx)).protectionExpired, []);
    assert.equal(eventsOfType(w, ChannelEventTypes.DealRegistrationProtectionExpiring).length, 1);
    assert.equal(eventsOfType(w, ChannelEventTypes.DealRegistrationExpired).length, 1);
  });

  it("clears a stale warning when protection is extended", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeApprovedRegistration(w, partner);
    w.clock.advanceDays(GOLD.protectionDays - 3);
    await w.container.services.expiry.sweep(w.ctx);
    assert.ok(registration.expiryWarnedAt);

    await w.container.services.registration.extendProtection(w.ctx, registration.id, {
      days: 45,
      reason: "the customer moved the decision to the next budget cycle",
    });
    assert.equal(registration.expiryWarnedAt, undefined);

    w.clock.advanceDays(42);
    const warning = await w.container.services.expiry.sweep(w.ctx);
    assert.deepEqual(warning.protectionWarned, [registration.number], "the new window earns its own warning");
  });

  it("sweeps referrals, quotes and overdue conflicts in one pass", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold", productLines: ["network-security", "endpoint", "cloud-platform"] });
    const agent = await makePartner(w, {
      code: "ATLAS-REF",
      type: "referral_agent",
      productLines: ["cloud-platform"],
    });
    const referral = await w.container.services.referral.submit(w.ctx, {
      partnerId: agent.id,
      contact: { name: "Sofia Marchetti", email: "sofia@umbrella-logistics.com" as never },
      company: { name: "Umbrella Logistics", domain: "umbrella-logistics.com", country: "US" },
      productLines: ["cloud-platform"],
    });
    const registration = await makeApprovedRegistration(w, partner);
    const quote = await w.container.services.quote.create(w.ctx, {
      partnerId: partner.id,
      registrationId: registration.id,
      lines: [{ productLine: "network-security", quantity: 1, listUnitPrice: usd(1_000_000) }],
    });
    await w.container.services.quote.submit(w.ctx, quote.id, { validityDays: 15 });

    w.clock.advanceDays(20);
    const summary = await w.container.services.expiry.sweep(w.ctx);
    assert.deepEqual(summary.referralsExpired, [referral.number]);
    assert.deepEqual(summary.quotesExpired, [quote.number]);
    assert.equal(summary.at, w.clock.now());
  });
});
