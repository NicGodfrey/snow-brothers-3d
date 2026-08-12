import { createContainer } from "../infrastructure/container.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { createChannelServer } from "./server.js";

const port = Number(process.env["PORT"] ?? 3016);
const container = createContainer();

if (process.env["PRM_SEED"] !== "false") {
  const seeded = await seedDemoData(container);
  // eslint-disable-next-line no-console
  console.log(
    `[channel-prm] seeded tenant "${seeded.ctx.tenantId}" with ${Object.keys(seeded.partners).length} partners, ` +
      `${Object.keys(seeded.registrations).length} registrations and ${seeded.conflicts.length} conflict case(s)`,
  );
}

createChannelServer(container).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[channel-prm] listening on :${port} (send x-tenant-id header, e.g. "demo")`);
});
