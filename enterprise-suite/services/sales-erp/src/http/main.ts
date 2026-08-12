import { createSalesModule } from "../infrastructure/container.js";
import { seedDemoData } from "../fixtures/seed.js";
import { buildServer } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "3005", 10);
const module_ = createSalesModule();

if (process.env.SEED === "1") {
  const refs = seedDemoData(module_, process.env.TENANT ?? "demo");
  console.log(`[sales-erp] seeded demo tenant ${refs.ctx.tenantId}`);
}

buildServer(module_).listen(port, () => {
  console.log(`[sales-erp] listening on :${port}`);
});
