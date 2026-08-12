import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, describe, it } from "node:test";
import { groupByTenant, normalizeEvents, OutboxRelay } from "../src/relay.js";

function event(id: string, tenantId = "tenant-a", eventType = "sales.order.created") {
  return {
    eventId: id,
    eventType,
    aggregateType: "order",
    aggregateId: `agg_${id}`,
    tenantId,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
    payload: { id },
  };
}

describe("normalizeEvents", () => {
  it("accepts every response shape the services use", () => {
    const e = event("evt_1");
    assert.equal(normalizeEvents({ items: [e] }).length, 1);
    assert.equal(normalizeEvents({ count: 1, items: [e] }).length, 1);
    assert.equal(normalizeEvents({ drained: 1, items: [e] }).length, 1);
    assert.equal(normalizeEvents({ events: [e] }).length, 1);
    assert.equal(normalizeEvents([e]).length, 1);
    // manufacturing-mes wraps bodies in { data }
    assert.equal(normalizeEvents({ data: { count: 1, items: [e] } }).length, 1);
    // logistics-tms outbox records nest the envelope
    assert.equal(normalizeEvents({ items: [{ outboxId: "obx_1", envelope: e }] })[0]?.eventId, "evt_1");
    assert.equal(normalizeEvents({ items: [{ dispatched: false, event: e }] })[0]?.eventId, "evt_1");
  });

  it("drops malformed entries and unknown bodies", () => {
    assert.deepEqual(normalizeEvents(undefined), []);
    assert.deepEqual(normalizeEvents("nope"), []);
    assert.deepEqual(normalizeEvents({ items: [{ eventType: "x" }] }), []);
  });
});

describe("groupByTenant", () => {
  it("splits a mixed batch per tenant", () => {
    const groups = groupByTenant([event("e1", "t1"), event("e2", "t2"), event("e3", "t1")]);
    assert.deepEqual([...groups.keys()].sort(), ["t1", "t2"]);
    assert.equal(groups.get("t1")?.length, 2);
    assert.equal(groups.get("t2")?.length, 1);
  });
});

/** Minimal fake domain service with a drainable outbox. */
function fakeService(): {
  server: Server;
  outbox: ReturnType<typeof event>[];
  url: () => string;
} {
  const outbox: ReturnType<typeof event>[] = [];
  const server = createServer((req, res) => {
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/outbox/pending") {
      respond(200, { items: [...outbox] });
      return;
    }
    if (req.method === "POST" && req.url === "/outbox/drain") {
      const items = outbox.splice(0, outbox.length);
      respond(200, { count: items.length, items });
      return;
    }
    respond(404, { error: "not found" });
  });
  return {
    server,
    outbox,
    url: () => {
      const addr = server.address();
      return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    },
  };
}

/** Minimal fake integration-hub capturing /outbox/batch posts. */
function fakeHub(options: { failFirst?: number } = {}): {
  server: Server;
  received: Array<{ tenant: string; source: string; events: { eventId: string }[] }>;
  url: () => string;
} {
  const received: Array<{ tenant: string; source: string; events: { eventId: string }[] }> = [];
  const seen = new Set<string>();
  let failures = options.failFirst ?? 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const respond = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST" || req.url !== "/outbox/batch") {
        respond(404, { error: "not found" });
        return;
      }
      if (failures > 0) {
        failures -= 1;
        respond(503, { error: "unavailable" });
        return;
      }
      const tenant = String(req.headers["x-tenant-id"]);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        source: string;
        events: { eventId: string; tenantId: string }[];
      };
      let enqueued = 0;
      let duplicates = 0;
      for (const e of body.events) {
        assert.equal(e.tenantId, tenant, "hub rejects cross-tenant events");
        const key = `${tenant}:${body.source}:${e.eventId}`;
        if (seen.has(key)) duplicates += 1;
        else {
          seen.add(key);
          enqueued += 1;
        }
      }
      received.push({ tenant, source: body.source, events: body.events });
      respond(202, { enqueued, duplicates, messageIds: [] });
    });
  });
  return { server, received, url: () => {
    const addr = server.address();
    return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  } };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

describe("OutboxRelay", () => {
  const servers: Server[] = [];
  after(() => {
    for (const server of servers) server.close();
  });

  it("drains a service and forwards per-tenant batches to the hub exactly once", async () => {
    const service = fakeService();
    const hub = fakeHub();
    await listen(service.server);
    await listen(hub.server);
    servers.push(service.server, hub.server);

    service.outbox.push(event("evt_a", "t1"), event("evt_b", "t2"), event("evt_c", "t1"));

    const relay = new OutboxRelay({
      hubUrl: hub.url(),
      targets: [{ id: "fake-service", baseUrl: service.url() }],
    });

    const first = await relay.runOnce();
    assert.equal(first.forwarded, 3);
    assert.equal(service.outbox.length, 0, "drain removed the events from the service");
    assert.deepEqual(
      hub.received.map((r) => r.tenant).sort(),
      ["t1", "t2"],
      "one batch per tenant",
    );
    assert.equal(hub.received.find((r) => r.tenant === "t1")?.events.length, 2);
    assert.ok(hub.received.every((r) => r.source === "fake-service"));

    // A second cycle with nothing pending forwards nothing.
    const second = await relay.runOnce();
    assert.equal(second.forwarded, 0);
  });

  it("buffers drained events while the hub is down and retries without loss", async () => {
    const service = fakeService();
    const hub = fakeHub({ failFirst: 1 });
    await listen(service.server);
    await listen(hub.server);
    servers.push(service.server, hub.server);

    service.outbox.push(event("evt_x", "t1"));

    const relay = new OutboxRelay({
      hubUrl: hub.url(),
      targets: [{ id: "fake-service", baseUrl: service.url() }],
    });

    const first = await relay.runOnce();
    assert.equal(first.forwarded, 0);
    assert.equal(first.services[0]?.buffered, 1, "event kept in the retry buffer");
    assert.ok(first.services[0]?.error);

    const second = await relay.runOnce();
    assert.equal(second.forwarded, 1, "buffered event delivered on retry");
    assert.equal(relay.status().services[0]?.buffered, 0);
  });

  it("reports unreachable services without failing the cycle", async () => {
    const hub = fakeHub();
    await listen(hub.server);
    servers.push(hub.server);

    const relay = new OutboxRelay({
      hubUrl: hub.url(),
      targets: [{ id: "down-service", baseUrl: "http://127.0.0.1:1" }],
      requestTimeoutMs: 500,
    });

    const cycle = await relay.runOnce();
    assert.equal(cycle.forwarded, 0);
    assert.equal(cycle.services[0]?.mode, "unknown");
  });
});
