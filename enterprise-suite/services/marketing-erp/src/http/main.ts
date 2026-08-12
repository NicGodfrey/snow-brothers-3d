/**
 * Standalone entrypoint: boots the marketing module with the system clock
 * and simulated delivery gateway, then serves HTTP. Run with: npm run serve
 */
import { createMarketingModule } from "../infrastructure/container.js";
import { createMarketingServer } from "./server.js";

const port = Number(process.env.PORT ?? 3040);
const module = createMarketingModule();
const server = createMarketingServer(module);

server.listen(port, () => {
  console.log(`marketing-erp listening on http://localhost:${port}`);
  console.log("identity headers required: x-tenant-id, x-user-id, x-roles");
});

// Relay outbox events; in production a bus dispatcher replaces this.
const dispatcher = setInterval(() => {
  const dispatched = module.outbox.dispatchPending();
  if (dispatched > 0) {
    console.log(`outbox: dispatched ${dispatched} event(s)`);
  }
}, 1000);
dispatcher.unref();
