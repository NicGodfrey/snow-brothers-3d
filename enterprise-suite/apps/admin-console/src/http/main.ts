import { ConsoleLogger } from "@enterprise-suite/api-gateway";
import { createContainer } from "../infrastructure/container.js";
import { seedDemoData, SEED_TENANT_KEY } from "../infrastructure/seed.js";
import { ADMIN_BASE_PATH, ADMIN_VERSION, createAdminServer } from "./server.js";

/**
 * Process entry point.
 *
 * `ADMIN_SEED=false` starts with empty stores, which is what a deployment
 * against a real database would do; the default seeds the demo tenant so the
 * shell has something to show on first load.
 */
async function main(): Promise<void> {
  const port = Number(process.env["PORT"] ?? 4700);
  const seed = process.env["ADMIN_SEED"] !== "false";
  const logger = new ConsoleLogger(
    (process.env["LOG_LEVEL"] as "debug" | "info" | "warn" | "error") ?? "info",
    "admin-console",
  );

  const container = createContainer();
  let shellTenant = process.env["ADMIN_TENANT"] ?? SEED_TENANT_KEY;
  let shellUser = process.env["ADMIN_USER"] ?? "ada@northwind.example";

  if (seed) {
    const result = await seedDemoData(container);
    shellTenant = process.env["ADMIN_TENANT"] ?? result.tenantKey;
    shellUser = process.env["ADMIN_USER"] ?? result.adminEmail;
    logger.log("info", "seeded demo tenant", {
      tenant: result.tenantKey,
      admin: result.adminEmail,
      pendingInvites: Object.keys(result.inviteTokens).length,
    });
  }

  const server = createAdminServer(container, {
    logger,
    shell: { tenant: shellTenant, user: shellUser, roles: "tenant-admin" },
    corsOrigins: process.env["CORS_ORIGINS"]?.split(",").filter(Boolean),
  });

  // Deliveries are retried on a timer rather than inline so a slow endpoint
  // never blocks the command that produced the event.
  const drainMs = Number(process.env["WEBHOOK_DRAIN_MS"] ?? 5_000);
  const drain = setInterval(() => {
    void container.services.webhook.drain(50).catch((error: unknown) => {
      logger.log("error", "webhook drain failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, drainMs);
  drain.unref();

  const shutdown = (signal: string) => {
    logger.log("info", "shutting down", { signal });
    clearInterval(drain);
    container.dispose();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(port, () => {
    logger.log("info", "admin-console listening", {
      port,
      version: ADMIN_VERSION,
      shell: `http://localhost:${port}/`,
      api: `http://localhost:${port}${ADMIN_BASE_PATH}`,
      openapi: `http://localhost:${port}/openapi.json`,
    });
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
