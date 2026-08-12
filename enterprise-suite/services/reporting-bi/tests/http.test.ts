/**
 * HTTP surface.
 *
 * Driven against a real listening server rather than the router object, so
 * header handling, status codes, JSON parsing and the raw CSV download path
 * are all genuinely exercised. The module underneath uses a fixed clock and
 * the shipped catalog, so responses are byte-stable.
 */
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { ReportingCubes } from "../src/application/mappings.js";
import { createReportingBiServer } from "../src/http/server.js";
import { installCatalog } from "../src/infrastructure/catalog.js";
import { FixedClock } from "../src/infrastructure/in-memory/clock.js";
import { createReportingBiModule, type ReportingBiModule } from "../src/infrastructure/module.js";
import { NOW } from "./helpers.js";

const TENANT = "tenant-acme";

let server: Server;
let baseUrl: string;
let module: ReportingBiModule;
const clock = new FixedClock(NOW);

interface Response<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

async function call<T = any>(
  method: string,
  path: string,
  options: { body?: unknown; tenant?: string | null; user?: string; roles?: string } = {},
): Promise<Response<T>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.tenant !== null) headers["x-tenant-id"] = options.tenant ?? TENANT;
  if (options.tenant !== null) headers["x-user-id"] = options.user ?? "http-tester";
  headers["x-roles"] = options.roles ?? "analyst,admin";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  return {
    status: response.status,
    text,
    body: isJson && text.length > 0 ? JSON.parse(text) : undefined,
    headers: response.headers,
  };
}

