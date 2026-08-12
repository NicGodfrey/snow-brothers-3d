import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGatewayContainer, type GatewayContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { MemoryLogger, InMemoryMetrics } from "../src/infrastructure/logger.js";
import { StaticUpstreamProbe } from "../src/infrastructure/http-probe.js";
import { NullSpecSource } from "../src/infrastructure/spec-source.js";
import { buildServiceCatalog } from "../src/infrastructure/catalog.js";
import { createGatewayServer } from "../src/http/server.js";
import type { ForwardDecision } from "../src/application/gateway-service.js";

let server: Server;
let baseUrl: string;
let container: GatewayContainer;
let logger: MemoryLogger;
let metrics: InMemoryMetrics;
const clock = new FixedClock();
const forwarded: ForwardDecision[] = [];

interface CallResult {
  status: number;
  body: any;
  headers: Headers;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; tenant?: string | null; user?: string | null; roles?: string; requestId?: string } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.tenant !== null) headers["x-tenant-id"] = options.tenant ?? "acme";
  if (options.user !== null) headers["x-user-id"] = options.user ?? "u_admin";
  headers["x-roles"] = options.roles ?? "tenant-admin";
  if (options.requestId) headers["x-request-id"] = options.requestId;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const raw = await response.text();
  let body: unknown;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    body = raw;
  }
  return { status: response.status, body, headers: response.headers };
}

