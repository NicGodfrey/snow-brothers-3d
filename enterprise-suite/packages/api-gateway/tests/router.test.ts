import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTenantContext, DomainError, ForbiddenError } from "@enterprise-suite/shared-kernel";
import { html, json, Router, type HttpRequest } from "../src/http/router.js";
import { errorHandler } from "../src/http/middleware/error-handler.js";
import { rateLimit } from "../src/http/middleware/rate-limit.js";
import { assertAllowed, authorize } from "../src/http/middleware/authorize.js";
import { tenantContextMiddleware, isAnonymousPath, parseRoles } from "../src/http/middleware/tenant-context.js";
import { StaticPermissionResolver, DEFAULT_ROLE_GRANTS } from "../src/domain/policy.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { MemoryLogger } from "../src/infrastructure/logger.js";
import { InMemoryRateLimitStore } from "../src/infrastructure/rate-limit-store.js";

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: "GET",
    path: "/",
    params: {},
    query: new URLSearchParams(),
    headers: {},
    body: undefined,
    rawUrl: "/",
    ctx: createTenantContext("acme", "u_1", ["tenant-admin"]),
    locals: {},
    ...overrides,
  };
}

describe("router", () => {
  it("dispatches by specificity and binds params", async () => {
    const router = new Router()
      .get("/tenants/:tenantKey", (req) => json(200, { key: req.params["tenantKey"] }))
      .get("/tenants/active", () => json(200, { key: "literal" }));

    assert.deepEqual((await router.handle(request({ path: "/tenants/active" }))).body, { key: "literal" });
    assert.deepEqual((await router.handle(request({ path: "/tenants/t_1" }))).body, { key: "t_1" });
  });

  it("answers 404 and 405 without a handler", async () => {
    const router = new Router().post("/things", () => json(201));
    const notFound = await router.handle(request({ path: "/nope" }));
    assert.equal(notFound.status, 404);
    const wrongMethod = await router.handle(request({ path: "/things" }));
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers?.["allow"], "POST");
  });

  it("runs middleware as an onion around the handler", async () => {
    const order: string[] = [];
    const router = new Router()
      .use(async (_req, next) => {
        order.push("outer:before");
        const response = await next();
        order.push("outer:after");
        return { ...response, headers: { ...(response.headers ?? {}), "x-outer": "1" } };
      })
      .use(async (_req, next) => {
        order.push("inner:before");
        const response = await next();
        order.push("inner:after");
        return response;
      })
      .get("/", () => {
        order.push("handler");
        return json(200, { ok: true });
      });

    const response = await router.handle(request());
    assert.deepEqual(order, ["outer:before", "inner:before", "handler", "inner:after", "outer:after"]);
    assert.equal(response.headers?.["x-outer"], "1");
  });

  it("names routes before the chain runs so middleware can guard them", async () => {
    const seen: (string | undefined)[] = [];
    const router = new Router()
      .use(async (req, next) => {
        seen.push(req.locals["routeName"] as string | undefined);
        return next();
      })
      .get("/reports", () => json(200), "reports.list");

    await router.handle(request({ path: "/reports" }));
    assert.deepEqual(seen, ["reports.list"]);
  });

  it("mounts a sub-router under a prefix", async () => {
    const sub = new Router().get("/flags", () => json(200, { mounted: true }));
    const root = new Router().mount("/api/admin", sub);
    const response = await root.handle(request({ path: "/api/admin/flags" }));
    assert.deepEqual(response.body, { mounted: true });
    assert.deepEqual(root.patterns(), ["GET /api/admin/flags"]);
  });

  it("carries HTML responses through unchanged", async () => {
    const router = new Router().get("/ui", () => html(200, "<h1>Admin</h1>"));
    const response = await router.handle(request({ path: "/ui" }));
    assert.equal(response.contentType, "text/html; charset=utf-8");
    assert.equal(response.raw, "<h1>Admin</h1>");
  });
});

describe("error handler middleware", () => {
  it("maps domain errors to their status and logs 5xx only", async () => {
    const logger = new MemoryLogger();
    const router = new Router()
      .use(errorHandler({ logger, service: "test" }))
      .get("/forbidden", () => {
        throw new ForbiddenError("nope");
      })
      .get("/boom", () => {
        throw new Error("kaboom");
      })
      .get("/upstream", () => {
        throw new DomainError("upstream exploded", "UPSTREAM", 502);
      });

    const forbidden = await router.handle(request({ path: "/forbidden" }));
    assert.equal(forbidden.status, 403);
    assert.equal((forbidden.body as { code: string }).code, "FORBIDDEN");
    assert.equal(logger.withLevel("error").length, 0);

    const upstream = await router.handle(request({ path: "/upstream" }));
    assert.equal(upstream.status, 502);
    assert.equal(logger.withLevel("error").length, 1);

    const boom = await router.handle(request({ path: "/boom" }));
    assert.equal(boom.status, 500);
    assert.equal((boom.body as { message: string }).message, "Internal server error");
    assert.equal(logger.withLevel("error").length, 2);
    assert.ok((boom.body as { requestId: string }).requestId);
  });
});

