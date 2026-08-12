import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { addDays, isoDate, startOfIsoWeek } from "../src/domain/calendar.js";
import { createSupplyChainServer } from "../src/http/server.js";
import { createSupplyChainModule, type SupplyChainModule } from "../src/infrastructure/module.js";

const monday = startOfIsoWeek(isoDate(new Date().toISOString().slice(0, 10)));
const week = (n: number) => addDays(monday, n * 7);

let module: SupplyChainModule;
let server: Server;
let base: string;

const headers = {
  "content-type": "application/json",
  "x-tenant-id": "acme",
  "x-user-id": "planner-9",
  "x-roles": "planner,viewer",
};

async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

describe("HTTP API end to end", () => {
  before(async () => {
    module = createSupplyChainModule();
    server = createSupplyChainServer(module);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("serves health without authentication", async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "supply-chain" });
  });

  it("rejects tenant-scoped routes without x-tenant-id", async () => {
    const response = await fetch(`${base}/items`);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "UNAUTHENTICATED");
  });

  it("returns 404 for unknown routes and 400 for malformed JSON", async () => {
    assert.equal((await api("GET", "/nope")).status, 404);
    const bad = await fetch(`${base}/items`, { method: "POST", headers, body: "{oops" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "INVALID_JSON");
  });

  it("validates request bodies at the boundary", async () => {
    const missing = await api("POST", "/items", { sku: "X" });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "VALIDATION");

    const buyWithBom = await api("POST", "/items", {
      sku: "BAD-BUY",
      description: "Buy item with BOM",
      procurementType: "BUY",
      leadTimeDays: 7,
      bom: [{ componentSku: "OTHER", qtyPer: 1 }],
    });
    assert.equal(buyWithBom.status, 400);
    assert.match(buyWithBom.json.error.message, /BUY items cannot carry a BOM/);
  });

  it("runs the full planner workflow: item, policy, forecast, run, plan, ATP/CTP, allocation", async () => {
    // Safety stock policy + preview calculator.
    const policy = await api("POST", "/safety-stock-policies", {
      name: "Static 10",
      method: { type: "STATIC", qty: 10 },
    });
    assert.equal(policy.status, 201);

    const preview = await api("POST", "/safety-stock-policies/preview", {
      method: { type: "SERVICE_LEVEL", serviceLevel: 0.95 },
      weeklyDemandSeries: [50, 70, 60, 80],
      leadTimeDays: 14,
    });
    assert.equal(preview.status, 200);
    assert.ok(preview.json.safetyStock > 0);

    // Item master.
    const item = await api("POST", "/items", {
      sku: "FG-WIDGET",
      description: "Widget",
      procurementType: "BUY",
      leadTimeDays: 7,
      preferredSupplierId: "SUP-1",
      safetyStockPolicyId: policy.json.id,
    });
    assert.equal(item.status, 201);
    const duplicate = await api("POST", "/items", {
      sku: "FG-WIDGET",
      description: "Widget again",
      procurementType: "BUY",
      leadTimeDays: 7,
    });
    assert.equal(duplicate.status, 409);

    // Projections and supplier capacity.
    assert.equal((await api("PUT", "/inventory", { sku: "FG-WIDGET", location: "DC-1", onHandQty: 100 })).status, 204);
    const calendar = await api("POST", "/supplier-calendars", { supplierId: "SUP-1", defaultWeeklyCapacity: 50 });
    assert.equal(calendar.status, 201);

    // Forecast lifecycle.
    const forecast = await api("POST", "/forecasts", {
      sku: "FG-WIDGET",
      location: "DC-1",
      entries: [
        { weekStart: week(2), qty: 60 },
        { weekStart: week(3), qty: 60 },
      ],
    });
    assert.equal(forecast.status, 201);
    assert.equal((await api("POST", `/forecasts/${forecast.json.id}/publish`)).status, 200);
    const published = await api("GET", "/forecasts?sku=FG-WIDGET&status=PUBLISHED");
    assert.equal(published.json.forecasts.length, 1);

    // Planning run.
    const run = await api("POST", "/planning-runs", { location: "DC-1", horizonWeeks: 6 });
    assert.equal(run.status, 201);
    const executed = await api("POST", `/planning-runs/${run.json.id}/execute`);
    assert.equal(executed.status, 200);
    assert.equal(executed.json.status, "COMPLETED");
    assert.equal(executed.json.stats.itemsPlanned, 1);

    const audit = await api("GET", `/planning-runs/${run.json.id}/audit`);
    assert.equal(audit.status, 200);
    assert.ok(audit.json.audit.length >= 4);

    // Supply plan inspection: OH 100 covers week 2 (60) but week 3 needs
    // 30 to restore SS 10 -> one purchase order of 30.
    const plans = await api("GET", `/supply-plans?runId=${run.json.id}`);
    assert.equal(plans.json.plans.length, 1);
    const planDetail = await api("GET", `/supply-plans/${plans.json.plans[0].id}`);
    assert.equal(planDetail.json.orders.length, 1);
    assert.equal(planDetail.json.orders[0].qty, 30);
    assert.equal(planDetail.json.orders[0].orderType, "PURCHASE");

    // Firm then release; cancel of a released order must conflict.
    const planId = planDetail.json.id;
    const orderId = planDetail.json.orders[0].orderId;
    assert.equal((await api("POST", `/supply-plans/${planId}/orders/${orderId}/firm`)).json.status, "FIRMED");
    assert.equal((await api("POST", `/supply-plans/${planId}/orders/${orderId}/release`)).json.status, "RELEASED");
    assert.equal((await api("POST", `/supply-plans/${planId}/orders/${orderId}/cancel`)).status, 409);

    // ATP: on-hand only (released orders re-enter via procurement later).
    const atp = await api("GET", "/atp?sku=FG-WIDGET&location=DC-1&weeks=6");
    assert.equal(atp.status, 200);
    assert.equal(atp.json.rows[0].atp, 100);

    // CTP: 150 needs 50 beyond ATP, coverable by SUP-1 capacity.
    const ctp = await api("POST", "/ctp", {
      sku: "FG-WIDGET",
      location: "DC-1",
      qty: 150,
      needDate: week(2),
    });
    assert.equal(ctp.status, 200);
    assert.equal(ctp.json.canPromise, true);
    assert.equal(ctp.json.qtyFromAtp, 100);
    assert.equal(ctp.json.qtyFromNewSupply, 50);

    // Allocations: over-commitment is rejected unless forced.
    const rejected = await api("POST", "/allocations", {
      sku: "FG-WIDGET",
      location: "DC-1",
      qty: 150,
      needDate: week(2),
      demandRef: "SO-1",
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.json.error.code, "INSUFFICIENT_ATP");

    const forced = await api("POST", "/allocations", {
      sku: "FG-WIDGET",
      location: "DC-1",
      qty: 150,
      needDate: week(2),
      demandRef: "SO-1",
      force: true,
    });
    assert.equal(forced.status, 201);

    const smaller = await api("POST", "/allocations", {
      sku: "FG-WIDGET",
      location: "DC-1",
      qty: 10,
      needDate: week(2),
      demandRef: "SO-2",
    });
    assert.equal(smaller.status, 422, "forced allocation consumed all ATP");

    assert.equal((await api("POST", `/allocations/${forced.json.id}/cancel`)).status, 200);
    const afterCancel = await api("POST", "/allocations", {
      sku: "FG-WIDGET",
      location: "DC-1",
      qty: 10,
      needDate: week(2),
      demandRef: "SO-2",
    });
    assert.equal(afterCancel.status, 201);

    // Capacity load report reflects the item's supplier.
    const load = await api("GET", "/supplier-capacity-load?supplierId=SUP-1&weeks=6");
    assert.equal(load.status, 200);
    assert.equal(load.json.rows.length, 6);
    assert.ok(load.json.rows.every((r: { capacityQty: number }) => r.capacityQty === 50));

    // Tenant isolation: another tenant sees none of this.
    const otherTenant = await api("GET", "/items", undefined, { "x-tenant-id": "globex" });
    assert.equal(otherTenant.json.items.length, 0);
  });
});
