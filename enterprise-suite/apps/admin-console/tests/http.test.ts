import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Router } from "@enterprise-suite/api-gateway";
import { seedDemoData, SEED_TENANT_KEY } from "../src/infrastructure/seed.js";
import {
  ADMIN_BASE_PATH,
  buildAdminRouter,
  callAdmin,
  PUBLIC_ROUTES,
  ROUTE_PERMISSIONS,
} from "../src/http/server.js";
import { harness, type Harness } from "./support.js";

/**
 * The API as a client sees it: header contract, authorization, and the
 * end-to-end flows the console shell drives.
 */

const admin = { tenant: SEED_TENANT_KEY, user: "ada@northwind.example", roles: ["tenant-admin"] };
const api = (path: string) => `${ADMIN_BASE_PATH}${path}`;

async function seededRouter(): Promise<{ h: Harness; router: Router }> {
  const h = harness();
  await seedDemoData(h.container);
  return { h, router: buildAdminRouter(h.container, { shell: { enabled: true } }) };
}

describe("operational endpoints", () => {
  it("answers liveness and readiness without a tenant header", async () => {
    const { router } = await seededRouter();

    const live = await callAdmin(router, "GET", "/health");
    assert.equal(live.status, 200);
    assert.equal(live.body.status, "ok");

    const ready = await callAdmin(router, "GET", "/health/ready");
    assert.equal(ready.status, 200);
    assert.equal(ready.body.status, "ready");
    assert.deepEqual(
      ready.body.checks.map((check: { name: string }) => check.name).sort(),
      ["tenant-store", "webhook-queue"],
    );
  });

  it("reports a degraded queue as not ready", async () => {
    const { h, router } = await seededRouter();
    h.sender.respondWith("https://hooks.northwind.example", { statusCode: 500, durationMs: 3 });
    await h.container.services.user.invite(h.admin, {
      email: "queued@northwind.example",
      displayName: "Queued",
      roles: ["tenant-operator"],
    });

    const ready = await callAdmin(router, "GET", "/health/ready?maxBacklog=0");
    assert.equal(ready.status, 503);
    assert.equal(ready.body.status, "degraded");
  });

  it("serves the shell and echoes the request id on every response", async () => {
    const { router } = await seededRouter();

    const page = await callAdmin(router, "GET", "/");
    assert.equal(page.status, 200);
    assert.ok(String(page.body).includes("Admin Console"));
    assert.ok(String(page.body).includes(ADMIN_BASE_PATH), "the shell is told where the API lives");

    const correlated = await callAdmin(router, "GET", api("/overview"), {
      ...admin,
      headers: { "x-request-id": "req_from_caller" },
    });
    assert.equal(correlated.headers["x-request-id"], "req_from_caller");
    assert.equal(correlated.headers["x-tenant-id"], SEED_TENANT_KEY);
  });
});

describe("OpenAPI document", () => {
  it("describes the routes as registered, with their permission requirements", async () => {
    const { router } = await seededRouter();
    const response = await callAdmin(router, "GET", "/openapi.json");
    const document = response.body;

    assert.equal(response.status, 200);
    assert.equal(document.openapi, "3.1.0");
    assert.deepEqual(document.servers, [{ url: ADMIN_BASE_PATH }]);

    const suspend = document.paths[`${ADMIN_BASE_PATH}/users/{userKey}/suspend`]?.post;
    assert.ok(suspend, "path parameters are rewritten into OpenAPI syntax");
    assert.deepEqual(suspend["x-required-permissions"], ["user:write"]);
    assert.deepEqual(suspend.parameters, [
      { name: "userKey", in: "path", required: true, schema: { type: "string" } },
    ]);
    assert.ok(document.paths[`${ADMIN_BASE_PATH}/overview`]?.get);
    assert.ok(
      document.tags.some((tag: { name: string }) => tag.name === "feature-flags"),
      "operations are grouped by the resource in the route name",
    );
  });

  it("declares a permission requirement for every route it serves", async () => {
    const { router } = await seededRouter();
    const document = (await callAdmin(router, "GET", "/openapi.json")).body;

    const missing: string[] = [];
    for (const [path, operations] of Object.entries<Record<string, { operationId: string }>>(document.paths)) {
      for (const operation of Object.values(operations)) {
        const name = Object.keys(ROUTE_PERMISSIONS).find(
          (candidate) => candidate.replace(/[^A-Za-z0-9]+/g, "_") === operation.operationId,
        );
        const isPublic = PUBLIC_ROUTES.some(
          (candidate) => candidate.replace(/[^A-Za-z0-9]+/g, "_") === operation.operationId,
        );
        if (!name && !isPublic) missing.push(`${operation.operationId} (${path})`);
      }
    }
    assert.deepEqual(missing, [], "an unguarded route must be listed in PUBLIC_ROUTES on purpose");
  });
});

