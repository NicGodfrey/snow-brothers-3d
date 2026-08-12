import { createInventoryModule } from "../infrastructure/container.js";
import { startServer } from "./server.js";

const port = Number(process.env.PORT ?? 4107);
const module_ = createInventoryModule();

startServer(module_, port).then(() => {
  console.log(`[inventory-wms] listening on :${port}`);
});
