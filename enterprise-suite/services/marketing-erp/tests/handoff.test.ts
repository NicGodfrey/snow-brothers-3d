import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTenantContext } from "@enterprise-suite/shared-kernel";
import { MarketingEvents } from "../src/domain/events.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { createMarketingModule, type MarketingModule } from "../src/infrastructure/container.js";

const ctx = createTenantContext("t_handoff", "user_test", ["admin"]);

function setup(): { module: MarketingModule; clock: FixedClock } {
  const clock = new FixedClock("2026-08-01T00:00:00.000Z");
  const module = createMarketingModule({ clock });
  return { module, clock };
}

function qualifiedLead(module: MarketingModule, clock: FixedClock) {
  const { services } = module;
  const campaign = services.campaigns.create(ctx, {
    name: "Q3 Launch",
    code: "q3-launch",
    objective: "acquisition",
  });
  const webinarChannel = services.channels.create(ctx, {
    name: "Webinars",
    code: "webinars",
    kind: "webinar",
    costModel: "flat",
    unitCostMinor: 0,
    currency: "USD",
  });

  const lead = services.leads.capture(ctx, {
    email: "buyer@bigco.com",
    source: "landing_page",
    firstName: "Bea",
    lastName: "Buyer",
    company: "BigCo",
    jobTitle: "VP Procurement",
    industry: "manufacturing",
    companySize: 900,
    consentEmail: true,
    utm: { source: "google", medium: "cpc", campaign: "q3-launch" },
  });
  clock.advanceDays(1);
  services.leads.recordActivity(ctx, lead.id, {
    type: "webinar_attend",
    campaignId: campaign.id,
    channelId: webinarChannel.id,
  });
  clock.advanceDays(1);
  services.leads.recordActivity(ctx, lead.id, { type: "demo_request", campaignId: campaign.id });
  services.leads.recordActivity(ctx, lead.id, { type: "pricing_view", campaignId: campaign.id });
  services.scoring.rescoreLead(ctx, lead.id);
  return { lead, campaign };
}

describe("Lead -> Opportunity handoff", () => {
  it("scoring promotes the lead to SQL first", () => {
    const { module, clock } = setup();
    const { lead } = qualifiedLead(module, clock);
    assert.equal(module.repos.leads.getOrThrow(ctx.tenantId, lead.id).stage, "sql");
  });

  it("produces a complete handoff DTO with attribution slices", () => {
    const { module, clock } = setup();
    const { lead, campaign } = qualifiedLead(module, clock);

    const dto = module.services.handoff.handOff(ctx, lead.id, {
      estimatedValueMinor: 2_000_000,
      currency: "USD",
      attributionModel: "linear",
      notes: "wants Q4 rollout",
      suggestedOwnerUserId: "user_sales_1",
    });

    assert.equal(dto.kind, "marketing.lead-opportunity-handoff");
    assert.equal(dto.schemaVersion, 1);
    assert.equal(dto.tenantId, "t_handoff");
    assert.equal(dto.contact.fullName, "Bea Buyer");
    assert.equal(dto.company?.name, "BigCo");
    assert.equal(dto.qualification.stageAtHandoff, "sql");
    assert.ok(dto.qualification.score >= 70, `score ${dto.qualification.score} should be SQL-grade`);
    assert.equal(dto.estimatedValue.amountMinor, 2_000_000);
    assert.equal(dto.sourceCampaign?.code, "q3-launch");
    assert.equal(dto.suggestedOwnerUserId, "user_sales_1");

    // 4 touchpoints (capture form + webinar + demo form + pricing visit), all q3-launch.
    assert.equal(dto.attribution.touchpointCount, 4);
    const totalCredited = dto.attribution.slices.reduce(
      (sum, s) => sum + s.credited.amountMinor,
      0,
    );
    assert.equal(totalCredited, 2_000_000, "attribution must conserve the estimated value");
    assert.ok(dto.attribution.slices.every((s) => s.campaignId === campaign.id || !s.campaignId));

    // The lead is now an opportunity and the integration event is in the outbox.
    assert.equal(module.repos.leads.getOrThrow(ctx.tenantId, lead.id).stage, "opportunity");
    const events = module.outbox.ofType(MarketingEvents.LeadHandedOff);
    assert.equal(events.length, 1);
    const payload = events[0]!.payload as { email: string; estimatedValue: { amountMinor: number } };
    assert.equal(payload.email, "buyer@bigco.com");
    assert.equal(payload.estimatedValue.amountMinor, 2_000_000);
  });

  it("rejects handoff for leads that are not SQL", () => {
    const { module } = setup();
    const lead = module.services.leads.capture(ctx, {
      email: "cold@nowhere.com",
      source: "import",
    });
    assert.throws(
      () =>
        module.services.handoff.handOff(ctx, lead.id, {
          estimatedValueMinor: 100,
          currency: "USD",
        }),
      /Only SQL leads/,
    );
  });

  it("acknowledgement tags the lead and rejects unknown handoffs", () => {
    const { module, clock } = setup();
    const { lead } = qualifiedLead(module, clock);
    module.services.handoff.handOff(ctx, lead.id, {
      estimatedValueMinor: 500_000,
      currency: "USD",
    });
    const acked = module.services.handoff.acknowledge(ctx, {
      kind: "sales.handoff-acknowledgement",
      schemaVersion: 1,
      tenantId: "t_handoff",
      leadId: lead.id,
      accepted: true,
      opportunityId: "opp_123",
      acknowledgedAt: "2026-08-04T00:00:00.000Z",
    });
    assert.ok(acked.tags.includes("handoff-accepted"));

    const fresh = module.services.leads.capture(ctx, { email: "fresh@x.io", source: "import" });
    assert.throws(
      () =>
        module.services.handoff.acknowledge(ctx, {
          kind: "sales.handoff-acknowledgement",
          schemaVersion: 1,
          tenantId: "t_handoff",
          leadId: fresh.id,
          accepted: false,
          rejectionReason: "not a fit",
          acknowledgedAt: "2026-08-04T00:00:00.000Z",
        }),
      /no outstanding handoff/,
    );
  });

  it("recordDealWon closes the loop with the actual value", () => {
    const { module, clock } = setup();
    const { lead } = qualifiedLead(module, clock);
    module.services.handoff.handOff(ctx, lead.id, {
      estimatedValueMinor: 500_000,
      currency: "USD",
    });
    clock.advanceDays(5);
    const customer = module.services.handoff.recordDealWon(ctx, lead.id, 750_000, "USD");
    assert.equal(customer.stage, "customer");
    assert.equal(customer.conversionValue?.amountMinor, 750_000);
    assert.equal(module.outbox.ofType(MarketingEvents.LeadConverted).length, 1);
  });
});
