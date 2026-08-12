import { createContainer } from "../infrastructure/container.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { createMasterDataServer } from "./server.js";

const port = Number(process.env["PORT"] ?? 3020);
const container = createContainer();

if (process.env["MDM_SEED"] !== "false") {
  const seeded = await seedDemoData(container);
  // eslint-disable-next-line no-console
  console.log(
    `[master-data] seeded tenant "${seeded.ctx.tenantId}" with ${
      Object.keys(seeded.customers).length
    } customers and ${Object.keys(seeded.sites).length} sites`,
  );
}

createMasterDataServer(container).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[master-data] listening on :${port} (send x-tenant-id header, e.g. "demo")`);
});
