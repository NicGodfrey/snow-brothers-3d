/**
 * Standalone bootstrap: `npm start` (or node --import tsx src/main.ts).
 *
 * Reads the suite manifest to find every domain service and integration-hub,
 * then polls the services' outbox endpoints on a timer and forwards the
 * events to the hub. Serves /health and /status for the suite shell.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OutboxRelay, type RelayTarget } from "./relay.js";

interface ManifestService {
  readonly id: string;
  readonly port: number;
}

interface SuiteManifest {
  readonly services: readonly ManifestService[];
}

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const manifestPath = process.env.SUITE_MANIFEST ?? join(ROOT, "scripts/suite-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SuiteManifest;

const SELF_ID = "outbox-relay";
const HUB_ID = "integration-hub";

const hubEntry = manifest.services.find((service) => service.id === HUB_ID);
const hubUrl =
  process.env.HUB_URL ?? (hubEntry ? `http://127.0.0.1:${hubEntry.port}` : "http://127.0.0.1:4117");

const targets: RelayTarget[] = manifest.services
  .filter((service) => service.id !== HUB_ID && service.id !== SELF_ID)
  .map((service) => ({ id: service.id, baseUrl: `http://127.0.0.1:${service.port}` }));

const port = Number(process.env.PORT ?? 4120);
const intervalMs = Number(process.env.RELAY_INTERVAL_MS ?? 2_000);

const relay = new OutboxRelay({
  hubUrl,
  targets,
  log: (message) => console.log(`[outbox-relay] ${message}`),
});

let running = false;
async function tick(): Promise<void> {
  if (running) return; // never overlap two cycles
  running = true;
  try {
    await relay.runOnce();
  } catch (error) {
    console.error("[outbox-relay] cycle failed", error);
  } finally {
    running = false;
  }
}

const timer = setInterval(() => {
  void tick();
}, intervalMs);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const respond = (status: number, body: unknown): void => {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  };
  if (url.pathname === "/health") {
    respond(200, { status: "ok", service: SELF_ID, hub: hubUrl, targets: targets.length });
    return;
  }
  if (url.pathname === "/status" || url.pathname === "/") {
    respond(200, relay.status());
    return;
  }
  if (url.pathname === "/run" && req.method === "POST") {
    void relay.runOnce().then((summary) => respond(200, summary));
    return;
  }
  respond(404, { error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${url.pathname}` } });
});

server.listen(port, () => {
  console.log(
    `[outbox-relay] listening on :${port}, relaying ${targets.length} services -> ${hubUrl} every ${intervalMs}ms`,
  );
});

void tick();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
}
