import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTenantContext } from "@enterprise-suite/shared-kernel";
import { GatewayService } from "../src/application/gateway-service.js";
import { DEFAULT_ROLE_GRANTS, StaticPermissionResolver, evaluateAuth } from "../src/domain/policy.js";
import { RouteTable } from "../src/domain/route-table.js";
import { ServiceCatalog, defineService } from "../src/domain/service-catalog.js";
import type { RouteDefinition } from "../src/domain/route.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { InMemoryRateLimitStore } from "../src/infrastructure/rate-limit-store.js";

const catalog = new ServiceCatalog([
  defineService({
    id: "product-plm",
    label: "Product PLM",
    system: "ERP",
    prefix: "/api/plm",
    baseUrl: "http://127.0.0.1:4105",
    critical: true,
  }),
  defineService({
    id: "srm-core",
    label: "SRM Core",
    system: "SRM",
    prefix: "/api/srm",
    baseUrl: "http://127.0.0.1:4113",
    planned: true,
  }),
]);

const routes: RouteDefinition[] = [
  {
    id: "plm.products.get",
    method: "GET",
    pattern: "/api/plm/products/:productId",
    upstream: "product-plm",
    auth: { mode: "tenant" },
  },
  {
    id: "plm.products.create",
    method: "POST",
    pattern: "/api/plm/products",
    upstream: "product-plm",
    auth: { mode: "roles", anyOfRoles: ["product-manager", "tenant-admin"] },
    rateLimit: { limit: 2, windowMs: 60_000, key: "tenant-user" },
  },
  {
    id: "plm.health",
    method: "GET",
    pattern: "/api/plm/health",
    upstream: "product-plm",
    auth: { mode: "anonymous" },
  },
  {
    id: "plm.costing",
    method: "POST",
    pattern: "/api/plm/products/:productId/cost-rollup",
    upstream: "product-plm",
    auth: { mode: "tenant", allOfPermissions: ["tenant:write"] },
    timeoutMs: 45_000,
  },
  {
    id: "srm.suppliers.list",
    method: "GET",
    pattern: "/api/srm/suppliers",
    upstream: "srm-core",
    auth: { mode: "tenant" },
  },
];

const resolver = new StaticPermissionResolver(DEFAULT_ROLE_GRANTS);
let clock: FixedClock;
let limits: InMemoryRateLimitStore;
let gateway: GatewayService;

beforeEach(() => {
  clock = new FixedClock();
  limits = new InMemoryRateLimitStore();
  gateway = new GatewayService(new RouteTable(routes), catalog, limits, clock, {
    permissions: resolver,
    defaultTimeoutMs: 10_000,
  });
});

const ctx = (tenant = "acme", user = "u_1", roles: string[] = ["viewer"]) =>
  createTenantContext(tenant, user, roles);

describe("request resolution", () => {
  it("forwards to the upstream with the prefix stripped and context headers set", () => {
    const decision = gateway.resolve({
      method: "GET",
      path: "/api/plm/products/p_1",
      query: "expand=bom",
      headers: { "content-type": "application/json", host: "gateway.internal", connection: "keep-alive" },
      ctx: ctx(),
      clientIp: "10.1.2.3",
    });
    assert.equal(decision.kind, "forward");
    if (decision.kind !== "forward") return;
    assert.equal(decision.targetUrl, "http://127.0.0.1:4105/products/p_1?expand=bom");
    assert.equal(decision.headers["x-tenant-id"], "acme");
    assert.equal(decision.headers["x-user-id"], "u_1");
    assert.equal(decision.headers["x-forwarded-for"], "10.1.2.3");
    assert.equal(decision.headers["x-gateway-route"], "plm.products.get");
    assert.equal(decision.headers["content-type"], "application/json");
    assert.equal(decision.headers["host"], undefined, "hop-by-hop headers are dropped");
    assert.equal(decision.headers["connection"], undefined);
    assert.equal(decision.idempotent, true);
    assert.equal(decision.timeoutMs, 10_000);
  });

  it("honours per-route timeouts", () => {
    const decision = gateway.resolve({
      method: "POST",
      path: "/api/plm/products/p_1/cost-rollup",
      ctx: ctx("acme", "u_1", ["tenant-admin"]),
    });
    assert.equal(decision.kind === "forward" && decision.timeoutMs, 45_000);
  });

  it("answers 404 and 405 from the route table", () => {
    const missing = gateway.resolve({ method: "GET", path: "/api/plm/unknown", ctx: ctx() });
    assert.equal(missing.kind === "reject" && missing.status, 404);
    const wrongMethod = gateway.resolve({ method: "DELETE", path: "/api/plm/products", ctx: ctx() });
    assert.equal(wrongMethod.kind === "reject" && wrongMethod.status, 405);
    assert.equal(wrongMethod.kind === "reject" && wrongMethod.headers?.["allow"], "POST");
  });

  it("returns 501 for a catalogued but undeployed upstream", () => {
    const decision = gateway.resolve({ method: "GET", path: "/api/srm/suppliers", ctx: ctx() });
    assert.equal(decision.kind === "reject" && decision.status, 501);
    assert.equal(decision.kind === "reject" && decision.code, "UPSTREAM_NOT_IMPLEMENTED");
  });
});

