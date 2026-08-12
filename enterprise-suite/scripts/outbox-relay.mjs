#!/usr/bin/env node
/**
 * Polls domain service outbox drain endpoints and posts batches into
 * integration-hub's inbox so events leave their originating process.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "scripts/suite-manifest.json"), "utf8"));
const HUB_PORT = MANIFEST.services.find((s) => s.id === "integration-hub")?.port ?? 4117;
const INTERVAL_MS = Number(process.env.OUTBOX_RELAY_INTERVAL_MS ?? 3000);
const TENANT = process.env.OUTBOX_RELAY_TENANT ?? "demo";
const TRUST = process.env.SUITE_TRUST_HEADERS !== "false";

const SOURCES = MANIFEST.services
  .filter((s) => s.id !== "integration-hub")
  .map((s) => ({ id: s.id, port: s.port }));

function headers() {
  const h = {
    "content-type": "application/json",
    "x-tenant-id": TENANT,
    "x-user-id": "outbox-relay",
    "x-roles": "platform-admin,viewer",
  };
  if (!TRUST && process.env.SMOKE_TOKEN) h.authorization = `Bearer ${process.env.SMOKE_TOKEN}`;
  return h;
}

async function drain(port) {
  const url = `http://127.0.0.1:${port}/outbox/drain`;
  try {
    const res = await fetch(url, { method: "POST", headers: headers() });
    if (!res.ok) return [];
    const body = await res.json();
    const items = body.items ?? body.events ?? body;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function publish(source, events) {
  if (!events.length) return 0;
  const url = `http://127.0.0.1:${HUB_PORT}/inbox`;
  const payload = {
    source,
    events: events.map((evt, index) => ({
      eventId: evt.eventId ?? evt.id ?? `${source}-${Date.now()}-${index}`,
      eventType: evt.eventType ?? evt.type ?? "domain.event",
      occurredAt: evt.occurredAt ?? evt.at ?? new Date().toISOString(),
      tenantId: evt.tenantId ?? TENANT,
      payload: evt.payload ?? evt,
    })),
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    return res.ok ? events.length : 0;
  } catch {
    return 0;
  }
}

async function tick() {
  let total = 0;
  for (const src of SOURCES) {
    const events = await drain(src.port);
    if (!events.length) continue;
    const n = await publish(src.id, events);
    if (n) {
      total += n;
      console.log(`[outbox-relay] ${src.id}: relayed ${n} event(s)`);
    }
  }
  return total;
}

console.log(
  `[outbox-relay] watching ${SOURCES.length} services -> integration-hub :${HUB_PORT} every ${INTERVAL_MS}ms`,
);
await tick();
setInterval(() => {
  void tick();
}, INTERVAL_MS);
