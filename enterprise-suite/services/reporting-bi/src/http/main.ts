/**
 * Service entry point.
 *
 * Boots an in-memory module, installs the standard catalog and — unless
 * REPORTING_SEED=false — a synthetic warehouse, then serves the API. The
 * point is that `npm start` gives a running BI service with real numbers in
 * it, which is what makes the endpoints explorable without a data pipeline.
 */
import { createTenantContext } from "@enterprise-suite/shared-kernel";
import { installCatalog } from "../infrastructure/catalog.js";
import { createReportingBiModule } from "../infrastructure/module.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { createReportingBiServer } from "./server.js";

const port = Number(process.env.PORT ?? 3111);
const tenant = process.env.REPORTING_TENANT ?? "demo-tenant";
const shouldSeed = process.env.REPORTING_SEED !== "false";
const seedDays = Number(process.env.REPORTING_SEED_DAYS ?? 120);

const module = createReportingBiModule();
const ctx = createTenantContext(tenant, "system", ["admin", "analyst"]);

const installed = await installCatalog(ctx, module);
process.stdout.write(
  `[reporting-bi] catalog installed: ${installed.dimensions} dimensions, ${installed.cubes} cubes, ` +
    `${installed.metrics} metrics, ${installed.kpis} KPIs, ${installed.dashboards} dashboards\n`,
);

if (shouldSeed) {
  const seeded = await seedDemoData(ctx, module, { days: seedDays });
  process.stdout.write(
    `[reporting-bi] seeded ${seeded.events} events -> ${seeded.ingest.factsWritten} facts ` +
      `(${seeded.ingest.rejected} rejected), ${seeded.snapshots.length} KPI snapshots\n`,
  );
}

const server = createReportingBiServer(module, { allowSeeding: true });
server.listen(port, () => {
  process.stdout.write(`[reporting-bi] listening on http://localhost:${port} (tenant ${tenant})\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