describe("authorization", () => {
  it("lets anonymous routes through without a tenant", () => {
    const decision = gateway.resolve({ method: "GET", path: "/api/plm/health" });
    assert.equal(decision.kind, "forward");
  });

  it("demands a tenant for everything else", () => {
    const decision = gateway.resolve({ method: "GET", path: "/api/plm/products/p_1" });
    assert.equal(decision.kind === "reject" && decision.code, "TENANT_REQUIRED");
    assert.equal(decision.kind === "reject" && decision.status, 400);
  });

  it("enforces role membership", () => {
    const denied = gateway.resolve({
      method: "POST",
      path: "/api/plm/products",
      ctx: ctx("acme", "u_1", ["viewer"]),
    });
    assert.equal(denied.kind === "reject" && denied.status, 403);
    assert.deepEqual(
      denied.kind === "reject" ? (denied.details as { required: string[] }).required : [],
      ["product-manager", "tenant-admin"],
    );
    const allowed = gateway.resolve({
      method: "POST",
      path: "/api/plm/products",
      ctx: ctx("acme", "u_1", ["product-manager"]),
    });
    assert.equal(allowed.kind, "forward");
  });

  it("resolves permissions through role grants", () => {
    const denied = gateway.resolve({
      method: "POST",
      path: "/api/plm/products/p_1/cost-rollup",
      ctx: ctx("acme", "u_1", ["viewer"]),
    });
    assert.equal(denied.kind === "reject" && denied.status, 403);
    const wildcard = gateway.resolve({
      method: "POST",
      path: "/api/plm/products/p_1/cost-rollup",
      ctx: ctx("acme", "u_1", ["platform-admin"]),
    });
    assert.equal(wildcard.kind, "forward", "platform-admin holds the * grant");
  });

  it("evaluates auth as a pure function too", () => {
    const route = routes[1]!;
    assert.equal(evaluateAuth(route, ctx("acme", "u_1", ["tenant-admin"])).allowed, true);
    assert.equal(evaluateAuth(route, undefined).code, "TENANT_REQUIRED");
    assert.equal(evaluateAuth(route, ctx("acme", "anonymous", ["tenant-admin"])).code, "UNAUTHENTICATED");
  });
});

describe("rate limiting", () => {
  it("throttles per tenant-user bucket and recovers after the window", () => {
    const caller = ctx("acme", "u_1", ["product-manager"]);
    assert.equal(gateway.resolve({ method: "POST", path: "/api/plm/products", ctx: caller }).kind, "forward");
    assert.equal(gateway.resolve({ method: "POST", path: "/api/plm/products", ctx: caller }).kind, "forward");

    const throttled = gateway.resolve({ method: "POST", path: "/api/plm/products", ctx: caller });
    assert.equal(throttled.kind === "reject" && throttled.status, 429);
    assert.equal(throttled.kind === "reject" && throttled.headers?.["retry-after"], "60");
    assert.equal(throttled.kind === "reject" && throttled.headers?.["x-ratelimit-remaining"], "0");

    const other = ctx("acme", "u_2", ["product-manager"]);
    assert.equal(
      gateway.resolve({ method: "POST", path: "/api/plm/products", ctx: other }).kind,
      "forward",
      "a second user has its own bucket",
    );

    clock.advance(60_001);
    assert.equal(gateway.resolve({ method: "POST", path: "/api/plm/products", ctx: caller }).kind, "forward");
  });

  it("surfaces remaining quota on successful forwards", () => {
    const caller = ctx("acme", "u_3", ["product-manager"]);
    const first = gateway.resolve({ method: "POST", path: "/api/plm/products", ctx: caller });
    assert.equal(first.kind === "forward" && first.headers["x-ratelimit-remaining"], "1");
  });

  it("applies a default policy when a route declares none", () => {
    const strict = new GatewayService(new RouteTable(routes), catalog, limits, clock, {
      permissions: resolver,
      defaultRateLimit: { limit: 1, windowMs: 1_000 },
    });
    const caller = ctx("globex", "u_9");
    assert.equal(strict.resolve({ method: "GET", path: "/api/plm/products/p_1", ctx: caller }).kind, "forward");
    const second = strict.resolve({ method: "GET", path: "/api/plm/products/p_2", ctx: caller });
    assert.equal(second.kind === "reject" && second.status, 429);
  });
});

describe("introspection", () => {
  it("describes routes, services and audit findings", () => {
    const description = gateway.describe();
    assert.equal(description.routes.length, routes.length);
    assert.equal(description.services.length, 2);
    assert.deepEqual(description.findings, []);
  });
});
