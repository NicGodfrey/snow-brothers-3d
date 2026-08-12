import { tenantId } from "@enterprise-suite/shared-kernel";
import { createContainer } from "../infrastructure/container.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { createSrmServer } from "./server.js";

const port = Number(process.env["PORT"] ?? 3014);
const container = createContainer();
const demo = tenantId(process.env["TENANT"] ?? "demo");
const categoryCount = (await container.repos.categories.all(demo)).length;
const shouldSeed =
  process.env["SRM_SEED"] !== "false" &&
  container.repos.suppliers.isEmpty &&
  categoryCount === 0;

if (shouldSeed) {
  const seeded = await seedDemoData(container);
  container.repos.suppliers.flush();
  // eslint-disable-next-line no-console
  console.log(
    `[srm-core] seeded tenant "${seeded.ctx.tenantId}" with ${Object.keys(seeded.suppliers).length} suppliers ` +
      `across ${Object.keys(seeded.categories).length} categories`,
  );
} else if (!container.repos.suppliers.isEmpty) {
  // eslint-disable-next-line no-console
  console.log("[srm-core] loaded suppliers from PERSISTENCE_DIR (seed skipped)");
} else {
  // eslint-disable-next-line no-console
  console.log("[srm-core] persistence partially present; seed skipped to avoid duplicates");
}

createSrmServer(container).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[srm-core] listening on :${port} (send x-tenant-id header, e.g. "demo")`);
});
