import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { createIdentityRouter } from "../src/http/server.js";
import type { RouteResponse } from "../src/http/router.js";
import { SEED_PASSWORD, seeded } from "./helpers.js";

interface CallOptions {
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly token?: string;
  readonly as?: { tenantId: string; userId: string };
}

/**
 * Builds just enough of an `IncomingMessage` for the router: a readable body plus the
 * url/method/headers it inspects. Going through `dispatch` keeps these tests fast while
 * still exercising routing, authentication and the declarative permission checks.
 */
function request(method: string, url: string, options: CallOptions = {}): IncomingMessage {
  const payload = options.body === undefined ? "" : JSON.stringify(options.body);
  const stream = Readable.from(payload === "" ? [] : [Buffer.from(payload)]) as IncomingMessage;
  stream.method = method;
  stream.url = url;
  stream.headers = {
    "content-type": "application/json",
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    ...(options.as ? { "x-tenant-id": options.as.tenantId, "x-user-id": options.as.userId } : {}),
    ...options.headers,
  };
  Object.defineProperty(stream, "socket", { value: { remoteAddress: "203.0.113.5" } });
  return stream;
}

function makeApi() {
  const context = seeded();
  const router = createIdentityRouter(context.module);
  const call = (method: string, url: string, options?: CallOptions): Promise<RouteResponse> =>
    router.dispatch(request(method, url, options));
  const asOwner = { tenantId: context.tenantId, userId: context.refs.users.owner };
  const asContractor = { tenantId: context.tenantId, userId: context.refs.users.contractor };
  return { ...context, router, call, asOwner, asContractor };
}

async function expectError(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const typed = error as { status?: number; code?: string };
    return { status: typed.status ?? 500, code: typed.code ?? "UNKNOWN" };
  }
  throw new Error("expected the request to fail");
}

describe("public endpoints", () => {
  it("serves health without credentials", async () => {
    const { call } = makeApi();
    const response = await call("GET", "/health");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok", service: "identity-access" });
  });

  it("lists the route table with the permission each route requires", async () => {
    const { call } = makeApi();
    const routes = (await call("GET", "/identity/routes")).body as {
      method: string;
      pattern: string;
      permission?: string;
    }[];
    const roleCreate = routes.find(
      (route) => route.method === "POST" && route.pattern === "/identity/roles",
    );
    assert.equal(roleCreate?.permission, "identity.role:create");
  });

  it("rejects an unauthenticated call to a protected route", async () => {
    const { call } = makeApi();
    const error = await expectError(call("GET", "/identity/users"));
    assert.equal(error.status, 401);
  });
});

describe("authentication over HTTP", () => {
  it("logs in and uses the returned bearer token", async () => {
    const { call, tenantId } = makeApi();
    const login = await call("POST", "/identity/auth/login", {
      body: { tenantId, email: "ada.owner@northwind.example", password: SEED_PASSWORD },
    });
    assert.equal(login.status, 201);
    const token = (login.body as { token: string }).token;

    const me = await call("GET", "/identity/me", { token });
    assert.equal(me.status, 200);
    const body = me.body as { principal: { displayName: string }; permissions: string[] };
    assert.equal(body.principal.displayName, "Ada Owner");
    assert.ok(body.permissions.includes("identity.tenant:suspend"));
  });

  it("returns 401 for bad credentials", async () => {
    const { call, tenantId } = makeApi();
    const error = await expectError(
      call("POST", "/identity/auth/login", {
        body: { tenantId, email: "ada.owner@northwind.example", password: "nope" },
      }),
    );
    assert.equal(error.status, 401);
    assert.equal(error.code, "INVALID_CREDENTIALS");
  });

  it("refreshes and then logs out", async () => {
    const { call, tenantId, clock } = makeApi();
    const login = (await call("POST", "/identity/auth/login", {
      body: { tenantId, email: "ada.owner@northwind.example", password: SEED_PASSWORD },
    })).body as { token: string; refreshToken: string };

    clock.advanceMinutes(5);
    const refreshed = (await call("POST", "/identity/auth/refresh", {
      body: { refreshToken: login.refreshToken },
    })).body as { token: string };
    assert.notEqual(refreshed.token, login.token);

    assert.equal((await call("POST", "/identity/auth/logout", { body: { token: refreshed.token } })).status, 204);
    assert.equal((await expectError(call("GET", "/identity/me", { token: refreshed.token }))).status, 401);
  });

  it("accepts an API key as a bearer credential", async () => {
    const { call, refs } = makeApi();
    const response = await call("GET", "/identity/me", { token: refs.apiKey.token });
    const body = response.body as { principal: { subject: { type: string } } };
    assert.equal(body.principal.subject.type, "api_key");
  });
});

