import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp, createHttpServer, type App } from "../src/http/app.js";

let app: App;
let server: Server;
let baseUrl: string;

const TENANT = { "x-tenant-id": "acme", "x-user-id": "tester", "x-roles": "ops" };

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = TENANT,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const ORIGIN = {
  name: "Acme Warehouse",
  line1: "Lagerstrasse 1",
  city: "Berlin",
  postalCode: "10115",
  country: "DE",
};
const DEST = {
  name: "Kunde GmbH",
  line1: "Kaufingerstrasse 12",
  city: "Munich",
  postalCode: "80331",
  country: "DE",
};

before(async () => {
  app = buildApp();
  server = createHttpServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("HTTP API", () => {
  it("serves /health without identity headers", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", service: "logistics-tms" });
  });

  it("rejects data routes without x-tenant-id", async () => {
    const { status, json } = await call("GET", "/carriers", undefined, {});
    assert.equal(status, 401);
    assert.equal(json.error.code, "UNAUTHENTICATED");
  });

  it("returns 404 with a structured error for unknown routes", async () => {
    const { status, json } = await call("GET", "/nope");
    assert.equal(status, 404);
    assert.equal(json.error.code, "ROUTE_NOT_FOUND");
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await fetch(`${baseUrl}/carriers`, {
      method: "POST",
      headers: { "content-type": "application/json", ...TENANT },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    const json: any = await res.json();
    assert.equal(json.error.code, "INVALID_JSON");
  });

  it("runs the full carrier → rate card → quote → book → track → POD slice", async () => {
    // 1. Carrier + service level
    const carrier = await call("POST", "/carriers", {
      code: "SWIFT",
      name: "Swift Parcel",
      mode: "parcel",
    });
    assert.equal(carrier.status, 201);
    const carrierId = carrier.json.id;

    const sl = await call("POST", `/carriers/${carrierId}/service-levels`, {
      code: "GROUND",
      name: "Ground",
      transitDays: 3,
      cutoffHour: 17,
    });
    assert.equal(sl.status, 200);

    // 2. Rate card with zone, breaks, fuel, accessorial
    const card = await call("POST", "/rate-cards", {
      carrierId,
      serviceLevelCode: "GROUND",
      currency: "EUR",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      fuelSurchargePct: 10,
    });
    assert.equal(card.status, 201);
    const cardId = card.json.id;
    assert.equal((await call("POST", `/rate-cards/${cardId}/zones`, { zone: "DOM", country: "DE" })).status, 200);
    assert.equal(
      (await call("POST", `/rate-cards/${cardId}/breaks`, { zone: "DOM", maxWeightKg: 20, amountMinor: 2500 })).status,
      200,
    );
    assert.equal(
      (await call("POST", `/rate-cards/${cardId}/accessorials`, { code: "LIFTGATE", name: "Liftgate", amountMinor: 500 })).status,
      200,
    );
    const published = await call("POST", `/rate-cards/${cardId}/publish`);
    assert.equal(published.status, 200);
    assert.equal(published.json.status, "published");

    // 3. Quote shopping
    const quotes = await call("POST", "/quotes", {
      destination: DEST,
      packages: [{ weightKg: 4, dimensions: { lengthCm: 30, widthCm: 20, heightCm: 10 } }],
      accessorialCodes: ["LIFTGATE"],
    });
    assert.equal(quotes.status, 200);
    assert.equal(quotes.json.items.length, 1);
    assert.equal(quotes.json.items[0].totalMinor, 2500 + 250 + 500);

    // 4. Shipment create + book
    const shipment = await call("POST", "/shipments", {
      origin: ORIGIN,
      destination: DEST,
      orderRef: "SO-42",
      packages: [{ weightKg: 4, dimensions: { lengthCm: 30, widthCm: 20, heightCm: 10 } }],
      accessorialCodes: ["LIFTGATE"],
    });
    assert.equal(shipment.status, 201);
    const shipmentId = shipment.json.id;

    const booked = await call("POST", `/shipments/${shipmentId}/book`, {
      carrierId,
      serviceLevelCode: "GROUND",
    });
    assert.equal(booked.status, 200);
    assert.equal(booked.json.status, "booked");
    assert.equal(booked.json.cost.totalMinor, 3250);
    const trackingNumber = booked.json.trackingNumber;

    // 5. Tracking events + public tracking view
    const pu = await call("POST", `/shipments/${shipmentId}/tracking-events`, {
      code: "PU",
      location: "Berlin",
    });
    assert.equal(pu.status, 201);
    assert.equal(pu.json.status, "picked_up");

    const tracking = await call("GET", `/tracking/${trackingNumber}`);
    assert.equal(tracking.status, 200);
    assert.equal(tracking.json.status, "picked_up");
    assert.equal(tracking.json.events.length, 1);

    // 6. POD capture drives delivery
    const pod = await call("POST", `/shipments/${shipmentId}/pod`, {
      signedBy: "H. Müller",
      method: "signature",
      exceptions: [{ code: "damaged", description: "Box corner crushed" }],
    });
    assert.equal(pod.status, 201);
    assert.equal(pod.json.shipmentStatus, "delivered");

    const podFetched = await call("GET", `/shipments/${shipmentId}/pod`);
    assert.equal(podFetched.status, 200);
    assert.equal(podFetched.json.signedBy, "H. Müller");
    assert.equal(podFetched.json.exceptions.length, 1);

    // 7. Booking conflicts surface as 409
    const rebook = await call("POST", `/shipments/${shipmentId}/book`, {
      carrierId,
      serviceLevelCode: "GROUND",
    });
    assert.equal(rebook.status, 409);

    // 8. Outbox has the whole story
    const outbox = await call("GET", "/outbox/pending");
    const types = outbox.json.items.map((r: any) => r.envelope.eventType);
    assert.ok(types.includes("logistics.shipment.booked"));
    assert.ok(types.includes("logistics.shipment.delivered"));
    assert.ok(types.includes("logistics.pod.captured"));
  });

  it("exposes dock scheduling with conflict handling over HTTP", async () => {
    const request = await call("POST", "/dock-appointments", {
      facilityCode: "FRA-1",
      dockDoor: "D01",
      direction: "inbound",
      windowStart: "2026-10-01T08:00:00.000Z",
      windowEnd: "2026-10-01T10:00:00.000Z",
    });
    assert.equal(request.status, 201);

    const conflict = await call("POST", "/dock-appointments", {
      facilityCode: "FRA-1",
      dockDoor: "D01",
      direction: "outbound",
      windowStart: "2026-10-01T09:00:00.000Z",
      windowEnd: "2026-10-01T11:00:00.000Z",
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error.code, "CONFLICT");

    const confirmed = await call(
      "POST",
      `/dock-appointments/${request.json.id}/confirm`,
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.status, "confirmed");

    const listed = await call("GET", "/dock-appointments?facility=FRA-1&date=2026-10-01");
    assert.equal(listed.json.total, 1);
  });

  it("keeps tenants isolated end to end", async () => {
    const created = await call("POST", "/carriers", {
      code: "TENANTX",
      name: "Tenant X Carrier",
      mode: "ltl",
    });
    assert.equal(created.status, 201);

    const otherTenant = { ...TENANT, "x-tenant-id": "other" };
    const fetched = await call("GET", `/carriers/${created.json.id}`, undefined, otherTenant);
    assert.equal(fetched.status, 404);
  });

  it("validates payload shapes with field-level messages", async () => {
    const bad = await call("POST", "/shipments", {
      origin: ORIGIN,
      destination: { name: "Missing fields" },
    });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error.message, /destination\./);
  });
});
