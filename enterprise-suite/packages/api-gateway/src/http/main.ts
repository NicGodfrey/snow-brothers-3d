import { createGatewayContainer } from "../infrastructure/container.js";
import { ConsoleLogger } from "../infrastructure/logger.js";
import { createGatewayServer } from "./server.js";

/** Entry point: `npm run dev -w @enterprise-suite/api-gateway`. */
const port = Number(process.env["PORT"] ?? 4100);
const logger = new ConsoleLogger(
  (process.env["LOG_LEVEL"] as "debug" | "info" | "warn" | "error") ?? "info",
);
const container = createGatewayContainer({
  logger,
  catalogOptions: {
    originTemplate: process.env["UPSTREAM_ORIGIN_TEMPLATE"] ?? "http://127.0.0.1:{port}",
    assumeDeployed: process.env["ASSUME_DEPLOYED"] === "true",
  },
});

const findings = container.routes.audit(container.catalog.ids());
for (const finding of findings) logger.log("warn", `route audit: ${finding}`);

const server = createGatewayServer(container);
server.listen(port, () => {
  logger.log("info", "api-gateway listening", {
    port,
    routes: container.routes.size,
    upstreams: container.catalog.size,
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.log("info", `received ${signal}, draining`);
    server.close(() => process.exit(0));
  });
}