describe("permission enforcement on routes", () => {
  it("allows an authorized caller through", async () => {
    const { call, asOwner } = makeApi();
    const response = await call("GET", "/identity/users", { as: asOwner });
    assert.equal(response.status, 200);
    assert.equal((response.body as { total: number }).total, 6);
  });

  it("blocks an unauthorized caller with 403 before the handler runs", async () => {
    const { call, asContractor } = makeApi();
    const error = await expectError(call("GET", "/identity/users", { as: asContractor }));
    assert.equal(error.status, 403);
    assert.equal(error.code, "AUTHORIZATION_DENIED");
  });

  it("reads the scope from the query string for scoped checks", async () => {
    const { call, module, refs } = makeApi();
    // The EMEA manager may invite users through the EMEA Sales group binding, which is
    // scoped to that business unit and nowhere else.
    const asManager = { tenantId: refs.tenantId, userId: refs.users.emeaManager };
    const allowed = await call(
      "POST",
      `/identity/users?scope=${encodeURIComponent(refs.scopes.emea)}`,
      { as: asManager, body: { email: "emea.hire@northwind.example", displayName: "EMEA Hire" } },
    );
    assert.equal(allowed.status, 201);

    const error = await expectError(
      call("POST", `/identity/users?scope=${encodeURIComponent(refs.scopes.amer)}`, {
        as: asManager,
        body: { email: "amer.hire@northwind.example", displayName: "AMER Hire" },
      }),
    );
    assert.equal(error.status, 403);
    assert.ok(module.audit.count(refs.tenantId, { category: "authz", outcome: "deny" }) > 0);
  });

  it("returns 404 for an unknown route", async () => {
    const { call } = makeApi();
    assert.equal((await expectError(call("GET", "/identity/nope"))).status, 404);
  });
});