describe("tenant context middleware", () => {
  const chain = (path: string, headers: Record<string, string>) => {
    const router = new Router()
      .use(errorHandler({}))
      .use(tenantContextMiddleware({ anonymousPaths: ["/health"] }))
      .get("/health", () => json(200, { ok: true }))
      .get("/data", (req) => json(200, { tenant: String(req.ctx.tenantId), roles: req.ctx.roles.map(String) }));
    return router.handle(request({ path, headers }));
  };

  it("populates the context from headers", async () => {
    const response = await chain("/data", {
      "x-tenant-id": "globex",
      "x-user-id": "u_7",
      "x-roles": "tenant-admin, auditor",
    });
    assert.deepEqual(response.body, { tenant: "globex", roles: ["tenant-admin", "auditor"] });
    assert.equal(response.headers?.["x-tenant-id"], "globex");
  });

  it("allows listed anonymous paths and blocks the rest", async () => {
    assert.equal((await chain("/health", {})).status, 200);
    const blocked = await chain("/data", {});
    assert.equal(blocked.status, 400);
    assert.equal((blocked.body as { code: string }).code, "TENANT_REQUIRED");
  });

  it("matches anonymous prefixes and parses role lists", () => {
    assert.equal(isAnonymousPath("/health/ready", ["/health/*"]), true);
    assert.equal(isAnonymousPath("/health", ["/health/*"]), true);
    assert.equal(isAnonymousPath("/healthz", ["/health"]), false);
    assert.deepEqual(parseRoles(" a , b ,", ["viewer"]), ["a", "b"]);
    assert.deepEqual(parseRoles("", ["viewer"]), ["viewer"]);
  });
});

describe("throttling and authorization middleware", () => {
  it("returns 429 with headers once the window is exhausted", async () => {
    const clock = new FixedClock();
    const store = new InMemoryRateLimitStore();
    const router = new Router()
      .use(rateLimit({ store, clock, limit: 2, windowMs: 1_000 }))
      .get("/things", () => json(200));

    assert.equal((await router.handle(request({ path: "/things" }))).status, 200);
    const second = await router.handle(request({ path: "/things" }));
    assert.equal(second.headers?.["x-ratelimit-remaining"], "0");
    const third = await router.handle(request({ path: "/things" }));
    assert.equal(third.status, 429);
    assert.equal(third.headers?.["retry-after"], "1");

    clock.advance(1_001);
    assert.equal((await router.handle(request({ path: "/things" }))).status, 200);
  });

  it("skips probe paths", async () => {
    const router = new Router()
      .use(rateLimit({ store: new InMemoryRateLimitStore(), clock: new FixedClock(), limit: 1, windowMs: 1_000 }))
      .get("/health", () => json(200));
    assert.equal((await router.handle(request({ path: "/health" }))).status, 200);
    assert.equal((await router.handle(request({ path: "/health" }))).status, 200);
  });

  it("enforces per-route requirements by route name", async () => {
    const resolver = new StaticPermissionResolver(DEFAULT_ROLE_GRANTS);
    const router = new Router()
      .use(errorHandler({}))
      .use(
        authorize({
          requirements: { "flags.write": { allOfPermissions: ["feature-flag:write"] } },
          resolver,
          publicRoutes: ["flags.read"],
        }),
      )
      .get("/flags", () => json(200), "flags.read")
      .post("/flags", () => json(201), "flags.write");

    const read = await router.handle(
      request({ path: "/flags", ctx: createTenantContext("acme", "u", ["viewer"]) }),
    );
    assert.equal(read.status, 200);

    const denied = await router.handle(
      request({ method: "POST", path: "/flags", ctx: createTenantContext("acme", "u", ["auditor"]) }),
    );
    assert.equal(denied.status, 403);

    const allowed = await router.handle(
      request({ method: "POST", path: "/flags", ctx: createTenantContext("acme", "u", ["tenant-admin"]) }),
    );
    assert.equal(allowed.status, 201);
  });

  it("exposes an imperative check for handlers", () => {
    const resolver = new StaticPermissionResolver(DEFAULT_ROLE_GRANTS);
    const req = request({ ctx: createTenantContext("acme", "u", ["auditor"]) });
    assert.throws(() => assertAllowed(req, { anyOfRoles: ["tenant-admin"] }), ForbiddenError);
    assert.throws(
      () => assertAllowed(req, { allOfPermissions: ["tenant:write"] }, resolver),
      ForbiddenError,
    );
    assert.doesNotThrow(() => assertAllowed(req, { allOfPermissions: ["audit:read"] }, resolver));
  });
});
