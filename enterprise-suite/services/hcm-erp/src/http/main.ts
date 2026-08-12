import { createHcmModule } from "../module.js";
import { seedDemoTenant } from "../fixtures/seed.js";
import { createHcmServer } from "./server.js";

const port = Number(process.env.PORT ?? 4110);
const module_ = createHcmModule();

if (process.env.SEED !== "0") {
  try {
    seedDemoTenant(module_);
    console.log("[hcm-erp] seeded demo tenant");
  } catch (error) {
    console.warn("[hcm-erp] seed skipped:", (error as Error).message);
  }
}

const server = createHcmServer(module_);
server.listen(port, () => {
  console.log(`[hcm-erp] listening on :${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
