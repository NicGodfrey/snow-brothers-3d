import { createContainer } from "../infrastructure/container.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { createSrmServer } from "./server.js";

const port = Number(process.env["PORT"] ?? 3014);
const container = createContainer();

if (process.env["SRM_SEED"] !== "false") {
  const seeded = await seedDemoData(container);
  // eslint-disable-next-line no-console
  console.log(
    `[srm-core] seeded tenant "${seeded.ctx.tenantId}" with ${Object.keys(seeded.suppliers).length} suppliers ` +
      `across ${Object.keys(seeded.categories).length} categories`,
  );
}

createSrmServer(container).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[srm-core] listening on :${port} (send x-tenant-id header, e.g. "demo")`);
});
