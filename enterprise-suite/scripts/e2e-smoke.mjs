#!/usr/bin/env node
/**
 * End-to-end smoke test for a running Enterprise Suite (`npm run suite:start`).
 *
 * Checks, in order:
 *   1. suite shell   GET :4000/api/status          -> 200
 *   2. gateway       GET :4100/health              -> 200
 *   3. gateway       GET :4100/health/ready        -> 200
 *   4. web portal    GET :4300/                    -> 200
 *   5. admin console GET :4119/                    -> 200
 *   6. gateway       GET :4100/api/srm/suppliers   -> 200 with demo-tenant
 *      headers (x-tenant-id / x-user-id / x-roles) and, when SMOKE_TOKEN is
 *      set, an Authorization: Bearer token.
 *
 * Exits 0 only when every check passes; exits 1 otherwise. Each check retries
 * until SMOKE_TIMEOUT_MS (default 90s) so it can be run right after
 * suite:start without an external wait loop.
 *
 * Environment overrides:
 *   SMOKE_HOST        default 127.0.0.1
 *   SMOKE_SHELL_PORT  default 4000     SMOKE_GATEWAY_PORT default 4100
 *   SMOKE_ADMIN_PORT  default 4119     SMOKE_PORTAL_PORT  default 4300
 *   SMOKE_TENANT      default demo     SMOKE_USER         default smoke-bot
 *   SMOKE_ROLES       default viewer   SMOKE_TOKEN        optional bearer token
 *   SMOKE_TIMEOUT_MS  default 90000
 */

const HOST = process.env.SMOKE_HOST ?? "127.0.0.1";
const SHELL_PORT = Number(process.env.SMOKE_SHELL_PORT ?? 4000);
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? 4100);
const ADMIN_PORT = Number(process.env.SMOKE_ADMIN_PORT ?? 4119);
const PORTAL_PORT = Number(process.env.SMOKE_PORTAL_PORT ?? 4300);
const TENANT = process.env.SMOKE_TENANT ?? "demo";
const USER = process.env.SMOKE_USER ?? "smoke-bot";
const ROLES = process.env.SMOKE_ROLES ?? "viewer";
const TOKEN = process.env.SMOKE_TOKEN;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000);
const RETRY_DELAY_MS = 2_000;

const tenantHeaders = {
  "x-tenant-id": TENANT,
  "x-user-id": USER,
  "x-roles": ROLES,
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

const checks = [
  {
    name: "shell status",
    url: `http://${HOST}:${SHELL_PORT}/api/status`,
    validate: async (res) => {
      if (res.status !== 200) return `expected 200, got ${res.status}`;
      const body = await res.json();
      if (!Array.isArray(body.processes) || body.processes.length === 0) {
        return "status payload has no processes";
      }
      return null;
    },
  },
  {
    name: "gateway /health",
    url: `http://${HOST}:${GATEWAY_PORT}/health`,
    validate: (res) => (res.status === 200 ? null : `expected 200, got ${res.status}`),
  },
  {
    name: "gateway /health/ready",
    url: `http://${HOST}:${GATEWAY_PORT}/health/ready`,
    validate: async (res) => {
      if (res.status !== 200) {
        const detail = await res.text().catch(() => "");
        return `expected 200, got ${res.status}${detail ? ` — ${truncate(detail)}` : ""}`;
      }
      return null;
    },
  },
  {
    name: "web portal /",
    url: `http://${HOST}:${PORTAL_PORT}/`,
    validate: (res) => (res.status === 200 ? null : `expected 200, got ${res.status}`),
  },
  {
    name: "admin console /",
    url: `http://${HOST}:${ADMIN_PORT}/`,
    validate: (res) => (res.status === 200 ? null : `expected 200, got ${res.status}`),
  },
  {
    name: `gateway /api/srm/suppliers (tenant=${TENANT})`,
    url: `http://${HOST}:${GATEWAY_PORT}/api/srm/suppliers`,
    headers: tenantHeaders,
    validate: async (res) => {
      if (res.status !== 200) {
        const detail = await res.text().catch(() => "");
        return `expected 200, got ${res.status}${detail ? ` — ${truncate(detail)}` : ""}`;
      }
      const body = await res.json().catch(() => null);
      if (body === null) return "response was not JSON";
      const items = Array.isArray(body) ? body : body.items ?? body.data ?? body.suppliers;
      if (!Array.isArray(items)) return `no supplier list in response (keys: ${Object.keys(body).join(", ")})`;
      if (items.length === 0) return "supplier list is empty — was the demo tenant seeded? (SEED=1)";
      return null;
    },
  },
];

function truncate(s, max = 200) {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function fetchOnce(check) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(check.url, { headers: check.headers, signal: ctrl.signal, redirect: "follow" });
    return { res };
  } catch (err) {
    return { err: err?.cause?.code ?? err?.name ?? String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function runCheck(check, deadline) {
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    const { res, err } = await fetchOnce(check);
    if (res) {
      const failure = await check.validate(res);
      if (failure === null) return { ok: true };
      lastError = failure;
      // 4xx will not fix itself by waiting; bail immediately.
      if (res.status >= 400 && res.status < 500) return { ok: false, error: failure };
    } else {
      lastError = `request failed (${err})`;
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  return { ok: false, error: `${lastError} (after retrying until timeout)` };
}

const deadline = Date.now() + TIMEOUT_MS;
let failures = 0;

console.log(`[smoke] target host=${HOST} tenant=${TENANT} token=${TOKEN ? "yes" : "no"} timeout=${TIMEOUT_MS}ms`);
for (const check of checks) {
  const started = Date.now();
  const result = await runCheck(check, deadline);
  const elapsed = Date.now() - started;
  if (result.ok) {
    console.log(`[smoke] PASS ${check.name} (${elapsed}ms)`);
  } else {
    failures += 1;
    console.error(`[smoke] FAIL ${check.name}: ${result.error}`);
  }
}

if (failures > 0) {
  console.error(`[smoke] ${failures}/${checks.length} checks FAILED`);
  process.exit(1);
}
console.log(`[smoke] all ${checks.length} checks passed`);