describe("tenant header contract", () => {
  it("rejects a request with no tenant, no user or a malformed tenant", async () => {
    const { router } = await seededRouter();

    // A missing tenant is a malformed request (400); a tenant with no principal
    // is an unauthenticated one (401).
    const anonymous = await callAdmin(router, "GET", api("/overview"));
    assert.equal(anonymous.status, 400);
    assert.equal(anonymous.body.code, "TENANT_REQUIRED");

    const noUser = await callAdmin(router, "GET", api("/overview"), { tenant: SEED_TENANT_KEY });
    assert.equal(noUser.status, 401);
    assert.equal(noUser.body.code, "UNAUTHENTICATED");

    const malformed = await callAdmin(router, "GET", api("/overview"), {
      tenant: "../../etc/passwd",
      user: "ada@northwind.example",
    });
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.message, /malformed/);
  });

  it("returns 404 for an unknown path and 405 with an Allow header for a wrong method", async () => {
    const { router } = await seededRouter();

    const missing = await callAdmin(router, "GET", api("/nowhere"), admin);
    assert.equal(missing.status, 404);

    const wrongMethod = await callAdmin(router, "PUT", api("/users"), admin);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers["allow"], "GET, POST");
  });

  it("maps a malformed body to 400 rather than 500", async () => {
    const { router } = await seededRouter();
    const response = await callAdmin(router, "POST", api("/users"), { ...admin, body: { email: 42 } });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION");
  });
});

describe("authorization", () => {
  it("refuses a caller whose roles do not carry the permission", async () => {
    const { router } = await seededRouter();

    const readOnly = { tenant: SEED_TENANT_KEY, user: "mei@northwind.example", roles: ["auditor"] };
    const listed = await callAdmin(router, "GET", api("/users"), readOnly);
    assert.equal(listed.status, 200, "auditor may read");

    const denied = await callAdmin(router, "POST", api("/users"), {
      ...readOnly,
      body: { email: "new@northwind.example", displayName: "New", roles: ["tenant-operator"] },
    });
    assert.equal(denied.status, 403);
    assert.match(denied.body.message, /user:write/);
  });

  it("records a denial in the audit log", async () => {
    const { h, router } = await seededRouter();
    await callAdmin(router, "DELETE", api("/roles/integration-engineer"), {
      tenant: SEED_TENANT_KEY,
      user: "mei@northwind.example",
      roles: ["auditor"],
    });

    const denials = h.container.services.audit.query(h.tenantId, { outcome: "denied" });
    assert.equal(denials.total, 1);
    assert.equal(denials.items[0]?.action, "roles.delete");
    assert.equal(denials.items[0]?.actor, "mei@northwind.example");
  });

  it("resolves permissions through the tenant's own role graph, not the header string", async () => {
    const { router } = await seededRouter();

    // integration-engineer is a tenant-defined role that inherits tenant-operator.
    const engineer = { tenant: SEED_TENANT_KEY, user: "raj@northwind.example", roles: ["integration-engineer"] };
    const webhooks = await callAdmin(router, "GET", api("/webhooks"), engineer);
    assert.equal(webhooks.status, 200);

    const users = await callAdmin(router, "POST", api("/users"), {
      ...engineer,
      body: { email: "x@northwind.example", displayName: "X", roles: ["tenant-operator"] },
    });
    assert.equal(users.status, 403, "inheriting tenant-operator does not grant user:write");

    const invented = await callAdmin(router, "GET", api("/webhooks"), {
      ...engineer,
      roles: ["role-that-does-not-exist"],
    });
    assert.equal(invented.status, 403, "an unknown role code grants nothing");
  });

  it("shows a tenant administrator only their own tenant", async () => {
    const { h, router } = await seededRouter();
    await h.container.services.tenant.provision(
      { ...h.platform, tenantId: "southwind" as never },
      { key: "southwind", name: "Southwind Ltd" },
    );

    const scoped = await callAdmin(router, "GET", api("/tenants"), admin);
    assert.equal(scoped.body.total, 1);
    assert.equal(scoped.body.items[0].key, SEED_TENANT_KEY);

    const platform = await callAdmin(router, "GET", api("/tenants"), {
      tenant: SEED_TENANT_KEY,
      user: "ops@enterprise-suite.example",
      roles: ["platform-admin"],
    });
    assert.equal(platform.body.total, 2);
  });
});

