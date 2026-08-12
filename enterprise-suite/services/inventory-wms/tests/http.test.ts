import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createInventoryModule, startServer, type InventoryModule } from "../src/index.js";

let server: Server;
let module_: InventoryModule;
let baseUrl: string;

const WRITE_HEADERS = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-http",
  "x-user-id": "user-http",
  "x-roles": "inventory.write",
};

const READ_HEADERS = {
  "x-tenant-id": "tenant-http",
  "x-user-id": "user-http",
  "x-roles": "viewer",
};

async function post(path: string, body?: unknown, headers: Record<string, string> = WRITE_HEADERS) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as never };
}

async function get(path: string, headers: Record<string, string> = READ_HEADERS) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: (await res.json()) as never };
}

before(async () => {
  module_ = createInventoryModule();
  server = await startServer(module_, 0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

test("health probe is unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; service: string };
  assert.equal(body.status, "ok");
  assert.equal(body.service, "inventory-wms");
});

test("requests without tenant headers are rejected with 401", async () => {
  const res = await fetch(`${baseUrl}/warehouses`);
  assert.equal(res.status, 401);
});

test("mutations require the inventory.write role", async () => {
  const res = await post("/warehouses", { code: "WH9", name: "Nope" }, {
    "content-type": "application/json",
    ...READ_HEADERS,
  });
  assert.equal(res.status, 403);
});

test("end-to-end warehouse flow over HTTP: topology, receipt, reservation, fulfillment", async () => {
  // 1. Topology
  const warehouse = await post("/warehouses", { code: "WH-HTTP", name: "HTTP DC" });
  assert.equal(warehouse.status, 201);
  const warehouseId = (warehouse.body as { id: string }).id;

  const zone = await post(`/warehouses/${warehouseId}/zones`, {
    code: "STO",
    name: "Storage",
    zoneType: "STORAGE",
  });
  assert.equal(zone.status, 201);
  const zoneId = (zone.body as { id: string }).id;

  const bin = await post(`/warehouses/${warehouseId}/bins`, {
    zoneId,
    code: "S-01",
    binType: "SHELF",
    pickSequence: 1,
  });
  assert.equal(bin.status, 201);
  const binId = (bin.body as { id: string }).id;

  const topology = await get(`/warehouses/${warehouseId}/topology`);
  assert.equal(topology.status, 200);
  assert.equal((topology.body as { zones: unknown[] }).zones.length, 1);

  // 2. Receipt with a lot
  const receipt = await post("/stock/receipts", {
    warehouseId,
    binId,
    sku: "HTTP-SKU",
    quantity: 25,
    lot: { lotCode: "L-HTTP", expiresAt: "2027-01-01T00:00:00Z" },
    ref: { type: "PURCHASE_ORDER", id: "PO-HTTP" },
  });
  assert.equal(receipt.status, 201);
  const receiptBody = receipt.body as { balance: { onHand: number }; lot: { id: string } };
  assert.equal(receiptBody.balance.onHand, 25);
  assert.ok(receiptBody.lot.id);

  // 3. Availability
  const availability = await get(`/stock/availability/HTTP-SKU?warehouseId=${warehouseId}`);
  assert.equal(availability.status, 200);
  assert.equal((availability.body as { available: number }).available, 25);

  // 4. Reservation
  const reservation = await post("/reservations", {
    salesOrderId: "SO-HTTP",
    warehouseId,
    lines: [{ sku: "HTTP-SKU", qty: 10 }],
  });
  assert.equal(reservation.status, 201);
  const reservationBody = reservation.body as {
    reservation: { id: string; status: string };
    shortages: unknown[];
  };
  assert.equal(reservationBody.reservation.status, "ALLOCATED");
  assert.equal(reservationBody.shortages.length, 0);

  // 5. Pick tasks
  const picks = await post(`/reservations/${reservationBody.reservation.id}/pick-tasks`);
  assert.equal(picks.status, 200);
  const pickItems = (picks.body as { items: { id: string }[] }).items;
  assert.equal(pickItems.length, 1);

  // 6. Fulfill
  const fulfilled = await post(`/reservations/${reservationBody.reservation.id}/fulfill`);
  assert.equal(fulfilled.status, 200);
  assert.equal((fulfilled.body as { status: string }).status, "FULFILLED");

  const after_ = await get(`/stock/availability/HTTP-SKU?warehouseId=${warehouseId}`);
  assert.equal((after_.body as { onHand: number }).onHand, 15);

  // 7. Ledger shows RECEIPT + ISSUE
  const ledger = await get(`/stock/transactions?sku=HTTP-SKU`);
  const items = (ledger.body as { items: { txnType: string }[] }).items;
  assert.deepEqual(
    items.map((t) => t.txnType),
    ["RECEIPT", "ISSUE"],
  );
});

test("domain errors map to HTTP status codes with structured bodies", async () => {
  // 404 route
  const missingRoute = await get("/nope");
  assert.equal(missingRoute.status, 404);

  // 404 aggregate
  const missingWarehouse = await get("/warehouses/wh_missing");
  assert.equal(missingWarehouse.status, 404);
  assert.equal((missingWarehouse.body as { error: { code: string } }).error.code, "NOT_FOUND");

  // 400 validation
  const invalid = await post("/warehouses", { code: "bad code!", name: "X" });
  assert.equal(invalid.status, 400);

  // 405 wrong method on an existing path
  const wrongMethod = await fetch(`${baseUrl}/warehouses/abc/topology`, {
    method: "POST",
    headers: WRITE_HEADERS,
    body: "{}",
  });
  assert.equal(wrongMethod.status, 405);

  // 400 malformed JSON
  const badJson = await fetch(`${baseUrl}/warehouses`, {
    method: "POST",
    headers: WRITE_HEADERS,
    body: "{not json",
  });
  assert.equal(badJson.status, 400);
  const badJsonBody = (await badJson.json()) as { error: { code: string } };
  assert.equal(badJsonBody.error.code, "INVALID_JSON");
});

test("insufficient stock over HTTP returns 409 INSUFFICIENT_STOCK", async () => {
  const warehouse = await post("/warehouses", { code: "WH-409", name: "Conflict DC" });
  const warehouseId = (warehouse.body as { id: string }).id;
  const zone = await post(`/warehouses/${warehouseId}/zones`, {
    code: "Z1",
    name: "Z",
    zoneType: "STORAGE",
  });
  const bin = await post(`/warehouses/${warehouseId}/bins`, {
    zoneId: (zone.body as { id: string }).id,
    code: "B1",
    binType: "SHELF",
  });
  const binId = (bin.body as { id: string }).id;
  await post("/stock/receipts", { warehouseId, binId, sku: "S409", quantity: 2 });
  const issue = await post("/stock/issues", { warehouseId, binId, sku: "S409", quantity: 5 });
  assert.equal(issue.status, 409);
  assert.equal((issue.body as { error: { code: string } }).error.code, "INSUFFICIENT_STOCK");
});

test("cycle count flow over HTTP", async () => {
  const warehouse = await post("/warehouses", { code: "WH-CC", name: "Count DC" });
  const warehouseId = (warehouse.body as { id: string }).id;
  const zone = await post(`/warehouses/${warehouseId}/zones`, {
    code: "Z1",
    name: "Z",
    zoneType: "STORAGE",
  });
  const bin = await post(`/warehouses/${warehouseId}/bins`, {
    zoneId: (zone.body as { id: string }).id,
    code: "B1",
    binType: "SHELF",
  });
  const binId = (bin.body as { id: string }).id;
  await post("/stock/receipts", { warehouseId, binId, sku: "CC-SKU", quantity: 100 });

  const order = await post("/cycle-counts", { warehouseId, binIds: [binId] });
  assert.equal(order.status, 201);
  const orderId = (order.body as { id: string }).id;

  const started = await post(`/cycle-counts/${orderId}/start`);
  assert.equal(started.status, 200);
  const lineId = (started.body as { lines: { lineId: string }[] }).lines[0]!.lineId;

  const counted = await post(`/cycle-counts/${orderId}/lines/${lineId}/count`, {
    countedQty: 97,
  });
  assert.equal((counted.body as { status: string }).status, "REVIEW");

  const completed = await post(`/cycle-counts/${orderId}/complete`);
  assert.equal(completed.status, 200);
  assert.equal(
    (completed.body as { adjustedLines: unknown[] }).adjustedLines.length,
    1,
  );

  const availability = await get(`/stock/availability/CC-SKU?warehouseId=${warehouseId}`);
  assert.equal((availability.body as { onHand: number }).onHand, 97);
});
