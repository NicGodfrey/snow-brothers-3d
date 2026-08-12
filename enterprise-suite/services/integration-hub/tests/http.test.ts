/**
 * Drives the real node:http server over a loopback socket, so header
 * handling, status codes and DomainError mapping are all exercised.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { SIGNATURE_HEADER, verifySignature } from "../src/domain/signature.js";
import { epochSeconds } from "../src/domain/time.js";
import { createIntegrationHubServer } from "../src/http/server.js";
import { harness, type TestHarness } from "./helpers.js";

interface ApiResponse<T = any> {
  readonly status: number;
  readonly body: T;
}

let h: TestHarness;
let baseUrl: string;
let server: ReturnType<typeof createIntegrationHubServer>;

async function call<T = any>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; anonymous?: boolean } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.anonymous
      ? {}
      : { "x-tenant-id": String(h.ctx.tenantId), "x-user-id": "user-ops", "x-roles": "integration-operator" }),
    ...options.headers,
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const get = <T = any>(path: string, options?: Parameters<typeof call>[2]) => call<T>("GET", path, options);
const post = <T = any>(path: string, body?: unknown, options: Parameters<typeof call>[2] = {}) =>
  call<T>("POST", path, { ...options, body });

before(async () => {
  h = harness();
  server = createIntegrationHubServer(h.hub);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("http: infrastructure endpoints", () => {
  it("serves health and the driver catalog without a tenant", async () => {
    const health = await get("/health", { anonymous: true });
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "integration-hub");

    const drivers = await get("/adapters/drivers", { anonymous: true });
    assert.equal(drivers.status, 200);
    assert.equal(drivers.body.items.length, 6);
  });

  it("requires tenant headers everywhere else", async () => {
    const anonymous = await get("/outbox", { anonymous: true });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error.code, "MISSING_TENANT_CONTEXT");
  });

  it("returns 404 for an unknown route and 400 for malformed JSON", async () => {
    const missing = await get("/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "ROUTE_NOT_FOUND");

    const response = await fetch(`${baseUrl}/outbox`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": String(h.ctx.tenantId),
        "x-user-id": "user-ops",
      },
      body: "{not json",
    });
    assert.equal(response.status, 400);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "INVALID_JSON");
  });

  it("reports queue metrics", async () => {
    const metrics = await get("/metrics");
    assert.equal(metrics.status, 200);
    assert.ok("bus" in metrics.body);
    assert.ok("outbox" in metrics.body);
    assert.ok("deliveries" in metrics.body);
  });
});

describe("http: outbox and relay", () => {
  it("ingests an event, relays it and exposes its state", async () => {
    const created = await post("/outbox", {
      source: "quality-qms",
      event: {
        eventType: "quality.ncr.opened",
        aggregateId: "ncr_1",
        eventId: "evt_http_1",
        payload: { ncrNumber: "NCR-HTTP-1", severity: "critical" },
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.duplicate, false);
    const id = created.body.message.id;

    // Re-posting the same producer event id is absorbed, not duplicated.
    const again = await post("/outbox", {
      source: "quality-qms",
      event: { eventType: "quality.ncr.opened", eventId: "evt_http_1", payload: {} },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);

    const relayed = await post("/relay/run");
    assert.equal(relayed.status, 200);
    assert.equal(relayed.body.published, 1);

    const fetched = await get(`/outbox/${id}`);
    assert.equal(fetched.body.status, "published");
    assert.equal((await get("/outbox/stats")).body.published, 1);
  });

  it("rejects an event that claims another tenant", async () => {
    const response = await post("/outbox", {
      source: "quality-qms",
      event: { eventType: "quality.ncr.opened", tenantId: "tenant-evil", payload: {} },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "TENANT_MISMATCH");
  });

  it("validates the request body", async () => {
    const missingSource = await post("/outbox", { event: { eventType: "a.b.c" } });
    assert.equal(missingSource.status, 400);
    assert.equal(missingSource.body.error.code, "VALIDATION");

    const missingEventType = await post("/outbox", { source: "x", event: {} });
    assert.equal(missingEventType.status, 400);

    const notAnArray = await post("/outbox/batch", { source: "x", events: {} });
    assert.equal(notAnArray.status, 400);
  });

  it("accepts a batch and drains it", async () => {
    const batch = await post("/outbox/batch", {
      source: "sales-crm",
      events: [
        { eventType: "sales.order.placed", eventId: "evt_b1", payload: { orderId: "SO-B1" } },
        { eventType: "sales.order.placed", eventId: "evt_b2", payload: { orderId: "SO-B2" } },
      ],
    });
    assert.equal(batch.status, 202);
    assert.equal(batch.body.enqueued, 2);

    const drained = await post("/relay/drain");
    assert.equal(drained.body.published, 2);
  });
});

describe("http: webhooks and deliveries", () => {
  let subscriptionId: string;
  let secret: string;

  it("creates a subscription and returns the secret only once", async () => {
    const created = await post("/webhooks", {
      name: "http-partner",
      endpointUrl: "https://partner.example.com/hooks",
      eventPatterns: ["logistics.**"],
      headers: { "x-partner": "acme" },
    });
    assert.equal(created.status, 201);
    subscriptionId = created.body.id;
    secret = created.body.secret;
    assert.ok(secret.startsWith("whsec_"));

    const fetched = await get(`/webhooks/${subscriptionId}`);
    assert.equal(fetched.body.secret, undefined);
    assert.ok(String(fetched.body.secretHint).endsWith("..."));
  });

  it("rejects an invalid endpoint with 400", async () => {
    const response = await post("/webhooks", {
      name: "bad",
      endpointUrl: "gopher://old.example.com",
      eventPatterns: ["**"],
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION");
  });

  it("reports a duplicate name as 409", async () => {
    const response = await post("/webhooks", {
      name: "http-partner",
      endpointUrl: "https://partner.example.com/other",
      eventPatterns: ["**"],
    });
    assert.equal(response.status, 409);
  });

  it("pings the endpoint with a verifiable signature", async () => {
    const response = await post(`/webhooks/${subscriptionId}/ping`);
    assert.equal(response.status, 200);
    assert.equal(response.body.outcome, "delivered");

    const request = h.transport.lastRequest()!;
    assert.equal(request.headers["x-partner"], "acme");
    assert.equal(
      verifySignature(request.headers[SIGNATURE_HEADER]!, request.body, [secret], {
        nowSeconds: epochSeconds(h.clock.now()),
      }).valid,
      true,
    );
  });

  it("walks the lifecycle through the API", async () => {
    assert.equal((await post(`/webhooks/${subscriptionId}/pause`)).body.status, "paused");
    assert.equal((await post(`/webhooks/${subscriptionId}/resume`)).body.status, "active");

    const patched = await call("PATCH", `/webhooks/${subscriptionId}`, {
      body: { eventPatterns: ["logistics.**", "quality.**"], maxAttempts: 2 },
    });
    assert.deepEqual(patched.body.eventPatterns, ["logistics.**", "quality.**"]);
    assert.equal(patched.body.maxAttempts, 2);

    const rotated = await post(`/webhooks/${subscriptionId}/rotate-secret`);
    assert.notEqual(rotated.body.secret, secret);
    secret = rotated.body.secret;
    assert.ok(rotated.body.secretRotationEndsAt);
  });

  it("fans out through the relay and lists the deliveries", async () => {
    await post("/outbox", {
      source: "logistics-tms",
      event: {
        eventType: "logistics.shipment.booked",
        eventId: "evt_ship_1",
        payload: { shipmentId: "SHP-1" },
      },
    });
    const relayed = await post("/relay/run");
    assert.equal(relayed.body.deliveriesScheduled, 1);

    const dispatched = await post("/deliveries/dispatch");
    assert.equal(dispatched.body.delivered, 1);

    const listed = await get(`/webhooks/${subscriptionId}/deliveries?status=delivered`);
    assert.equal(listed.body.total, 2); // the ping plus the shipment
    assert.equal((await get(`/webhooks/${subscriptionId}/stats`)).body.delivered, 2);

    const invalidFilter = await get("/deliveries?status=exploded");
    assert.equal(invalidFilter.status, 400);
  });

  it("refuses to delete an active subscription and allows it once disabled", async () => {
    assert.equal((await call("DELETE", `/webhooks/${subscriptionId}`)).status, 409);
    await post(`/webhooks/${subscriptionId}/disable`, { reason: "test complete" });
    assert.equal((await call("DELETE", `/webhooks/${subscriptionId}`)).status, 204);
    assert.equal((await get(`/webhooks/${subscriptionId}`)).status, 404);
  });
});

describe("http: adapters and routes", () => {
  it("registers an adapter, tests it and sends through it", async () => {
    const registered = await post("/adapters", {
      name: "http-3pl",
      kind: "http",
      config: { endpoint: "https://3pl.example.com/api", authScheme: "none" },
    });
    assert.equal(registered.status, 201);
    const id = registered.body.id;

    assert.equal((await post(`/adapters/${id}/test`)).body.status, "connected");

    const sent = await post(`/adapters/${id}/send`, {
      messages: [{ key: "SO-1", eventType: "sales.order.placed", payload: { orderId: "SO-1" } }],
    });
    assert.equal(sent.status, 202);
    assert.equal(sent.body.accepted, 1);

    const badConfig = await post("/adapters", { name: "broken", kind: "http", config: {} });
    assert.equal(badConfig.status, 400);
  });

  it("creates a route rule and previews it without recording a match", async () => {
    const created = await post("/routes", {
      name: "http-preview-rule",
      eventPatterns: ["sales.order.placed"],
      destination: { type: "bus", topic: "partner.orders.v3" },
      filter: { all: [{ path: "payload.total", op: "gt", value: 100 }] },
      transform: { fields: { ref: { path: "payload.orderId" }, kind: { const: "ORDER" } } },
    });
    assert.equal(created.status, 201);

    const match = await post("/routes/preview", {
      event: { eventType: "sales.order.placed", payload: { orderId: "SO-9", total: 5_000 } },
    });
    assert.equal(match.body.matches.length, 1);
    assert.deepEqual(match.body.matches[0].payload, { ref: "SO-9", kind: "ORDER" });

    const noMatch = await post("/routes/preview", {
      event: { eventType: "sales.order.placed", payload: { orderId: "SO-10", total: 10 } },
    });
    assert.equal(noMatch.body.matches.length, 0);
    assert.equal((await get(`/routes/${created.body.id}`)).body.matchCount, 0);
  });
});

describe("http: inbox and idempotency", () => {
  it("accepts an inbound message and de-duplicates on the message key", async () => {
    const first = await post("/inbox", {
      source: "partner-edi",
      messageKey: "EDI-1001",
      eventType: "logistics.asn.received",
      payload: { asn: "ASN-1" },
    });
    assert.equal(first.status, 202);
    assert.equal(first.body.duplicate, false);

    const retry = await post("/inbox", {
      source: "partner-edi",
      messageKey: "EDI-1001",
      eventType: "logistics.asn.received",
      payload: { asn: "ASN-1" },
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);

    // The key may also travel in the Idempotency-Key header.
    const viaHeader = await post(
      "/inbox",
      { source: "partner-edi", eventType: "logistics.asn.received", payload: { asn: "ASN-2" } },
      { headers: { "idempotency-key": "EDI-1002" } },
    );
    assert.equal(viaHeader.status, 202);
    assert.equal((await get("/inbox")).body.total, 2);
  });

  it("reserves an idempotency key, replays the stored response and rejects a changed body", async () => {
    const begin = await post("/idempotency/begin", {
      key: "req-1",
      scope: "POST /orders",
      request: { orderId: "SO-77" },
    });
    assert.equal(begin.status, 201);
    assert.equal(begin.body.replayed, false);

    const inFlight = await post("/idempotency/begin", {
      key: "req-1",
      scope: "POST /orders",
      request: { orderId: "SO-77" },
    });
    assert.equal(inFlight.status, 409);

    await post("/idempotency/complete", {
      key: "req-1",
      scope: "POST /orders",
      response: { status: 201, body: { id: "order_1" } },
    });

    const replay = await post("/idempotency/begin", {
      key: "req-1",
      scope: "POST /orders",
      request: { orderId: "SO-77" },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body.response.body, { id: "order_1" });

    const conflict = await post("/idempotency/begin", {
      key: "req-1",
      scope: "POST /orders",
      request: { orderId: "SO-78" },
    });
    assert.equal(conflict.status, 422);
    assert.equal(conflict.body.error.code, "IDEMPOTENCY_KEY_REUSE");

    const record = await get("/idempotency/POST%20%2Forders/req-1");
    assert.equal(record.body.status, "completed");
  });
});
