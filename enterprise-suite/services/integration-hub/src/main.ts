/**
 * Standalone bootstrap: `npm start` (or node --import tsx src/main.ts).
 *
 * Runs the HTTP API plus the two background loops (outbox relay and webhook
 * dispatcher) on timers. In a deployment these would be separate processes
 * sharing the database; here they share the in-memory module.
 */
import { createIntegrationHubServer } from "./http/server.js";
import { createIntegrationHubModule } from "./infrastructure/module.js";

const port = Number(process.env.PORT ?? 3011);
const relayIntervalMs = Number(process.env.RELAY_INTERVAL_MS ?? 1_000);
const dispatchIntervalMs = Number(process.env.DISPATCH_INTERVAL_MS ?? 1_000);

const module_ = createIntegrationHubModule({
  logger: {
    info: (message, fields) => console.log(`[hub] ${message}`, fields ?? ""),
    warn: (message, fields) => console.warn(`[hub] ${message}`, fields ?? ""),
    error: (message, fields) => console.error(`[hub] ${message}`, fields ?? ""),
  },
});

const server = createIntegrationHubServer(module_);
server.listen(port, () => {
  console.log(`integration-hub listening on :${port}`);
});

const relayTimer = setInterval(() => {
  void module_.services.relay.runOnce().catch((error: unknown) => {
    console.error("[hub] relay loop error", error);
  });
}, relayIntervalMs);

const dispatchTimer = setInterval(() => {
  void module_.services.deliveries.dispatchDue().catch((error: unknown) => {
    console.error("[hub] dispatch loop error", error);
  });
}, dispatchIntervalMs);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(relayTimer);
    clearInterval(dispatchTimer);
    server.close(() => process.exit(0));
  });
}
