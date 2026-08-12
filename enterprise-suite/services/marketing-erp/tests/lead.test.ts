import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, money, tenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { MarketingEvents } from "../src/domain/events.js";
import { assertLeadSource, Lead } from "../src/domain/lead.js";

const tenant = tenantId("t_leads");
const at = (iso: string): IsoDateTime => brand<string, "IsoDateTime">(iso);
const t0 = at("2026-08-01T00:00:00.000Z");

function capture(overrides?: Partial<Parameters<typeof Lead.capture>[0]>): Lead {
  return Lead.capture({
    tenantId: tenant,
    email: "Jane.Doe@Example.COM",
    source: "web_form",
    capturedAt: t0,
    consentEmail: true,
    ...overrides,
  });
}

describe("Lead capture", () => {
  it("normalizes the email and starts as subscriber", () => {
    const lead = capture();
    assert.equal(lead.email, "jane.doe@example.com");
    assert.equal(lead.stage, "subscriber");
    assert.equal(lead.score, 0);
    assert.equal(lead.grade, "D");
    const events = lead.pullEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, MarketingEvents.LeadCaptured);
  });

  it("rejects malformed emails", () => {
    assert.throws(() => capture({ email: "not-an-email" }), /Invalid email/);
  });

  it("rejects unknown sources at the boundary helper", () => {
    assert.throws(() => assertLeadSource("carrier_pigeon"), /Unknown lead source/);
    assert.equal(assertLeadSource("webinar"), "webinar");
  });
});

describe("Lead stage machine", () => {
  it("promotes subscriber to lead on first meaningful activity", () => {
    const lead = capture();
    lead.recordActivity({ type: "form_submit", occurredAt: at("2026-08-01T01:00:00.000Z") });
    assert.equal(lead.stage, "lead");
  });

  it("page views alone do not promote", () => {
    const lead = capture();
    lead.recordActivity({ type: "page_view", occurredAt: at("2026-08-01T01:00:00.000Z") });
    assert.equal(lead.stage, "subscriber");
  });

  it("follows lead -> mql -> sql -> opportunity -> customer", () => {
    const lead = capture();
    lead.promoteToLead();
    lead.markMql();
    lead.markSql();
    lead.handOff(money(50_000, "USD"), at("2026-08-02T00:00:00.000Z"));
    assert.equal(lead.stage, "opportunity");
    assert.ok(lead.isConverted);
    lead.markCustomer(money(60_000, "USD"), at("2026-08-10T00:00:00.000Z"));
    assert.equal(lead.stage, "customer");
    assert.equal(lead.conversionValue?.amountMinor, 60_000);
  });

  it("blocks skipping stages", () => {
    const lead = capture();
    assert.throws(() => lead.markSql(), /cannot transition/i);
  });

  it("only SQL leads can be handed off", () => {
    const lead = capture();
    lead.promoteToLead();
    assert.throws(() => lead.handOff(money(1_000, "USD"), t0), /Only SQL leads/);
  });

  it("handoff requires a positive estimated value", () => {
    const lead = capture();
    lead.promoteToLead();
    lead.markMql();
    lead.markSql();
    assert.throws(() => lead.handOff(money(0, "USD"), t0), /positive/);
  });

  it("disqualification blocks activity and can be reversed", () => {
    const lead = capture();
    lead.promoteToLead();
    lead.disqualify("competitor employee");
    assert.equal(lead.stage, "disqualified");
    assert.throws(
      () => lead.recordActivity({ type: "form_submit", occurredAt: t0 }),
      /disqualified/,
    );
    lead.requalify();
    assert.equal(lead.stage, "lead");
  });

  it("customers cannot be disqualified", () => {
    const lead = capture();
    lead.promoteToLead();
    lead.markMql();
    lead.markSql();
    lead.handOff(money(1_000, "USD"), t0);
    lead.markCustomer(money(1_000, "USD"), t0);
    assert.throws(() => lead.disqualify("nope"), /customer/i);
  });
});

describe("Lead consent", () => {
  it("tracks channel consent and emits change events", () => {
    const lead = capture({ consentEmail: true, consentSms: false });
    lead.pullEvents();
    assert.ok(lead.canReceive("email"));
    assert.ok(!lead.canReceive("sms"));

    lead.setConsent("email", false, at("2026-08-02T00:00:00.000Z"));
    assert.ok(!lead.canReceive("email"));
    const events = lead.pullEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, MarketingEvents.LeadConsentChanged);
  });

  it("setting the same consent twice is a no-op", () => {
    const lead = capture({ consentEmail: true });
    lead.pullEvents();
    lead.setConsent("email", true, at("2026-08-02T00:00:00.000Z"));
    assert.equal(lead.pullEvents().length, 0);
  });

  it("unsubscribeAll revokes both channels", () => {
    const lead = capture({ consentEmail: true, consentSms: true });
    lead.unsubscribeAll(at("2026-08-02T00:00:00.000Z"));
    assert.ok(!lead.canReceive("email"));
    assert.ok(!lead.canReceive("sms"));
  });
});

describe("Lead tags and enrichment", () => {
  it("normalizes and dedupes tags", () => {
    const lead = capture();
    lead.addTag("  VIP ");
    lead.addTag("vip");
    assert.deepEqual([...lead.tags], ["vip"]);
    lead.removeTag("VIP");
    assert.deepEqual([...lead.tags], []);
  });

  it("enrich updates firmographics", () => {
    const lead = capture();
    lead.enrich({ company: "Acme Corp", industry: "SaaS", companySize: 250, country: "de" });
    const view = lead.view();
    assert.equal(view.company, "Acme Corp");
    assert.equal(view.industry, "saas");
    assert.equal(view.country, "DE");
  });
});
