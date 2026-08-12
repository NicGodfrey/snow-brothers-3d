/**
 * Sample computation walkthrough: seeds the demo tenant, then prints
 * attribution model comparisons, campaign ROI rollups, the funnel snapshot,
 * and send-job stats. Run with: npm run demo
 */
import { createDemoModule } from "./infrastructure/seed.js";

const { module, seed } = createDemoModule();
const { services } = module;
const ctx = seed.ctx;

const dollars = (minor: number): string => `$${(minor / 100).toFixed(2)}`;
const pct = (value: number | null): string =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;

console.log("=== Attribution: model comparison over converted leads ===");
const comparison = services.attribution.compareModels(ctx);
for (const [model, report] of Object.entries(comparison)) {
  console.log(`\n${model} — total attributed revenue ${dollars(report.totalRevenueMinor)}:`);
  for (const bucket of report.byCampaign) {
    const campaign = module.repos.campaigns.findById(ctx.tenantId, bucket.key);
    console.log(
      `  campaign ${campaign?.code ?? bucket.key}: ${dollars(bucket.creditedMinor)} (${pct(bucket.share)})`,
    );
  }
}

console.log("\n=== ROI rollup (linear model) ===");
const portfolio = services.budgets.portfolioRoi(ctx, "linear");
for (const c of portfolio.campaigns) {
  console.log(
    `campaign ${c.campaignCode}: spend ${dollars(c.spendMinor)} of ${dollars(c.budgetTotalMinor)}, ` +
      `attributed revenue ${dollars(c.attributedRevenueMinor)}, ROAS ${c.roas?.toFixed(2) ?? "n/a"}, ` +
      `CPL ${c.costPerLeadMinor === null ? "n/a" : dollars(c.costPerLeadMinor)}, ` +
      `CPA ${c.costPerAcquisitionMinor === null ? "n/a" : dollars(c.costPerAcquisitionMinor)}`,
  );
}
console.log(
  `portfolio: spend ${dollars(portfolio.totals.spendMinor)}, revenue ${dollars(portfolio.totals.attributedRevenueMinor)}, ROI ${pct(portfolio.totals.roi)}`,
);

console.log("\n=== Funnel snapshot ===");
const funnel = services.leads.funnel(ctx);
console.log(funnel.countsByStage);
console.log(
  `MQL rate ${pct(funnel.mqlRate)}, SQL rate ${pct(funnel.sqlRate)}, win rate ${pct(funnel.winRate)}`,
);

console.log("\n=== Send job stats ===");
const stats = services.sendJobs.stats(ctx, seed.sendJobId);
console.log(stats);

console.log("\n=== Outbox ===");
console.log(`${module.outbox.pending().length} domain events pending dispatch`);
