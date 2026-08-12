import { createTenantContext, money, type Email, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { ChannelContainer } from "./container.js";
import { addDays } from "../domain/protection.js";

/**
 * Demo data: a small security-software vendor's channel.
 *
 * The story it tells is the one the domain is built around — a gold reseller
 * registers a big deal and takes it through special pricing to a booked order,
 * a silver reseller walks into that protection and opens a conflict, a small
 * deal auto-approves, a referral agent introduces a customer and earns
 * commission, and one registration is left with days to run so the expiry
 * report has something to show.
 */

export interface SeedResult {
  readonly ctx: TenantContext;
  readonly partners: Readonly<Record<string, Ulid>>;
  readonly registrations: Readonly<Record<string, Ulid>>;
  readonly referrals: Readonly<Record<string, Ulid>>;
  readonly quotes: Readonly<Record<string, Ulid>>;
  readonly orders: Readonly<Record<string, Ulid>>;
  readonly conflicts: readonly Ulid[];
}

interface AdvanceableClock {
  advanceDays?(days: number): void;
}

export async function seedDemoData(container: ChannelContainer, tenant = "demo"): Promise<SeedResult> {
  const { services, clock } = container;
  const ctx = createTenantContext(tenant, "channel-ops", ["prm.admin"]);
  const partnerCtx = (user: string): TenantContext => createTenantContext(tenant, user, ["prm.partner"]);
  const advance = (days: number): void => (clock as AdvanceableClock).advanceDays?.(days);

  // --- partners ------------------------------------------------------------

  const northwind = await services.partner.create(ctx, {
    code: "NORTHWIND",
    name: "Northwind Technology Group",
    type: "reseller",
    tier: "gold",
    territories: ["NA", "EMEA"],
    productLines: ["network-security", "endpoint", "cloud-platform"],
    currency: "USD",
    contact: { name: "Dana Reyes", email: "dana.reyes@northwind.example" as Email },
  });
  const helios = await services.partner.create(ctx, {
    code: "HELIOS",
    name: "Helios Digital",
    type: "reseller",
    tier: "silver",
    territories: ["EMEA"],
    productLines: ["network-security", "cloud-platform"],
    currency: "USD",
    contact: { name: "Marek Nowak", email: "marek@heliosdigital.example" as Email },
  });
  const meridian = await services.partner.create(ctx, {
    code: "MERIDIAN",
    name: "Meridian Systems Integration",
    type: "system_integrator",
    tier: "platinum",
    territories: ["APAC", "NA"],
    productLines: ["network-security", "endpoint", "cloud-platform", "managed-services"],
    currency: "USD",
    contact: { name: "Wei Chen", email: "wei.chen@meridian.example" as Email },
  });
  const atlas = await services.partner.create(ctx, {
    code: "ATLAS-REF",
    name: "Atlas Advisory",
    type: "referral_agent",
    tier: "registered",
    territories: ["NA"],
    productLines: ["cloud-platform"],
    currency: "USD",
    contact: { name: "Priya Nair", email: "priya@atlasadvisory.example" as Email },
  });
  for (const partner of [northwind, helios, meridian, atlas]) {
    await services.partner.activate(ctx, partner.id);
  }

  // Globex is worked directly; partner registrations against it are refused.
  await services.conflict.addDirectClaim(ctx, {
    customerKey: "domain:globex.com",
    reason: "strategic account owned by the direct enterprise team",
  });

  // --- the flagship deal: Contoso, registered by Northwind -----------------

  const contoso = await services.registration.create(partnerCtx("dana.reyes"), {
    partnerId: northwind.id,
    endCustomer: { name: "Contoso Manufacturing", domain: "contoso.com", country: "US", city: "Cleveland" },
    productLines: ["network-security"],
    estimatedValue: money(25_000_000, "USD"),
    expectedCloseDate: addDays(clock.now(), 75),
    description: "Replacing an end-of-life firewall estate across 14 plants; incumbent contract expires in Q2.",
    competitors: ["Fortinet"],
  });
  await services.registration.submit(partnerCtx("dana.reyes"), contoso.id);
  await services.registration.startReview(ctx, contoso.id);
  await services.registration.approve(ctx, contoso.id, { notes: "Strong incumbent displacement case" });

  advance(6);

  // Helios walks into Northwind's protection: a conflict case is opened.
  const heliosContoso = await services.registration.create(partnerCtx("marek"), {
    partnerId: helios.id,
    endCustomer: { name: "Contoso Manufacturing GmbH", domain: "contoso.com", country: "DE" },
    productLines: ["network-security"],
    estimatedValue: money(4_000_000, "USD"),
    expectedCloseDate: addDays(clock.now(), 60),
    description: "European subsidiary asked us to quote the same firewall refresh for their Cologne site.",
  });
  const heliosSubmission = await services.registration.submit(partnerCtx("marek"), heliosContoso.id);
  for (const conflict of heliosSubmission.conflicts) {
    await services.conflict.addEvidence(partnerCtx("marek"), conflict.id, {
      source: "claimant",
      note: "Purchasing contact in Cologne asked us directly on 12 Jan; email thread attached.",
    });
    await services.conflict.addEvidence(partnerCtx("dana.reyes"), conflict.id, {
      source: "incumbent",
      note: "Global framework agreement is negotiated in Cleveland; Cologne is in scope of our proposal.",
    });
  }

  // --- a small deal that clears the auto-approval bar -----------------------

  const fabrikam = await services.registration.create(partnerCtx("dana.reyes"), {
    partnerId: northwind.id,
    endCustomer: { name: "Fabrikam AG", domain: "fabrikam.de", country: "DE" },
    productLines: ["endpoint"],
    estimatedValue: money(4_500_000, "USD"),
    expectedCloseDate: addDays(clock.now(), 40),
    description: "Endpoint agent rollout for 900 seats following a ransomware near-miss last quarter.",
  });
  await services.registration.submit(partnerCtx("dana.reyes"), fabrikam.id);

  // --- a platinum deal left running, close to losing protection ------------

  const initech = await services.registration.create(partnerCtx("wei.chen"), {
    partnerId: meridian.id,
    endCustomer: { name: "Initech Pte Ltd", domain: "initech.io", country: "SG" },
    productLines: ["cloud-platform", "managed-services"],
    estimatedValue: money(80_000_000, "USD"),
    expectedCloseDate: addDays(clock.now(), 120),
    description: "Platform consolidation programme across three ASEAN entities, managed service wrap included.",
  });
  await services.registration.submit(partnerCtx("wei.chen"), initech.id);
  await services.registration.approve(ctx, initech.id, { protectionDays: 120 });
  await services.registration.updateForecast(partnerCtx("wei.chen"), initech.id, { stage: "proposal" });

  // --- special pricing and the order that closes Contoso -------------------

  advance(10);

  const contosoQuote = await services.quote.create(partnerCtx("dana.reyes"), {
    partnerId: northwind.id,
    registrationId: contoso.id,
    notes: "Three-year term, 14 sites",
    lines: [
      {
        productLine: "network-security",
        sku: "NGFW-4400",
        description: "Next-gen firewall appliance",
        quantity: 14,
        listUnitPrice: money(1_200_000, "USD"),
        requestedUnitPrice: money(1_020_000, "USD"),
      },
      {
        productLine: "network-security",
        sku: "NGFW-SUB-3Y",
        description: "Threat prevention subscription, 3 years",
        quantity: 14,
        listUnitPrice: money(600_000, "USD"),
        requestedUnitPrice: money(510_000, "USD"),
      },
    ],
  });
  await services.quote.submit(partnerCtx("dana.reyes"), contosoQuote.id, { validityDays: 45 });
  await services.quote.approve(ctx, contosoQuote.id, {
    discountBps: 1_400,
    notes: "Approved at 14% against a 15% ask; volume justifies it",
    salesQuoteRef: { system: "sales-erp", id: "quo_contoso_001", number: "Q-004512" },
  });

  advance(8);

  const contosoOrder = await services.order.place(partnerCtx("dana.reyes"), {
    partnerId: northwind.id,
    channelQuoteId: contosoQuote.id,
    salesOrderRef: { system: "sales-erp", id: "so_contoso_001", number: "SO-009871" },
    poNumber: "PO-CONTOSO-77120",
  });
  await services.order.invoice(ctx, contosoOrder.id, { system: "finance-erp", id: "inv_contoso_001" });

  // --- referral: Atlas introduces Umbrella, Northwind transacts ------------

  const umbrella = await services.referral.submit(partnerCtx("priya"), {
    partnerId: atlas.id,
    contact: {
      name: "Sofia Marchetti",
      email: "sofia.marchetti@umbrella.example" as Email,
      title: "Director of Platform Engineering",
    },
    company: { name: "Umbrella Logistics", domain: "umbrella-logistics.com", country: "US" },
    productLines: ["cloud-platform"],
    estimatedValue: money(6_000_000, "USD"),
    notes: "Long-standing advisory client; migrating off a self-hosted stack this year.",
  });
  await services.referral.accept(ctx, umbrella.id, { attributionDays: 180 });
  const converted = await services.referral.convertToRegistration(ctx, umbrella.id, {
    estimatedValue: money(6_000_000, "USD"),
    expectedCloseDate: addDays(clock.now(), 90),
    description: "Cloud platform migration for a 400-site logistics operator, introduced by Atlas Advisory.",
    transactingPartnerId: northwind.id,
  });

  advance(15);

  await services.referral.markWon(ctx, umbrella.id, money(6_200_000, "USD"));
  await services.referral.approveCommission(ctx, umbrella.id);

  // --- a deal that was protected and lost ----------------------------------

  const acme = await services.registration.create(partnerCtx("marek"), {
    partnerId: helios.id,
    endCustomer: { name: "Acme Retail Group", domain: "acmeretail.eu", country: "NL" },
    productLines: ["cloud-platform"],
    estimatedValue: money(3_200_000, "USD"),
    expectedCloseDate: addDays(clock.now(), 30),
    description: "Store-level connectivity refresh tied to their 2026 point-of-sale programme.",
  });
  await services.registration.submit(partnerCtx("marek"), acme.id);
  await services.registration.approve(ctx, acme.id);
  advance(20);
  await services.registration.markLost(ctx, acme.id, {
    reason: "competitor",
    competitor: "Palo Alto Networks",
    notes: "Lost on bundled SASE pricing",
  });

  const conflicts = await services.conflict.list(ctx, {}, { pageSize: 50 });

  return {
    ctx,
    partners: {
      northwind: northwind.id,
      helios: helios.id,
      meridian: meridian.id,
      atlas: atlas.id,
    },
    registrations: {
      contoso: contoso.id,
      heliosContoso: heliosContoso.id,
      fabrikam: fabrikam.id,
      initech: initech.id,
      umbrella: converted.registration.id,
      acme: acme.id,
    },
    referrals: { umbrella: umbrella.id },
    quotes: { contoso: contosoQuote.id },
    orders: { contoso: contosoOrder.id },
    conflicts: conflicts.items.map((c) => c.id),
  };
}
