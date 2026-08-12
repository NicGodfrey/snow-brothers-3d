import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, tenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { Lead } from "../src/domain/lead.js";
import { defaultScoringModel, gradeForScore, ScoringModel } from "../src/domain/lead-scoring.js";

const tenant = tenantId("t_scoring");
const at = (iso: string): IsoDateTime => brand<string, "IsoDateTime">(iso);

function makeLead(overrides?: Partial<Parameters<typeof Lead.capture>[0]>): Lead {
  return Lead.capture({
    tenantId: tenant,
    email: "scoring@example.com",
    source: "web_form",
    capturedAt: at("2026-08-01T00:00:00.000Z"),
    ...overrides,
  });
}

describe("gradeForScore", () => {
  it("bands scores into A-D", () => {
    assert.equal(gradeForScore(95), "A");
    assert.equal(gradeForScore(80), "A");
    assert.equal(gradeForScore(79), "B");
    assert.equal(gradeForScore(55), "B");
    assert.equal(gradeForScore(54), "C");
    assert.equal(gradeForScore(30), "C");
    assert.equal(gradeForScore(29), "D");
    assert.equal(gradeForScore(0), "D");
  });
});

describe("ScoringModel", () => {
  it("rejects inverted thresholds", () => {
    assert.throws(
      () =>
        ScoringModel.create({
          tenantId: tenant,
          name: "bad",
          activityWeights: [],
          mqlThreshold: 80,
          sqlThreshold: 40,
        }),
      /mqlThreshold/,
    );
  });

  it("scores fresh activities at full weight", () => {
    const model = defaultScoringModel(tenant);
    const lead = makeLead();
    const now = new Date("2026-08-01T01:00:00.000Z");
    lead.recordActivity({ type: "demo_request", occurredAt: at("2026-08-01T00:30:00.000Z") });
    const breakdown = model.computeScore(lead, now);
    // 30 points, ~0 decay
    assert.ok(breakdown.activityPoints > 29.9 && breakdown.activityPoints <= 30);
  });

  it("halves activity points after one half-life", () => {
    const model = ScoringModel.create({
      tenantId: tenant,
      name: "decay test",
      activityWeights: [{ activity: "form_submit", points: 20 }],
      halfLifeDays: 14,
    });
    const lead = makeLead();
    lead.recordActivity({ type: "form_submit", occurredAt: at("2026-08-01T00:00:00.000Z") });
    const breakdown = model.computeScore(lead, new Date("2026-08-15T00:00:00.000Z"));
    assert.ok(Math.abs(breakdown.activityPoints - 10) < 0.01);
  });

  it("adds stable demographic fit points", () => {
    const model = defaultScoringModel(tenant);
    const lead = makeLead({
      jobTitle: "VP of Marketing",
      companySize: 500,
      industry: "saas",
    });
    const breakdown = model.computeScore(lead, new Date("2026-09-30T00:00:00.000Z"));
    // No activities: only demographics. vp(10) + size>=200(10) + saas(6)
    assert.equal(breakdown.activityPoints, 0);
    assert.equal(breakdown.demographicPoints, 26);
    assert.equal(breakdown.total, 26);
    assert.equal(breakdown.matchedDemographicRules.length, 3);
  });

  it("caps the total at 100", () => {
    const model = ScoringModel.create({
      tenantId: tenant,
      name: "cap test",
      activityWeights: [{ activity: "demo_request", points: 90 }],
      demographicRules: [{ field: "industry", op: "eq", value: "saas", points: 50 }],
    });
    const lead = makeLead({ industry: "saas" });
    lead.recordActivity({ type: "demo_request", occurredAt: at("2026-08-01T00:00:00.000Z") });
    const breakdown = model.computeScore(lead, new Date("2026-08-01T00:00:01.000Z"));
    assert.equal(breakdown.total, 100);
  });

  it("suggests funnel stages from thresholds", () => {
    const model = defaultScoringModel(tenant); // mql 40 / sql 70
    assert.equal(model.stageSuggestion(10), "none");
    assert.equal(model.stageSuggestion(40), "mql");
    assert.equal(model.stageSuggestion(69), "mql");
    assert.equal(model.stageSuggestion(70), "sql");
  });
});