before(async () => {
  logger = new MemoryLogger();
  metrics = new InMemoryMetrics();
  container = createGatewayContainer({
    clock,
    logger,
    metrics,
    catalog: buildServiceCatalog({ assumeDeployed: true }),
    probe: new StaticUpstreamProbe({ "marketing-erp": "down" }, clock),
    specSource: new NullSpecSource(),
    openapi: { stubMissing: true, cacheTtlMs: 0 },
  });
  server = createGatewayServer(container, {
    trustHeaders: true,
    forwarder: async (decision) => {
      forwarded.push(decision);
      return {
        status: 200,
        body: { echo: decision.targetUrl, upstream: decision.service.id, route: decision.route.id },
      };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

describe("operational endpoints", () => {
  it("serves liveness without any tenant header", async () => {
    const response = await call("GET", "/health", { tenant: null, user: null });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
    assert.equal(response.body.service, "api-gateway");
  });

  it("reports readiness with a per-upstream breakdown", async () => {
    const response = await call("GET", "/health/ready", { tenant: null, user: null });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "degraded", "marketing-erp is scripted down but not critical");
    assert.equal(response.body.summary.down, 1);
    assert.equal(response.body.upstreams.length, container.catalog.size);
  });

  it("503s when a critical upstream is down", async () => {
    const local = createGatewayContainer({
      clock,
      logger: new MemoryLogger(),
      catalog: buildServiceCatalog({ assumeDeployed: true }),
      probe: new StaticUpstreamProbe({ "finance-erp": "down" }, clock),
      specSource: new NullSpecSource(),
    });
    const criticalServer = createGatewayServer(local);
    await new Promise<void>((resolve) => criticalServer.listen(0, resolve));
    const port = (criticalServer.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { status: string }).status, "unready");
    await new Promise<void>((resolve, reject) => criticalServer.close((e) => (e ? reject(e) : resolve())));
  });

  it("aggregates an OpenAPI document from the route table when upstreams publish nothing", async () => {
    const response = await call("GET", "/openapi.json", { tenant: null, user: null });
    assert.equal(response.status, 200);
    assert.equal(response.body.openapi, "3.1.0");
    const paths = Object.keys(response.body.paths);
    assert.ok(paths.includes("/api/plm/products/{productId}"));
    assert.ok(paths.includes("/api/admin/feature-flags"));
    assert.equal(
      response.body.paths["/api/plm/products/{productId}"].get["x-upstream-service"],
      "product-plm",
    );

    const report = await call("GET", "/openapi/report", { tenant: null, user: null });
    assert.equal(report.body.sources.length, container.catalog.size);
    assert.ok(report.body.sources.every((s: { source: string }) => s.source === "stub"));
    assert.equal(report.body.operationCount > 100, true);
  });

  it("exposes the route table and the upstream catalog", async () => {
    const routes = await call("GET", "/__gateway/routes", { tenant: null, user: null });
    assert.equal(routes.body.count, container.routes.size);
    assert.deepEqual(routes.body.findings, []);
    for (const [method, pattern] of [
      ["POST", "/api/procurement/requisitions/:requisitionId/submit"],
      ["GET", "/api/procurement/approval-requests/inbox"],
      ["POST", "/api/procurement/receipts/:receiptId/post"],
      ["POST", "/api/procurement/invoices/:invoiceId/approve-for-payment"],
      ["POST", "/api/prm/mdf/requests/:requestId/approve"],
    ]) {
      assert.ok(
        routes.body.routes.some(
          (route: { method: string; pattern: string }) =>
            route.method === method && route.pattern === pattern,
        ),
        `${method} ${pattern} is routed`,
      );
    }

    const filtered = await call("GET", "/__gateway/routes?upstream=admin-console", { tenant: null, user: null });
    assert.ok(filtered.body.count > 0);
    assert.ok(filtered.body.routes.every((r: { upstream: string }) => r.upstream === "admin-console"));

    const services = await call("GET", "/__gateway/services", { tenant: null, user: null });
    assert.equal(services.body.count, container.catalog.size);
    assert.ok(
      buildServiceCatalog().list().every((service) => service.planned !== true),
      "runnable suite services default to deployed without ASSUME_DEPLOYED",
    );
    assert.equal(
      services.body.services.find((service: { id: string }) => service.id === "sales-erp")
        .upstreamPrefix,
      "/sales",
    );
  });
});

describe("tenant header middleware", () => {
  it("rejects a tenant-scoped request without x-tenant-id", async () => {
    const response = await call("GET", "/api/plm/products", { tenant: null });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "TENANT_REQUIRED");
    assert.ok(response.body.requestId, "the error envelope carries a correlation id");
  });

  it("rejects a malformed tenant id", async () => {
    const response = await call("GET", "/api/plm/products", { tenant: "not a tenant!" });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "TENANT_REQUIRED");
  });

  it("requires a principal alongside the tenant", async () => {
    const response = await call("GET", "/api/plm/products", { user: null });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, "UNAUTHENTICATED");
  });

  it("echoes the tenant and honours an inbound request id", async () => {
    const response = await call("GET", "/api/plm/products", { requestId: "req_from_client" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-tenant-id"), "acme");
    assert.equal(response.headers.get("x-request-id"), "req_from_client");
  });

  it("mints a request id when the caller sends none", async () => {
    const response = await call("GET", "/api/plm/products");
    assert.match(response.headers.get("x-request-id") ?? "", /^req_/);
  });
});

describe("proxying", () => {
  it("forwards to the upstream with the prefix stripped", async () => {
    forwarded.length = 0;
    const response = await call("GET", "/api/plm/products/p_42?expand=bom");
    assert.equal(response.status, 200);
    assert.equal(response.body.upstream, "product-plm");
    assert.equal(response.body.echo, "http://127.0.0.1:4105/products/p_42?expand=bom");
    assert.equal(forwarded[0]?.params["productId"], "p_42");
    assert.equal(response.headers.get("x-gateway-upstream") ?? forwarded[0]?.service.id, "product-plm");
  });

  it("honours each upstream's real mount path", async () => {
    const cases: Array<[string, string, string, string]> = [
      ["GET", "/api/sales/quotes", "sales-erp", "http://127.0.0.1:4103/sales/quotes"],
      ["GET", "/api/admin/tenants", "admin-console", "http://127.0.0.1:4119/api/admin/tenants"],
      ["GET", "/api/iam/me", "identity-access", "http://127.0.0.1:4101/identity/me"],
      ["POST", "/api/reporting/query", "reporting-bi", "http://127.0.0.1:4118/query"],
      ["GET", "/api/srm/suppliers", "srm-core", "http://127.0.0.1:4113/suppliers"],
      ["GET", "/api/procurement/requisitions", "procurement-srm", "http://127.0.0.1:4114/requisitions"],
      ["GET", "/api/prm/partners", "prm-core", "http://127.0.0.1:4115/partners"],
      ["GET", "/api/integration/webhooks", "integration-hub", "http://127.0.0.1:4117/webhooks"],
    ];

    for (const [method, path, upstream, targetUrl] of cases) {
      const response = await call(method, path, {
        body: method === "POST" ? {} : undefined,
      });
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.equal(response.body.upstream, upstream);
      assert.equal(response.body.echo, targetUrl);
    }
  });

  it("proxies identity and reporting health without tenant headers", async () => {
    const identity = await call("GET", "/api/iam/health", { tenant: null, user: null });
    assert.equal(identity.status, 200);
    assert.equal(identity.body.echo, "http://127.0.0.1:4101/health");

    const reporting = await call("GET", "/api/reporting/health", { tenant: null, user: null });
    assert.equal(reporting.status, 200);
    assert.equal(reporting.body.echo, "http://127.0.0.1:4118/health");
  });

  it("enforces route roles before touching the upstream", async () => {
    forwarded.length = 0;
    const denied = await call("POST", "/api/finance/periods/p_2026_01/close/begin", {
      roles: "accountant",
      body: {},
    });
    assert.equal(denied.status, 403);
    assert.equal(forwarded.length, 0);

    const allowed = await call("POST", "/api/finance/periods/p_2026_01/close/begin", {
      roles: "controller",
      body: {},
    });
    assert.equal(allowed.status, 200);
    assert.equal(forwarded.length, 1);
  });

  it("answers 404 for an unrouted path and 405 for the wrong method", async () => {
    const missing = await call("GET", "/api/plm/nothing/here");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "ROUTE_NOT_FOUND");

    const wrongMethod = await call("DELETE", "/api/sales/orders/o_1");
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "GET, PATCH");
  });

  it("throttles a hot route and reports the standard headers", async () => {
    container.rateLimits.reset();
    const path = "/api/admin/webhooks/wh_1/test";
    let last = await call("POST", path, { body: {}, tenant: "throttle-me" });
    assert.equal(last.status, 200);
    assert.equal(last.headers.get("x-ratelimit-limit"), "20");

    for (let i = 0; i < 20; i += 1) {
      last = await call("POST", path, { body: {}, tenant: "throttle-me" });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.code, "RATE_LIMITED");
    assert.ok(Number(last.headers.get("retry-after")) > 0);

    const otherTenant = await call("POST", path, { body: {}, tenant: "other-tenant" });
    assert.equal(otherTenant.status, 200, "buckets are per tenant");
  });

  it("rejects a body that is not valid JSON", async () => {
    const response = await fetch(`${baseUrl}/api/plm/products`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "acme", "x-user-id": "u_1", "x-roles": "tenant-admin" },
      body: "{ not json",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "BAD_JSON");
  });
});

describe("observability", () => {
  it("records access logs and request metrics", async () => {
    await call("GET", "/api/plm/products/p_metrics");
    const snapshot = metrics.snapshot();
    assert.ok(snapshot.total > 0);
    assert.ok(snapshot.byRoute["product-plm.products.get"]);
    assert.ok(
      logger.entries.some((entry) => entry.message.includes("GET /api/plm/products/p_metrics 200")),
    );
  });

  it("answers CORS preflight for browser callers", async () => {
    const response = await fetch(`${baseUrl}/api/plm/products`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "GET" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.ok(response.headers.get("access-control-allow-headers")?.includes("x-tenant-id"));
  });
});
