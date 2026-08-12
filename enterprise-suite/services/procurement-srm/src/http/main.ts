import { tenantId } from "@enterprise-suite/shared-kernel";
import { seedDemoTenant } from "../fixtures/seed.js";
import { createProcurementModule } from "../module.js";
import { createProcurementServer } from "./server.js";

/**
 * Local development entry point: an in-memory module, the demo tenant, and the
 * HTTP server. Set `SEED=0` to start empty, `PORT` to move off 3070.
 * Default tenant is `demo` so the suite portal/gateway share one dataset.
 */
const module = createProcurementModule();
if (process.env.SEED !== "0") {
  const tenant = process.env.TENANT ?? "demo";
  const alreadySeeded = module.repos.suppliers.listByTenant(tenantId(tenant)).length > 0;
  if (!alreadySeeded) {
    const seed = seedDemoTenant(module, tenant);
    process.stdout.write(`seeded tenant ${seed.tenant} with ${module.outbox.peek().length} events\n`);
  } else {
    process.stdout.write(`procurement-srm: tenant ${tenant} already loaded; seed skipped\n`);
  }
}

const port = Number(process.env.PORT ?? 3070);
createProcurementServer(module).listen(port, () => {
  process.stdout.write(`procurement-srm listening on http://127.0.0.1:${port}\n`);
});