describe("user lifecycle over HTTP", () => {
  it("invites, redeems, suspends and reinstates", async () => {
    const { router } = await seededRouter();

    const invited = await callAdmin(router, "POST", api("/users"), {
      ...admin,
      body: { email: "sam@northwind.example", displayName: "Sam Farr", roles: ["tenant-operator"] },
    });
    assert.equal(invited.status, 201);
    assert.equal(invited.body.user.status, "invited");
    const token = invited.body.inviteToken;
    assert.ok(token);

    const read = await callAdmin(router, "GET", api("/users/sam@northwind.example"), admin);
    assert.equal(read.body.inviteToken, undefined, "the token is never re-read");
    assert.equal(read.body.inviteTokenPresent, true);

    // Redeeming needs the token, not a permission: the invitee has no role yet.
    const wrongToken = await callAdmin(router, "POST", api("/users/sam@northwind.example/accept-invite"), {
      tenant: SEED_TENANT_KEY,
      user: "sam@northwind.example",
      roles: [],
      body: { token: "not-the-token" },
    });
    assert.equal(wrongToken.status, 422);

    const accepted = await callAdmin(router, "POST", api("/users/sam@northwind.example/accept-invite"), {
      tenant: SEED_TENANT_KEY,
      user: "sam@northwind.example",
      roles: [],
      body: { token },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.status, "active");

    const suspended = await callAdmin(router, "POST", api("/users/sam@northwind.example/suspend"), {
      ...admin,
      body: { reason: "left the project" },
    });
    assert.equal(suspended.body.status, "suspended");

    const reinstated = await callAdmin(router, "POST", api("/users/sam@northwind.example/reinstate"), {
      ...admin,
      body: {},
    });
    assert.equal(reinstated.body.status, "active");
  });

  it("refuses to strip the last administrator over HTTP too", async () => {
    const { router } = await seededRouter();
    const response = await callAdmin(router, "POST", api("/users/ada@northwind.example/roles"), {
      ...admin,
      body: { roles: ["auditor"] },
    });
    assert.equal(response.status, 422);
    assert.match(response.body.message, /last active administrator/i);
  });
});

describe("reference data over HTTP", () => {
  it("creates a draft, publishes it and serves labels", async () => {
    const { router } = await seededRouter();

    const created = await callAdmin(router, "POST", api("/reference-data"), {
      ...admin,
      body: {
        code: "ncr-disposition",
        name: "NCR dispositions",
        entries: [
          { code: "REWORK", label: "Rework", sortOrder: 10 },
          { code: "SCRAP", label: "Scrap", sortOrder: 20 },
        ],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "draft");

    const published = await callAdmin(router, "POST", api("/reference-data/ncr-disposition/publish"), {
      ...admin,
      body: {},
    });
    assert.equal(published.body.status, "published");

    const labels = await callAdmin(router, "GET", api("/reference-data/ncr-disposition/labels"), admin);
    assert.deepEqual(labels.body, { REWORK: "Rework", SCRAP: "Scrap" });

    const retired = await callAdmin(
      router,
      "DELETE",
      api("/reference-data/ncr-disposition/entries/SCRAP"),
      admin,
    );
    assert.equal(retired.status, 200);
    const after = await callAdmin(router, "GET", api("/reference-data/ncr-disposition/labels"), admin);
    assert.deepEqual(Object.keys(after.body), ["REWORK"]);
  });
});

describe("feature flags over HTTP", () => {
  it("toggles a flag and explains the decision for a subject", async () => {
    const { router } = await seededRouter();

    const off = await callAdmin(router, "PATCH", api("/feature-flags/new-order-workspace"), {
      ...admin,
      body: { enabled: false },
    });
    assert.equal(off.body.enabled, false);

    const explained = await callAdmin(router, "POST", api("/feature-flags/new-order-workspace/explain"), {
      ...admin,
      body: { subject: "ada@northwind.example", attributes: { site: "leeds" } },
    });
    assert.equal(explained.body.reason, "flag-disabled");

    await callAdmin(router, "PATCH", api("/feature-flags/new-order-workspace"), {
      ...admin,
      body: { enabled: true },
    });
    const onSite = await callAdmin(router, "POST", api("/feature-flags/new-order-workspace/explain"), {
      ...admin,
      body: { subject: "ada@northwind.example", attributes: { site: "leeds" } },
    });
    assert.equal(onSite.body.reason, "rule-match");
  });

  it("evaluates every flag for a subject in one call", async () => {
    const { router } = await seededRouter();
    const response = await callAdmin(router, "POST", api("/feature-flags/evaluate"), {
      ...admin,
      body: { subject: "raj@northwind.example", attributes: { site: "leeds", plan: "enterprise" } },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.flags["new-order-workspace"], true);
    assert.equal(response.body.flags["mrp-parallel-run"], false);
    assert.equal(response.body.flags["invoice-pdf-template"], "modern");
  });
});

describe("webhooks over HTTP", () => {
  it("registers, tests and drains, returning the secret exactly once", async () => {
    const { h, router } = await seededRouter();

    const created = await callAdmin(router, "POST", api("/webhooks"), {
      ...admin,
      body: {
        name: "Finance bridge",
        url: "https://hooks.northwind.example/finance",
        eventFilters: ["admin.tenant.plan-changed"],
      },
    });
    assert.equal(created.status, 201);
    const secret = created.body.secret;
    assert.ok(secret);

    const id = created.body.webhook.id;
    const read = await callAdmin(router, "GET", api(`/webhooks/${id}`), admin);
    assert.equal(read.body.secret, undefined);
    assert.ok(String(read.body.secretHint).includes("…"));

    const tested = await callAdmin(router, "POST", api(`/webhooks/${id}/test`), { ...admin, body: {} });
    assert.equal(tested.status, 200);
    assert.equal(h.sender.sent.at(-1)?.url, "https://hooks.northwind.example/finance");

    const drained = await callAdmin(router, "POST", api("/webhooks/drain"), { ...admin, body: {} });
    assert.equal(drained.status, 200);
    assert.equal(typeof drained.body.attempted, "number");
  });
});

describe("audit over HTTP", () => {
  it("filters, paginates and summarises", async () => {
    const { router } = await seededRouter();
    await callAdmin(router, "PATCH", api("/feature-flags/mrp-parallel-run"), {
      ...admin,
      body: { enabled: true },
    });

    const page = await callAdmin(router, "GET", api("/audit-log?pageSize=3"), admin);
    assert.equal(page.body.items.length, 3);
    assert.ok(page.body.total > 3);

    const filtered = await callAdmin(router, "GET", api("/audit-log?action=feature-flag.toggle"), admin);
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.items[0].actor, admin.user);

    const summary = await callAdmin(router, "GET", api("/audit-log/summary"), admin);
    assert.ok(summary.body.total > 0);
    assert.equal(summary.body.byOutcome.denied, 0);
    assert.ok(summary.body.topActors.length > 0);
  });
});
