import { createContainer } from "../infrastructure/container.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { createPrmServer } from "./server.js";

const port = Number(process.env["PORT"] ?? 3016);
const container = createContainer();

if (process.env["PRM_SEED"] !== "false") {
  const seeded = await seedDemoData(container);
  // eslint-disable-next-line no-console
  console.log(
    `[prm-core] seeded tenant "${seeded.ctx.tenantId}" with ${Object.keys(seeded.partners).length} partners`,
  );
}

createPrmServer(container).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[prm-core] listening on :${port} (send x-tenant-id header, e.g. "demo")`);
});
