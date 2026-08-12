import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildServer } from "../src/http/server.js";
import { createSalesModule } from "../src/infrastructure/container.js";
import { QuoteEventTypes } from "../src/domain/quotes/events.js";
import { OrderEventTypes } from "../src/domain/orders/events.js";

const TENANT = "tenant-http";
const HEADERS = {
  "content-type": "application/json",
  "x-tenant-id": TENANT,
  "x-user-id": "user-http",
  "x-roles": "sales_rep,sales_manager",
};

let server: Server;
let base: string;
const module_ = createSalesModule();

before(async () => {
  server = buildServer(module_);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = HEADERS,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("http: health endpoint is public", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "sales-erp" });
});

test("http: missing tenant header yields 401, unknown route 404", async () => {
  const noTenant = await fetch(`${base}/sales/accounts`);
  assert.equal(noTenant.status, 401);
  const missing = await call("GET", "/sales/nothing-here");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "NOT_FOUND");
});

test("http: validation errors return 422 with field paths", async () => {
  const { status, json } = await call("POST", "/sales/accounts", { accountType: "bogus" });
  assert.equal(status, 422);
  assert.equal(json.error.code, "VALIDATION_FAILED");
  const paths = json.error.details.map((d: { path: string }) => d.path);
  assert.ok(paths.includes("$.name"));
  assert.ok(paths.includes("$.accountType"));
  assert.ok(paths.includes("$.currency"));
});

test("http: quote-to-cash flow across the API surface", async () => {
  // Account + price list.
  const account = await call("POST", "/sales/accounts", {
    name: "HTTP GmbH",
    accountType: "customer",
    currency: "EUR",
    shippingAddress: { line1: "Api-Str. 9", city: "Köln", postalCode: "50667", countryCode: "DE" },
  });
  assert.equal(account.status, 201);
  const accountId = account.json.id;

  const priceList = await call("POST", "/sales/price-lists", {
    name: "HTTP EUR",
    currency: "EUR",
    isDefault: true,
  });
  assert.equal(priceList.status, 201);
  const itemUpsert = await call("POST", `/sales/price-lists/${priceList.json.id}/items`, {
    sku: "HTTP-SKU",
    description: "HTTP item",
    tiers: [
      { minQty: 1, unitPriceMinor: 5_000 },
      { minQty: 10, unitPriceMinor: 4_500 },
    ],
  });
  assert.equal(itemUpsert.status, 200);
  const priced = await call("GET", `/sales/price-lists/${priceList.json.id}/price?sku=HTTP-SKU&qty=12`);
  assert.equal(priced.json.unitPrice.amountMinor, 4_500);

  // Opportunity + quote.
  const opportunity = await call("POST", "/sales/opportunities", {
    accountId,
    name: "HTTP deal",
    amountMinor: 60_000,
    currency: "EUR",
  });
  assert.equal(opportunity.status, 201);

  const quote = await call("POST", "/sales/quotes", {
    accountId,
    opportunityId: opportunity.json.id,
    taxRegion: "DE",
    validUntil: "2099-12-31",
    lines: [{ sku: "HTTP-SKU", qty: 12 }],
  });
  assert.equal(quote.status, 201);
  const quoteId = quote.json.quote.id;
  assert.equal(quote.json.totals.subtotal.amountMinor, 54_000); // 12 x 4500
  assert.equal(quote.json.quote.lines[0].discountPercent, 2.5); // volume default

  assert.equal((await call("POST", `/sales/quotes/${quoteId}/submit`)).status, 200);
  assert.equal((await call("POST", `/sales/quotes/${quoteId}/approve`)).status, 200);
  const accepted = await call("POST", `/sales/quotes/${quoteId}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.order.status, "draft");
  const orderId = accepted.json.order.id;

  // Order fulfilment.
  assert.equal((await call("POST", `/sales/orders/${orderId}/confirm`, {})).status, 200);
  const orderView = await call("GET", `/sales/orders/${orderId}`);
  const lineId = orderView.json.order.lines[0].lineId;
  assert.equal(
    (await call("POST", `/sales/orders/${orderId}/allocate`, { allocations: [{ lineId, qty: 12 }] })).status,
    200,
  );
  const shipped = await call("POST", `/sales/orders/${orderId}/ship`, {
    shipments: [{ lineId, qty: 12 }],
  });
  assert.equal(shipped.json.status, "shipped");
  assert.equal((await call("POST", `/sales/orders/${orderId}/invoice`)).status, 200);
  assert.equal((await call("POST", `/sales/orders/${orderId}/close`)).status, 200);

  // Return two units.
  const rma = await call("POST", "/sales/returns", {
    orderId,
    lines: [{ orderLineId: lineId, qty: 2, reason: "damaged" }],
  });
  assert.equal(rma.status, 201);
  assert.equal((await call("POST", `/sales/returns/${rma.json.id}/approve`)).status, 200);
  assert.equal((await call("POST", `/sales/returns/${rma.json.id}/receive`)).status, 200);
  const refunded = await call("POST", `/sales/returns/${rma.json.id}/refund`);
  assert.equal(refunded.status, 200);
  // 2 x (4500 net of 2.5% = 4388)
  assert.equal(refunded.json.refund.amountMinor, 8_776);

  const orderReturns = await call("GET", `/sales/orders/${orderId}/returns`);
  assert.equal(orderReturns.json.length, 1);

  // Outbox carries the lifecycle events for this tenant.
  const outbox = await call("GET", "/sales/outbox");
  const types = outbox.json.events.map((e: { eventType: string }) => e.eventType);
  assert.ok(types.includes(QuoteEventTypes.QuoteAccepted));
  assert.ok(types.includes(OrderEventTypes.OrderConfirmed));
  assert.ok(types.includes(OrderEventTypes.OrderShipped));

  // Pipeline reflects the won opportunity (no longer open).
  const pipeline = await call("GET", "/sales/opportunities/pipeline");
  assert.equal(pipeline.json.openCount, 0);
});

test("http: tenant isolation across headers", async () => {
  const created = await call("POST", "/sales/accounts", {
    name: "Isolated",
    accountType: "prospect",
    currency: "EUR",
  });
  const otherTenant = { ...HEADERS, "x-tenant-id": "tenant-other" };
  const lookup = await call("GET", `/sales/accounts/${created.json.id}`, undefined, otherTenant);
  assert.equal(lookup.status, 404);
});
