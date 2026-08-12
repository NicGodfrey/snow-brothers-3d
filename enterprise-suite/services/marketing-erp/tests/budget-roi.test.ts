import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, money, newId, tenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { CampaignBudget, computeRoiMetrics } from "../src/domain/budget.js";
import { MarketingEvents } from "../src/domain/events.js";

const tenant = tenantId("t_budget");
const at = (iso: string): IsoDateTime => brand<string, "IsoDateTime">(iso);
const t0 = at("2026-08-01T00:00:00.000Z");

function makeBudget(totalMinor = 100_000, allowOverspend = false): CampaignBudget {
  return CampaignBudget.create({
    tenantId: tenant,
    campaignId: newId("campaign"),
    total: money(totalMinor, "USD"),
    warnThreshold: 0.8,
    allowOverspend,
  });
}

describe("CampaignBudget", () => {
  it("tracks spend, remaining and utilization", () => {
    const budget = makeBudget(100_000);
    budget.recordSpend({ amount: money(30_000, "USD"), category: "media", occurredAt: t0 });
    budget.recordSpend({ amount: money(20_000, "USD"), category: "agency", occurredAt: t0 });
    assert.equal(budget.totalSpend().amountMinor, 50_000);
    assert.equal(budget.remaining().amountMinor, 50_000);
    assert.equal(budget.utilization(), 0.5);
  });

  it("groups spend by channel and category", () => {
    const budget = makeBudget(100_000);
    const search = newId("channel");
    budget.recordSpend({ amount: money(10_000, "USD"), category: "media", occurredAt: t0, channelId: search });
    budget.recordSpend({ amount: money(5_000, "USD"), category: "media", occurredAt: t0, channelId: search });
    budget.recordSpend({ amount: money(2_000, "USD"), category: "tools", occurredAt: t0 });

    assert.equal(budget.spendByChannel().get(search)?.amountMinor, 15_000);
    assert.equal(budget.spendByChannel().get("cross-channel")?.amountMinor, 2_000);
    assert.equal(budget.spendByCategory().get("media")?.amountMinor, 15_000);
    assert.equal(budget.spendByCategory().get("tools")?.amountMinor, 2_000);
  });

  it("blocks overspend unless explicitly allowed", () => {
    const strict = makeBudget(10_000);
    assert.throws(
      () => strict.recordSpend({ amount: money(10_001, "USD"), category: "media", occurredAt: t0 }),
      /exceed budget/,
    );
    const flexible = makeBudget(10_000, true);
    flexible.recordSpend({ amount: money(15_000, "USD"), category: "media", occurredAt: t0 });
    assert.equal(flexible.utilization(), 1.5);
  });

  it("rejects currency mismatches and non-positive amounts", () => {
    const budget = makeBudget();
    assert.throws(
      () => budget.recordSpend({ amount: money(1_000, "EUR"), category: "media", occurredAt: t0 }),
      /currency/,
    );
    assert.throws(
      () => budget.recordSpend({ amount: money(0, "USD"), category: "media", occurredAt: t0 }),
      /positive/,
    );
  });

  it("fires a threshold event exactly once when crossing the warn line", () => {
    const budget = makeBudget(100_000);
    budget.pullEvents();
    budget.recordSpend({ amount: money(79_000, "USD"), category: "media", occurredAt: t0 });
    let types = budget.pullEvents().map((e) => e.eventType);
    assert.ok(!types.includes(MarketingEvents.BudgetThresholdBreached));

    budget.recordSpend({ amount: money(2_000, "USD"), category: "media", occurredAt: t0 });
    types = budget.pullEvents().map((e) => e.eventType);
    assert.ok(types.includes(MarketingEvents.BudgetThresholdBreached));

    budget.recordSpend({ amount: money(1_000, "USD"), category: "media", occurredAt: t0 });
    types = budget.pullEvents().map((e) => e.eventType);
    assert.ok(!types.includes(MarketingEvents.BudgetThresholdBreached), "must not re-fire");
  });

  it("cannot shrink the budget below recorded spend", () => {
    const budget = makeBudget(100_000);
    budget.recordSpend({ amount: money(60_000, "USD"), category: "media", occurredAt: t0 });
    assert.throws(() => budget.adjustTotal(money(50_000, "USD"), "cuts"), /below already-recorded/);
    budget.adjustTotal(money(80_000, "USD"), "reduced scope");
    assert.equal(budget.total.amountMinor, 80_000);
  });
});

describe("computeRoiMetrics", () => {
  it("computes roi, roas, cpl, cpa and conversion rate", () => {
    const metrics = computeRoiMetrics({
      spendMinor: 100_000,
      attributedRevenueMinor: 350_000,
      leads: 50,
      conversions: 5,
    });
    assert.equal(metrics.roi, 2.5);
    assert.equal(metrics.roas, 3.5);
    assert.equal(metrics.costPerLeadMinor, 2_000);
    assert.equal(metrics.costPerAcquisitionMinor, 20_000);
    assert.equal(metrics.conversionRate, 0.1);
  });

  it("degrades to nulls on zero denominators instead of dividing by zero", () => {
    const metrics = computeRoiMetrics({
      spendMinor: 0,
      attributedRevenueMinor: 0,
      leads: 0,
      conversions: 0,
    });
    assert.equal(metrics.roi, null);
    assert.equal(metrics.roas, null);
    assert.equal(metrics.costPerLeadMinor, null);
    assert.equal(metrics.costPerAcquisitionMinor, null);
    assert.equal(metrics.conversionRate, null);
  });

  it("rejects negative inputs", () => {
    assert.throws(
      () =>
        computeRoiMetrics({ spendMinor: -1, attributedRevenueMinor: 0, leads: 0, conversions: 0 }),
      /negative/,
    );
  });
});
