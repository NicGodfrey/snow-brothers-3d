import { createContainer } from "../infrastructure/container.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { createPlmServer } from "./server.js";

const port = Number(process.env["PORT"] ?? 3010);
const container = createContainer();

if (process.env["PLM_SEED"] !== "false") {
  const seeded = await seedDemoData(container);
  // eslint-disable-next-line no-console
  console.log(
    `[product-plm] seeded tenant "${seeded.ctx.tenantId}" with ${Object.keys(seeded.products).length} products`,
  );
}

createPlmServer(container).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[product-plm] listening on :${port} (send x-tenant-id header, e.g. "demo")`);
});