describe("administration over HTTP", () => {
  it("invites, activates and lists a user", async () => {
    const { call, asOwner, tenantId } = makeApi();
    const invited = await call("POST", "/identity/users", {
      as: asOwner,
      body: { email: "newbie@northwind.example", displayName: "New Bie" },
    });
    assert.equal(invited.status, 201);
    const userId = (invited.body as { id: string }).id;

    const activated = await call(`POST`, `/identity/users/${userId}/activate`, {
      as: asOwner,
      body: { password: "Another!Str0ngPass" },
    });
    assert.equal((activated.body as { status: string }).status, "active");

    const login = await call("POST", "/identity/auth/login", {
      body: { tenantId, email: "newbie@northwind.example", password: "Another!Str0ngPass" },
    });
    assert.equal(login.status, 201);
  });

  it("surfaces validation failures as 422 with the failing rules", async () => {
    const { call, asOwner } = makeApi();
    const invited = await call("POST", "/identity/users", {
      as: asOwner,
      body: { email: "weak@northwind.example", displayName: "Weak Person" },
    });
    const userId = (invited.body as { id: string }).id;
    const error = await expectError(
      call(`POST`, `/identity/users/${userId}/activate`, { as: asOwner, body: { password: "abc" } }),
    );
    assert.equal(error.status, 422);
    assert.equal(error.code, "WEAK_PASSWORD");
  });

  it("requires the fields a route declares", async () => {
    const { call, asOwner } = makeApi();
    const error = await expectError(
      call("POST", "/identity/users", { as: asOwner, body: { email: "x@northwind.example" } }),
    );
    assert.equal(error.status, 422);
  });

  it("creates a role, grants it and sees the effect immediately", async () => {
    const { call, asOwner, refs } = makeApi();
    await call("POST", "/identity/roles", {
      as: asOwner,
      body: {
        code: "report_reader",
        name: "Report Reader",
        grants: [{ permission: "platform.report:read" }],
      },
    });
    const binding = await call("POST", "/identity/role-bindings", {
      as: asOwner,
      body: {
        subjectType: "user",
        subjectId: refs.users.contractor,
        roleCode: "report_reader",
      },
    });
    assert.equal(binding.status, 201);

    const check = await call("POST", "/identity/authz/check", {
      as: { tenantId: refs.tenantId, userId: refs.users.contractor },
      body: { permission: "platform.report:read" },
    });
    assert.equal((check.body as { allowed: boolean }).allowed, true);
  });

  it("returns the flattened view of a role", async () => {
    const { call, asOwner } = makeApi();
    const response = await call("GET", "/identity/roles/tenant_admin/effective", { as: asOwner });
    const body = response.body as { grants: { permission: string }[]; ancestry: string[] };
    assert.ok(body.ancestry.includes("base_reader"));
    assert.ok(body.grants.some((grant) => grant.permission === "identity.**:*"));
  });

  it("refuses to edit a system role", async () => {
    const { call, asOwner } = makeApi();
    const error = await expectError(
      call("POST", "/identity/roles/tenant_admin/grants", {
        as: asOwner,
        body: { permission: "identity.tenant:suspend" },
      }),
    );
    assert.equal(error.status, 409);
    assert.equal(error.code, "SYSTEM_ROLE_IMMUTABLE");
  });

  it("issues an API key and returns the token exactly once", async () => {
    const { call, asOwner } = makeApi();
    const issued = await call("POST", "/identity/api-keys", {
      as: asOwner,
      body: { name: "ci-pipeline", roleCodes: ["integration_client"], expiresInDays: 30 },
    });
    assert.equal(issued.status, 201);
    const body = issued.body as { token: string; apiKey: { id: string } };
    assert.ok(body.token.startsWith("esk_"));

    const fetched = await call(`GET`, `/identity/api-keys/${body.apiKey.id}`, { as: asOwner });
    assert.ok(!JSON.stringify(fetched.body).includes(body.token.split("_")[2]));
  });

  it("explains a denial for support staff", async () => {
    const { call, asOwner, refs } = makeApi();
    const response = await call("POST", "/identity/authz/explain", {
      as: asOwner,
      body: {
        subjectType: "user",
        subjectId: refs.users.contractor,
        permission: "identity.role:delete",
      },
    });
    const body = response.body as { allowed: boolean; trace: string[] };
    assert.equal(body.allowed, false);
    assert.ok(body.trace.length > 0);
  });

  it("checks a batch of permissions in one call", async () => {
    const { call, asOwner } = makeApi();
    const response = await call("POST", "/identity/authz/check-batch", {
      as: asOwner,
      body: { permissions: ["identity.user:read", "identity.role:delete"] },
    });
    const decisions = (response.body as { decisions: { allowed: boolean }[] }).decisions;
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every((decision) => decision.allowed));
  });

  it("serves the permission catalog with categories", async () => {
    const { call, asOwner } = makeApi();
    const response = await call("GET", "/identity/permissions?category=Identity%20%26%20Access", {
      as: asOwner,
    });
    const body = response.body as { categories: string[]; permissions: { key: string }[] };
    assert.ok(body.categories.includes("Identity & Access"));
    assert.ok(body.permissions.every((permission) => permission.key.startsWith("identity.")));
  });

  it("pages the audit log", async () => {
    const { call, asOwner } = makeApi();
    const response = await call("GET", "/identity/audit?pageSize=5", { as: asOwner });
    const body = response.body as { items: unknown[]; pageSize: number };
    assert.equal(body.pageSize, 5);
    assert.ok(body.items.length <= 5);
  });
});
