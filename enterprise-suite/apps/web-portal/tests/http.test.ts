import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPortalServer } from "../src/http/server.js";
import { SESSION_COOKIE } from "../src/http/cookies.js";
import { createHarness, USERS, type TestHarness } from "./helpers.js";

let harness: TestHarness;
let server: Server;
let baseUrl: string;

interface CallResult {
  status: number;
  body: any;
  text: string;
  headers: Headers;
}

interface CallOptions {
  body?: unknown;
  form?: Record<string, string>;
  token?: string;
  headers?: Record<string, string>;
}

async function call(method: string, path: string, options: CallOptions = {}): Promise<CallResult> {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined;
  if (options.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.token) headers.cookie = `${SESSION_COOKIE}=${options.token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  const text = await response.text();
  let parsed: unknown = undefined;
  if (response.headers.get("content-type")?.includes("json") && text.length > 0) {
    parsed = JSON.parse(text);
  }
  return { status: response.status, body: parsed, text, headers: response.headers };
}

async function signIn(email: string, tenantId = "acme"): Promise<string> {
  const result = await call("POST", "/sign-in", { body: { email, tenantId } });
  assert.equal(result.status, 200, result.text);
  return result.body.token as string;
}

before(async () => {
  harness = createHarness();
  server = createPortalServer(harness.container);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

describe("public endpoints", () => {
  it("serves health and static assets without a session", async () => {
    const health = await call("GET", "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "web-portal");
    assert.equal(health.body.transport, "mock");

    const css = await call("GET", "/assets/portal.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.match(css.text, /\.rail__link/);
  });

  it("redirects anonymous page requests to sign-in, preserving the target", async () => {
    const page = await call("GET", "/m/finance/journals");
    assert.equal(page.status, 303);
    assert.equal(page.headers.get("location"), "/sign-in?next=%2Fm%2Ffinance%2Fjournals");
  });

  it("answers anonymous API requests with 401", async () => {
    const api = await call("GET", "/api/dashboard");
    assert.equal(api.status, 401);
    assert.equal(api.body.code, "UNAUTHENTICATED");
  });

  it("renders the mock sign-in screen", async () => {
    const page = await call("GET", "/sign-in");
    assert.equal(page.status, 200);
    assert.match(page.text, /Mock identity provider/);
    assert.match(page.text, /avery\.chen@acme\.test/);
  });
});

describe("sign-in and session", () => {
  it("sets an HttpOnly cookie and reports the session", async () => {
    const result = await call("POST", "/sign-in", {
      body: { email: USERS.salesManager, tenantId: "acme" },
    });
    const cookie = result.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const session = await call("GET", "/api/session", { token: result.body.token });
    assert.equal(session.body.tenant.tenantId, "acme");
    assert.deepEqual(session.body.roles, ["sales-manager", "channel-manager"]);
    assert.ok(session.body.permissions.includes("sales:approve"));
  });

  it("re-renders the sign-in form on a bad credential instead of a stack trace", async () => {
    const result = await call("POST", "/sign-in", { form: { email: "ghost@acme.test" } });
    assert.equal(result.status, 401);
    assert.match(result.text, /Unknown user/);
  });

  it("switches tenants and re-issues the cookie", async () => {
    const token = await signIn(USERS.admin, "acme");
    const switched = await call("POST", "/switch-tenant", {
      token,
      body: { tenantId: "globex" },
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.tenantId, "globex");
    assert.match(switched.headers.get("set-cookie") ?? "", new RegExp(SESSION_COOKIE));
  });

  it("clears the cookie on sign-out", async () => {
    const token = await signIn(USERS.buyer);
    const out = await call("POST", "/sign-out", { token, body: {} });
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });

  it("accepts a gateway-injected principal without a cookie", async () => {
    const session = await call("GET", "/api/session", {
      headers: { "x-tenant-id": "acme", "x-user-id": "u-jordan", "x-roles": "viewer" },
    });
    assert.equal(session.status, 200);
    assert.deepEqual(session.body.roles, ["viewer"]);
  });

  it("ignores a forged cookie rather than trusting it", async () => {
    const forged = await call("GET", "/api/session", { token: "not.a.token" });
    assert.equal(forged.status, 401);
  });
});

describe("shell pages", () => {
  it("renders the dashboard with a tile per entitled module", async () => {
    const token = await signIn(USERS.admin, "acme");
    const page = await call("GET", "/", { token });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    for (const label of ["Sales", "Marketing", "Inventory", "SRM", "PRM", "Finance"]) {
      assert.match(page.text, new RegExp(`>${label}</a>`));
    }
    assert.match(page.text, /\$45,460\.00/);
  });

  it("omits an unentitled module everywhere in the chrome", async () => {
    const token = await signIn(USERS.admin, "globex");
    const page = await call("GET", "/", { token });
    assert.ok(!page.text.includes("/m/prm/"), "PRM must not appear for globex");
    const denied = await call("GET", "/m/prm/partners", { token });
    assert.equal(denied.status, 404);
  });

  it("redirects a module root to its first view", async () => {
    const token = await signIn(USERS.salesManager);
    const page = await call("GET", "/m/sales", { token });
    assert.equal(page.status, 303);
    assert.equal(page.headers.get("location"), "/m/sales/quotes");
  });

  it("renders a module list with filters applied", async () => {
    const token = await signIn(USERS.salesManager);
    const page = await call("GET", "/m/sales/quotes?q=initech", { token });
    assert.equal(page.status, 200);
    assert.match(page.text, /Initech Systems/);
    assert.ok(!page.text.includes("Northwind Traders"));
    assert.match(page.text, /1–1 of 1/);
  });

  it("renders a domain error inside the shell", async () => {
    const token = await signIn(USERS.buyer);
    const page = await call("GET", "/m/sales/approvals", { token });
    assert.equal(page.status, 403);
    assert.match(page.text, /FORBIDDEN/);
    assert.match(page.text, /rail__link/, "the chrome still renders");
  });

  it("runs a module action and returns to the module", async () => {
    const token = await signIn(USERS.salesManager);
    const posted = await call("POST", "/m/sales/actions/sales.quote.approve", {
      token,
      form: { approvedPct: "0.15" },
    });
    assert.equal(posted.status, 303);
    assert.equal(posted.headers.get("location"), "/m/sales/quotes?submitted=1");
  });

  it("serves the search page and the profile page", async () => {
    const token = await signIn(USERS.admin);
    const search = await call("GET", "/search?q=kraftwerk", { token });
    assert.match(search.text, /Kraftwerk Components/);
    const profile = await call("GET", "/profile", { token });
    assert.match(profile.text, /Dana Reyes/);
    assert.match(profile.text, /Entitlements/);
  });
});

describe("preferences round trip", () => {
  it("pins a module from the form and reorders the rail", async () => {
    const token = await signIn(USERS.admin);
    const pinned = await call("POST", "/preferences/pins/finance", { token, form: {} });
    assert.equal(pinned.status, 303);

    const page = await call("GET", "/preferences", { token });
    assert.match(page.text, /Unpin/);

    const dashboard = await call("GET", "/", { token });
    const financeAt = dashboard.text.indexOf("Finance");
    const salesAt = dashboard.text.indexOf("Sales");
    assert.ok(financeAt < salesAt, "pinned module leads the rail");
  });

  it("validates patches over the BFF", async () => {
    const token = await signIn(USERS.controller);
    const bad = await call("PATCH", "/api/preferences", { token, body: { density: "cosy" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "VALIDATION");

    const good = await call("PATCH", "/api/preferences", {
      token,
      body: { density: "compact", landingModule: "finance" },
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.density, "compact");

    const page = await call("GET", "/", { token });
    assert.match(page.text, /class="density-compact/);
  });

  it("saves and deletes views", async () => {
    const token = await signIn(USERS.controller);
    const created = await call("POST", "/api/preferences/views", {
      token,
      body: { module: "finance", resource: "receivables", name: "Overdue", query: { q: "90+" } },
    });
    assert.equal(created.status, 201);
    const viewId = created.body.savedViews.at(-1).id as string;

    const dashboard = await call("GET", "/", { token });
    assert.match(dashboard.text, /Overdue/);

    const deleted = await call("DELETE", `/api/preferences/views/${viewId}`, { token });
    assert.equal(deleted.status, 200);
    assert.ok(!deleted.body.savedViews.some((v: { id: string }) => v.id === viewId));
  });
});

describe("BFF", () => {
  it("returns nav filtered by entitlement and permission", async () => {
    const token = await signIn(USERS.buyer);
    const nav = await call("GET", "/api/nav?path=/m/srm/requisitions", { token });
    assert.equal(nav.status, 200);
    const srm = nav.body.modules.find((m: { key: string }) => m.key === "srm");
    assert.ok(srm.items.some((i: { active: boolean }) => i.active));
    const sales = nav.body.modules.find((m: { key: string }) => m.key === "sales");
    assert.ok(!sales.items.some((i: { key: string }) => i.key === "sales.approvals"));
  });

  it("returns list view models with typed columns", async () => {
    const token = await signIn(USERS.buyer);
    const view = await call("GET", "/api/modules/srm/suppliers?pageSize=2", { token });
    assert.equal(view.status, 200);
    assert.equal(view.body.rows.length, 2);
    assert.equal(view.body.total, 4);
    assert.ok(view.body.columns.some((c: { kind: string }) => c.kind === "percent"));
  });

  it("reports a degraded module in the dashboard payload", async () => {
    const token = await signIn(USERS.admin);
    harness.transport.failModule("marketing", { status: 500, code: "BOOM", message: "down" });
    try {
      const dashboard = await call("GET", "/api/dashboard", { token });
      assert.deepEqual(dashboard.body.degradedModules, ["marketing"]);
    } finally {
      harness.transport.clearFailures();
    }
  });

  it("guards diagnostics behind tenant-admin", async () => {
    const buyerToken = await signIn(USERS.buyer);
    assert.equal((await call("GET", "/api/diagnostics", { token: buyerToken })).status, 403);

    const adminToken = await signIn(USERS.admin);
    const diagnostics = await call("GET", "/api/diagnostics", { token: adminToken });
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.transport, "mock");
    assert.ok(diagnostics.body.services.length > 0);
  });

  it("maps unknown routes and bad JSON to error envelopes", async () => {
    const token = await signIn(USERS.admin);
    const missing = await call("GET", "/api/nope", { token });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "ROUTE_NOT_FOUND");

    const badJson = await fetch(`${baseUrl}/api/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: "{oops",
    });
    assert.equal(badJson.status, 400);
    const envelope = (await badJson.json()) as { code: string };
    assert.equal(envelope.code, "BAD_JSON");
  });
});
