import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ATTRIBUTION_MODELS } from "../src/domain/attribution.js";
import { createDemoModule } from "../src/infrastructure/seed.js";

describe("demo seed", () => {
  const { module, seed } = createDemoModule();
  const { services } = module;
  const ctx = seed.ctx;

  it("seeds a coherent tenant", () => {
    assert.equal(module.repos.channels.list(ctx.tenantId).length, 5);
    assert.equal(module.repos.campaigns.list(ctx.tenantId).length, 2);
    assert.equal(module.repos.leads.list(ctx.tenantId).length, 6);
    assert.ok(module.repos.touchpoints.listAll(ctx.tenantId).length >= 10);
  });

  it("scoring pushed the two hot leads through the funnel to conversion", () => {
    const alice = module.repos.leads.getOrThrow(ctx.tenantId, seed.leadIds.alice);
    const bob = module.repos.leads.getOrThrow(ctx.tenantId, seed.leadIds.bob);
    assert.equal(alice.stage, "customer");
    assert.equal(alice.conversionValue?.amountMinor, 1_650_000);
    assert.equal(bob.stage, "opportunity");
    assert.equal(bob.conversionValue?.amountMinor, 800_000);
  });

  it("every attribution model conserves total conversion value", () => {
    const totalConversionValue = 1_650_000 + 800_000;
    for (const model of ATTRIBUTION_MODELS) {
      const report = services.attribution.report(ctx, model);
      assert.equal(report.totalRevenueMinor, totalConversionValue, `model ${model}`);
      const credited = report.byCampaign.reduce((sum, b) => sum + b.creditedMinor, 0);
      assert.equal(credited, totalConversionValue, `model ${model} lost credit`);
    }
  });

  it("first-touch concentrates credit while linear spreads it", () => {
    const first = services.attribution.report(ctx, "first_touch");
    const linear = services.attribution.report(ctx, "linear");
    const q3First = first.byCampaign.find((b) => b.key === seed.campaignIds.q3Launch)!;
    const q3Linear = linear.byCampaign.find((b) => b.key === seed.campaignIds.q3Launch)!;
    // Both converted journeys began on q3-launch, so first-touch gives it everything.
    assert.equal(q3First.creditedMinor, 2_450_000);
    assert.ok(
      q3Linear.creditedMinor < q3First.creditedMinor,
      "linear must share credit with later newsletter touches",
    );
  });

  it("computes campaign ROI with spend from the budget", () => {
    const roi = services.budgets.campaignRoi(ctx, seed.campaignIds.q3Launch, "linear");
    assert.equal(roi.budgetTotalMinor, 5_000_000);
    assert.equal(roi.spendMinor, 1_750_000);
    assert.ok(roi.attributedRevenueMinor > 0);
    assert.ok(roi.leads > 0);
    assert.ok(roi.conversions >= 2);
    assert.ok(roi.roas !== null && roi.roas > 0);
    assert.equal(roi.remainingMinor, 5_000_000 - 1_750_000);
  });

  it("portfolio rollup aggregates spend and revenue across campaigns", () => {
    const portfolio = services.budgets.portfolioRoi(ctx, "linear");
    assert.equal(portfolio.campaigns.length, 2);
    assert.equal(portfolio.totals.spendMinor, 1_750_000 + 120_000);
    assert.equal(portfolio.totals.attributedRevenueMinor, 2_450_000);
  });

  it("send job completed with the scripted stats", () => {
    const stats = services.sendJobs.stats(ctx, seed.sendJobId);
    assert.equal(stats.total, 5, "erin lacks consent and is not in the audience");
    assert.equal(stats.delivered, 4);
    assert.equal(stats.bounced, 1);
    assert.equal(stats.opened, 3);
    assert.equal(stats.clicked, 2);
    assert.equal(stats.sent, stats.delivered + stats.bounced);
    assert.equal(stats.openRate, 3 / 4);
    assert.equal(stats.clickRate, 2 / 4);
  });

  it("email engagement produced newsletter touchpoints on alice's journey", () => {
    const aliceTouches = module.repos.touchpoints.listByLead(ctx.tenantId, seed.leadIds.alice);
    const newsletterTouches = aliceTouches.filter(
      (t) => t.campaignId === seed.campaignIds.newsletter,
    );
    assert.equal(newsletterTouches.length, 2, "one open + one click");
  });

  it("funnel snapshot reflects the seeded stages", () => {
    const funnel = services.leads.funnel(ctx);
    assert.equal(funnel.countsByStage.customer, 1);
    assert.equal(funnel.countsByStage.opportunity, 1);
    assert.ok(funnel.totalActive >= 5);
    assert.ok(funnel.mqlRate !== null && funnel.mqlRate > 0);
  });

  it("tracked link recorded clicks and touchpoints", () => {
    const link = services.trackedLinks.getByCode(ctx, seed.trackedLinkCode)!;
    assert.equal(link.clickCount, 3);
    const aliceTouches = module.repos.touchpoints.listByLead(ctx.tenantId, seed.leadIds.alice);
    assert.ok(aliceTouches.some((t) => t.touchType === "click"));
  });

  it("outbox holds ordered domain events for every seeded action", () => {
    const pending = module.outbox.pending();
    assert.ok(pending.length > 30, `expected a rich event stream, got ${pending.length}`);
    let dispatched = 0;
    module.outbox.subscribe("*", () => {
      dispatched += 1;
    });
    assert.equal(module.outbox.dispatchPending(), pending.length);
    assert.equal(dispatched, pending.length);
    assert.equal(module.outbox.pending().length, 0);
  });
});