before(async () => {
  module = createReportingBiModule({ clock, queryCacheSize: 0 });
  server = createReportingBiServer(module, { allowSeeding: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await call("POST", "/admin/install-catalog");
  await call("POST", "/ingest", {
    body: {
      events: [
        event("sales.order.confirmed", "evt-1", "2026-07-05T09:00:00Z", {
          accountId: "ACC-1",
          orderNumber: "SO-1",
          grandTotalMinor: 500_00,
          currency: "EUR",
        }),
        event("sales.order.confirmed", "evt-2", "2026-08-03T09:00:00Z", {
          accountId: "ACC-2",
          orderNumber: "SO-2",
          grandTotalMinor: 300_00,
          currency: "EUR",
        }),
        event("sales.order.cancelled", "evt-3", "2026-08-04T09:00:00Z", {
          accountId: "ACC-2",
          orderNumber: "SO-2",
          reason: "customer-request",
        }),
      ],
    },
  });
});

after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

function event(eventType: string, eventId: string, at: string, payload: unknown) {
  return {
    eventId,
    eventType,
    aggregateType: "Order",
    aggregateId: `agg-${eventId}`,
    tenantId: TENANT,
    occurredAt: at,
    schemaVersion: 1,
    payload,
  };
}

describe("http / plumbing", () => {
  it("serves health and the route index without a tenant", async () => {
    const health = await call("GET", "/health", { tenant: null });
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "reporting-bi");

    const index = await call("GET", "/", { tenant: null });
    assert.equal(index.status, 200);
    assert.ok(index.body.routes.some((route: any) => route.path === "/query"));
  });

  it("demands tenant headers everywhere else", async () => {
    const anonymous = await call("GET", "/cubes", { tenant: null });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error.code, "MISSING_TENANT_CONTEXT");
  });

  it("answers 404 with the method and path that missed", async () => {
    const missing = await call("GET", "/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "ROUTE_NOT_FOUND");
    assert.match(missing.body.error.message, /GET \/nope/);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await fetch(`${baseUrl}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-id": "u" },
      body: "{not json",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as any).error.code, "INVALID_JSON");
  });

  it("maps a domain validation failure to 400 with its code", async () => {
    const response = await call("POST", "/query", { body: { cube: ReportingCubes.salesOrders } });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION");
    assert.match(response.body.error.message, /'metrics'/);
  });

  it("maps a missing aggregate to 404", async () => {
    const response = await call("GET", "/cubes/does_not_exist");
    assert.equal(response.status, 404);
  });

  it("reports catalog size and warehouse freshness on /status", async () => {
    const status = await call("GET", "/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.counts.cubes, 8);
    assert.ok(status.body.counts.metrics > 50);
    assert.equal(status.body.counts.facts, 3);
    const sales = status.body.cubes.find((c: any) => c.cube === ReportingCubes.salesOrders);
    assert.equal(sales.factCount, 3);
    assert.equal(sales.latestFactAt, "2026-08-04T09:00:00.000Z");
  });

  it("keeps one tenant's warehouse invisible to another", async () => {
    const other = await call("GET", "/status", { tenant: "tenant-other" });
    assert.equal(other.body.counts.cubes, 0);
    assert.equal(other.body.counts.facts, 0);
  });
});

describe("http / catalog", () => {
  it("lists dimensions, cubes and metrics", async () => {
    const dimensions = await call("GET", "/dimensions");
    assert.ok(dimensions.body.items.some((d: any) => d.key === "customer"));

    const cubes = await call("GET", "/cubes?status=published");
    assert.equal(cubes.body.items.length, 8);

    const metrics = await call("GET", `/metrics?cube=${ReportingCubes.salesOrders}&status=published`);
    assert.ok(metrics.body.items.some((m: any) => m.code === "average_order_value"));
  });

  it("describes a cube with its schema, metrics and freshness", async () => {
    const described = await call("GET", `/cubes/${ReportingCubes.salesOrders}/describe`);
    assert.equal(described.status, 200);
    const customer = described.body.dimensions.find((d: any) => d.key === "customer");
    assert.equal(customer.required, true);
    // The leaf level is the bare reference; only roll-ups need qualifying.
    assert.deepEqual(
      customer.levels.map((level: any) => level.ref),
      ["customer.segment", "customer"],
    );
    assert.ok(described.body.measureFields.some((m: any) => m.field === "booked_amount_minor"));
    assert.equal(described.body.factCount, 3);
  });

  it("returns the metric dependency graph of a cube", async () => {
    const lineage = await call("GET", `/cubes/${ReportingCubes.salesOrders}/lineage`);
    const aov = lineage.body.items.find((item: any) => item.code === "average_order_value");
    assert.deepEqual(aov.dependsOn.sort(), ["booked_revenue", "orders_booked"]);
  });

  it("defines, publishes and deprecates a metric over HTTP", async () => {
    const created = await call("POST", "/metrics", {
      body: {
        code: "http_shipped_units",
        name: "Shipped units (http)",
        cube: ReportingCubes.salesOrders,
        unit: "quantity",
        aggregation: "sum",
        sourceField: "shipped_units",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "draft");

    const published = await call("POST", "/metrics/http_shipped_units/publish");
    assert.equal(published.body.status, "published");

    const deprecated = await call("POST", "/metrics/http_shipped_units/deprecate", {
      body: { reason: "replaced by units_shipped" },
    });
    assert.equal(deprecated.body.status, "deprecated");
  });

  it("rejects a metric that is neither aggregated nor derived", async () => {
    const response = await call("POST", "/metrics", {
      body: {
        code: "http_broken",
        name: "Broken",
        cube: ReportingCubes.salesOrders,
        unit: "count",
      },
    });
    assert.equal(response.status, 422);
  });

  it("loads dimension members and browses them with their ancestor path", async () => {
    const loaded = await call("POST", "/dimensions/customer/members", {
      body: {
        members: [
          { key: "SEG-ENT", label: "Enterprise", levelKey: "segment" },
          { key: "ACC-1", label: "Northwind", levelKey: "account", parentKey: "SEG-ENT" },
          { key: "ACC-2", label: "Contoso", levelKey: "account", parentKey: "SEG-ENT" },
        ],
      },
    });
    assert.equal(loaded.body.loaded, 3);

    // Accounts, alphabetical by label, each with its ancestor chain.
    const browsed = await call("GET", "/dimensions/customer/members?level=account");
    assert.equal(browsed.body.count, 2);
    assert.deepEqual(
      browsed.body.items.map((item: any) => [item.key, item.path]),
      [
        ["ACC-2", ["Enterprise"]],
        ["ACC-1", ["Enterprise"]],
      ],
    );
  });
});

describe("http / ingest", () => {
  it("tallies a batch instead of failing it", async () => {
    const response = await call("POST", "/ingest", {
      body: {
        events: [
          event("sales.order.confirmed", "evt-1", "2026-07-05T09:00:00Z", { accountId: "ACC-1" }),
          event("weather.storm.forecast", "evt-90", "2026-08-05T09:00:00Z", {}),
          event("sales.account.created", "evt-91", "2026-08-05T09:00:00Z", { accountId: "ACC-3" }),
        ],
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(
      { duplicates: response.body.duplicates, ignored: response.body.ignored, rejected: response.body.rejected },
      { duplicates: 1, ignored: 1, rejected: 1 },
    );
    assert.equal(response.body.deadLetters[0].reason, "no-mapping");
  });

  it("exposes watermarks, dead letters and the mapping catalog", async () => {
    const watermarks = await call("GET", "/ingest/watermarks");
    assert.equal(watermarks.body.items[0].source, "sales");

    const deadLetters = await call("GET", "/ingest/dead-letters?reason=no-mapping&limit=5");
    assert.ok(deadLetters.body.items.length >= 1);

    const mappings = await call("GET", "/ingest/mappings");
    assert.ok(mappings.body.eventTypes.includes("finance.ar.invoice-issued"));
  });

  it("rejects a batch that is not an array of events", async () => {
    const response = await call("POST", "/ingest", { body: { events: "nope" } });
    assert.equal(response.status, 400);
  });
});

describe("http / query", () => {
  it("runs an aggregate query", async () => {
    const response = await call("POST", "/query", {
      body: {
        cube: ReportingCubes.salesOrders,
        metrics: ["booked_revenue", "orders_booked", "average_order_value"],
        dimensions: ["customer"],
        orderBy: [{ key: "booked_revenue", direction: "desc" }],
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.rows.map((row: any) => [row.keys.customer, row.metrics.booked_revenue]),
      [
        ["ACC-1", 50_000],
        ["ACC-2", 30_000],
      ],
    );
    assert.equal(response.body.totals.average_order_value, 40_000);
  });

  it("runs a time series with a comparison window", async () => {
    const response = await call("POST", "/query", {
      body: {
        cube: ReportingCubes.salesOrders,
        metrics: ["booked_revenue"],
        timeGrain: "month",
        timeRange: { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" },
        compareTo: "previous-period",
      },
    });

    assert.equal(response.body.rows[0].metrics.booked_revenue, 30_000);
    assert.equal(response.body.rows[0].comparison.booked_revenue, 50_000);
    assert.equal(response.body.comparison.mode, "previous-period");
  });

  it("answers a scalar with one number", async () => {
    const response = await call("POST", "/query/scalar", {
      body: { cube: ReportingCubes.salesOrders, metric: "orders_booked" },
    });
    assert.deepEqual(response.body, {
      cube: ReportingCubes.salesOrders,
      metric: "orders_booked",
      value: 2,
    });
  });

  it("explains an unknown dimension rather than returning nothing", async () => {
    const response = await call("POST", "/query", {
      body: {
        cube: ReportingCubes.salesOrders,
        metrics: ["booked_revenue"],
        dimensions: ["carrier"],
      },
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /no dimension 'carrier'/);
  });
});

describe("http / kpis and dashboards", () => {
  it("computes a snapshot and lists it on the scorecard", async () => {
    const snapshot = await call("POST", "/kpis/monthly_bookings/snapshot?at=2026-08-12T09:00:00Z");
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.period, "2026-08");
    assert.equal(snapshot.body.value, 30_000);
    assert.equal(snapshot.body.status, "off-track");

    const scorecard = await call("GET", "/scorecard?codes=monthly_bookings");
    assert.equal(scorecard.body.items.length, 1);
    assert.equal(scorecard.body.needsAttention, 1);
  });

  it("retargets a KPI and re-scores it", async () => {
    await call("PATCH", "/kpis/monthly_bookings/target", { body: { target: 10_000 } });
    const snapshot = await call("POST", "/kpis/monthly_bookings/snapshot?at=2026-08-12T09:00:00Z");
    assert.equal(snapshot.body.status, "on-track");
    assert.equal(snapshot.body.attainment, 3);
  });

  it("rejects an unparseable anchor", async () => {
    const response = await call("POST", "/kpis/monthly_bookings/snapshot?at=yesterday");
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /ISO-8601/);
  });

  it("renders the shipped executive dashboard", async () => {
    const rendered = await call("GET", "/dashboards/executive-overview/render?at=2026-08-12T09:00:00Z");
    assert.equal(rendered.status, 200);
    assert.equal(rendered.body.errorCount, 0);
    assert.equal(rendered.body.tiles.length, 7);
    assert.deepEqual(
      [...new Set(rendered.body.tiles.map((tile: any) => tile.kind))].sort(),
      ["kpi", "result"],
    );
  });

  it("renders one tile on its own for incremental refresh", async () => {
    const dashboard = await call("GET", "/dashboards/executive-overview");
    const tile = dashboard.body.tiles.find((t: any) => t.type === "chart");
    const rendered = await call(
      "GET",
      `/dashboards/executive-overview/tiles/${tile.id}/render?at=2026-08-12T09:00:00Z`,
    );

    assert.equal(rendered.status, 200);
    assert.equal(rendered.body.kind, "result");
    assert.equal(rendered.body.result.grain, "month");
  });

  it("404s a tile that is not on the dashboard", async () => {
    const response = await call("GET", "/dashboards/executive-overview/tiles/tile_missing/render");
    assert.equal(response.status, 404);
  });

  it("creates, publishes and archives a dashboard", async () => {
    const created = await call("POST", "/dashboards", {
      body: { code: "http-scratch", title: "Scratch" },
    });
    assert.equal(created.status, 201);

    const tile = await call("POST", "/dashboards/http-scratch/tiles", {
      body: {
        type: "table",
        title: "Customers",
        layout: { row: 0, col: 0, width: 6, height: 2 },
        query: { cube: ReportingCubes.salesOrders, metrics: ["booked_revenue"], dimensions: ["customer"] },
      },
    });
    assert.equal(tile.status, 201);

    const published = await call("POST", "/dashboards/http-scratch/publish");
    assert.equal(published.body.status, "published");

    const moved = await call("PATCH", `/dashboards/http-scratch/tiles/${tile.body.id}`, {
      body: { layout: { col: 6 }, title: "Customers (moved)" },
    });
    assert.equal(moved.body.layout.col, 6);

    const removed = await call("DELETE", `/dashboards/http-scratch/tiles/${tile.body.id}`);
    assert.equal(removed.body.tiles.length, 0);

    const archived = await call("POST", "/dashboards/http-scratch/archive", {
      body: { reason: "scratch space" },
    });
    assert.equal(archived.body.status, "archived");
  });

  it("hides a dashboard from a caller outside its audience", async () => {
    const forbidden = await call("GET", "/dashboards/supply-quality/render", { roles: "viewer" });
    assert.equal(forbidden.status, 403);

    const list = await call("GET", "/dashboards", { roles: "viewer" });
    assert.ok(!list.body.items.some((d: any) => d.code === "supply-quality"));
  });
});

describe("http / exports", () => {
  it("queues a job, runs the worker and downloads the CSV", async () => {
    const requested = await call("POST", "/exports", {
      body: {
        kind: "cube-query",
        format: "csv",
        query: {
          cube: ReportingCubes.salesOrders,
          metrics: ["booked_revenue", "orders_booked"],
          dimensions: ["customer"],
        },
      },
    });
    assert.equal(requested.status, 202);
    assert.equal(requested.body.status, "queued");

    const ran = await call("POST", "/exports/run");
    assert.equal(ran.body.ran, 1);

    const download = await call("GET", `/exports/${requested.body.jobNumber}/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-type") ?? "", /text\/csv/);
    assert.equal(
      download.headers.get("content-disposition"),
      `attachment; filename="${requested.body.jobNumber}.csv"`,
    );
    assert.equal(download.headers.get("x-checksum-sha256")?.length, 64);
    assert.match(download.text, /^Customer,Customer Key,Booked revenue,Orders booked\r\n/);
    assert.match(download.text, /Northwind,ACC-1,500\.00,1/);
  });

  it("will not download a job that has not run", async () => {
    const requested = await call("POST", "/exports", {
      body: { kind: "kpi-scorecard", format: "ndjson" },
    });
    const download = await call("GET", `/exports/${requested.body.jobNumber}/download`);
    assert.equal(download.status, 409);

    await call("POST", `/exports/${requested.body.jobNumber}/cancel`, { body: { reason: "not needed" } });
    const cancelled = await call("GET", `/exports/${requested.body.jobNumber}`);
    assert.equal(cancelled.body.status, "cancelled");
  });

  it("lists jobs by status", async () => {
    const completed = await call("GET", "/exports?status=completed");
    assert.ok(completed.body.items.length >= 1);
    assert.ok(completed.body.items.every((job: any) => job.status === "completed"));
  });

  it("rejects an export kind it does not know", async () => {
    const response = await call("POST", "/exports", { body: { kind: "pdf" } });
    assert.equal(response.status, 400);
  });
});

describe("http / outbox", () => {
  it("exposes pending events and drains them once", async () => {
    const pending = await call("GET", "/outbox");
    assert.ok(pending.body.items.length > 0);

    const drained = await call("POST", "/outbox/drain");
    assert.equal(drained.body.drained, pending.body.items.length);
    assert.deepEqual((await call("GET", "/outbox")).body.items, []);
  });
});
