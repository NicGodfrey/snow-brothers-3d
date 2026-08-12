#!/usr/bin/env node
/**
 * Boots the whole Enterprise Suite as one system:
 *   - 18 domain services on ports 4101–4118
 *   - api-gateway on 4100 (ASSUME_DEPLOYED)
 *   - admin-console on 4119
 *   - web-portal on 4300
 *   - suite shell landing page on 4000
 *
 * Readiness contract: a process counts as "up" only when /health (or
 * /health/live) answers HTTP 200 exactly. The suite declares READY only when
 * 100% of critical processes are up (every manifest entry is critical unless
 * it sets `"critical": false`). If the shell port is already taken
 * (EADDRINUSE) the launcher tears every child down and exits non-zero instead
 * of orphaning them.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "scripts/suite-manifest.json"), "utf8"));
const LOG_DIR = join(ROOT, ".suite-logs");
const READY_TIMEOUT_MS = Number(process.env.SUITE_READY_TIMEOUT_MS ?? 120_000);
const SHUTDOWN_GRACE_MS = 3_000;
const children = [];
const status = new Map();
const readiness = { ready: false, checkedAt: null, failing: [] };
let shuttingDown = false;
// Known development key for the one-command local demo only. Deployments must
// provide a strong SUITE_AUTH_SECRET instead of copying this value.
const LOCAL_DEMO_SUITE_AUTH_SECRET = "local-demo-only-suite-auth-secret";

mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const line = `[suite] ${new Date().toISOString()} ${msg}`;
  console.log(line);
}

function isCritical(proc) {
  return proc.critical !== false;
}

function startProcess(proc) {
  const cwd = join(ROOT, proc.cwd);
  const entry = join(cwd, proc.entry);
  if (!existsSync(entry)) {
    status.set(proc.id, { state: "missing", port: proc.port, error: `entry not found: ${proc.entry}` });
    log(`SKIP ${proc.id} — missing ${proc.entry}`);
    return null;
  }

  const env = {
    ...process.env,
    PORT: String(proc.port),
    SEED: process.env.SEED ?? "1",
    ASSUME_DEPLOYED: "true",
    SUITE_AUTH_SECRET: process.env.SUITE_AUTH_SECRET ?? LOCAL_DEMO_SUITE_AUTH_SECRET,
    // Temporary backwards compatibility for local services that still call
    // each other with tenant headers. Tokens remain authoritative when sent.
    SUITE_TRUST_HEADERS: process.env.SUITE_TRUST_HEADERS ?? "true",
    ...(proc.env ?? {}),
  };

  const isPlainJs = entry.endsWith(".mjs") || entry.endsWith(".cjs") || entry.endsWith(".js");
  const args = isPlainJs ? [entry] : ["--import", "tsx", entry];
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const logPath = join(LOG_DIR, `${proc.id}.log`);
  const stream = { write(chunk) { writeFileSync(logPath, chunk, { flag: "a" }); } };
  child.stdout.on("data", (buf) => stream.write(buf));
  child.stderr.on("data", (buf) => stream.write(buf));

  status.set(proc.id, { state: "starting", port: proc.port, pid: child.pid, log: logPath });
  child.on("error", (err) => {
    status.set(proc.id, { state: "crashed", port: proc.port, error: String(err), log: logPath });
    log(`${proc.id} spawn error: ${err}`);
  });
  child.on("exit", (code, signal) => {
    status.set(proc.id, {
      state: code === 0 ? "exited" : "crashed",
      port: proc.port,
      pid: child.pid,
      code,
      signal,
      log: logPath,
    });
    if (!shuttingDown) log(`${proc.id} exited code=${code} signal=${signal ?? "-"}`);
  });

  children.push(child);
  log(`START ${proc.id} :${proc.port} pid=${child.pid}`);
  return child;
}

/** Strict probe: only an exact HTTP 200 counts as healthy. */
async function probe(port, path = "/health") {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1_500);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ctrl.signal });
    clearTimeout(t);
    return { ok: res.status === 200, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Probes /health, then /health/live; both must answer HTTP 200 to pass. */
async function probeProcess(port) {
  const health = await probe(port, "/health");
  if (health.ok) return { up: true, status: health.status, path: "/health" };
  const live = await probe(port, "/health/live");
  if (live.ok) return { up: true, status: live.status, path: "/health/live" };
  return { up: false, status: health.status || live.status, path: "/health" };
}

async function checkAll(procs) {
  const results = await Promise.all(
    procs.map(async (p) => {
      const cur = status.get(p.id);
      if (cur?.state === "missing") return { proc: p, up: false, reason: "missing entrypoint" };
      if (cur?.state === "crashed" || cur?.state === "exited") {
        return { proc: p, up: false, reason: `process ${cur.state} (code=${cur.code ?? "?"}) — see ${cur.log}` };
      }
      // Workers without an HTTP port (e.g. outbox-relay) are up once spawned.
      if (!p.port) {
        status.set(p.id, { ...cur, state: "up", http: 0 });
        return { proc: p, up: true };
      }
      const hit = await probeProcess(p.port);
      if (hit.up) {
        status.set(p.id, { ...cur, state: "up", http: hit.status });
        return { proc: p, up: true };
      }
      return { proc: p, up: false, reason: `no HTTP 200 on ${hit.path} (last status ${hit.status || "no response"})` };
    }),
  );
  return results;
}

/**
 * Blocks until every critical process answers HTTP 200, or the timeout
 * elapses. Returns true only when 100% of critical processes are up.
 */
async function waitReady(procs) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const critical = procs.filter(isCritical);
  let lastFailing = [];

  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    const results = await checkAll(procs);
    const failing = results.filter((r) => isCritical(r.proc) && !r.up);
    const upCount = critical.length - failing.length;
    lastFailing = failing;

    if (failing.length === 0) {
      readiness.ready = true;
      readiness.checkedAt = new Date().toISOString();
      readiness.failing = [];
      log(`READY — ${upCount}/${critical.length} critical processes returned HTTP 200 on /health`);
      return true;
    }
    log(`waiting — ${upCount}/${critical.length} critical up; pending: ${failing.map((f) => f.proc.id).join(", ")}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }

  readiness.ready = false;
  readiness.checkedAt = new Date().toISOString();
  readiness.failing = lastFailing.map((f) => ({ id: f.proc.id, port: f.proc.port, reason: f.reason }));
  log(`NOT READY after ${READY_TIMEOUT_MS}ms — failing critical processes:`);
  for (const f of lastFailing) log(`  - ${f.proc.id} :${f.proc.port} — ${f.reason}`);
  log("shell stays up for diagnosis; fix the processes above or check .suite-logs/");
  return false;
}

function shellHtml(payload) {
  const rows = payload.processes
    .map(
      (p) => `<tr>
      <td>${p.id}</td>
      <td><span class="st ${p.state}">${p.state}</span></td>
      <td><a href="http://127.0.0.1:${p.port}/" target="_blank">:${p.port}</a></td>
    </tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Enterprise Suite</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Syne:wght@800&display=swap" rel="stylesheet"/>
<style>
:root{--ink:#0e1a17;--muted:#5c6f68;--ok:#1f8a5b;--bad:#b42318;--run:#0b6e99}
*{box-sizing:border-box}body{margin:0;font-family:DM Sans,sans-serif;color:var(--ink);
background:radial-gradient(900px 420px at 0% 0%,rgba(20,143,91,.16),transparent 55%),
radial-gradient(800px 400px at 100% 0%,rgba(11,110,153,.14),transparent 50%),#f3f6f2}
.wrap{width:min(1080px,calc(100% - 2rem));margin:0 auto;padding:2rem 0 3rem}
h1{font-family:Syne,sans-serif;font-size:clamp(2.2rem,5vw,3.6rem);letter-spacing:-.04em;margin:0}
.lede{color:var(--muted);max-width:40rem;line-height:1.5}
.links{display:flex;flex-wrap:wrap;gap:.6rem;margin:1.25rem 0 1.75rem}
.links a{text-decoration:none;color:var(--ink);background:#fff;border:1px solid rgba(14,26,23,.12);
padding:.55rem .9rem;border-radius:999px;font-weight:600}
.links a.primary{background:var(--ink);color:#f3f6f2}
.panel{background:rgba(255,255,255,.8);border:1px solid rgba(14,26,23,.1);border-radius:16px;padding:1rem 1.1rem;box-shadow:0 14px 40px rgba(14,26,23,.06)}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:.45rem .3rem;border-bottom:1px solid rgba(14,26,23,.08)}
.st{font-family:ui-monospace,monospace;font-size:.75rem;padding:.15rem .4rem;border-radius:6px}
.st.up{color:var(--ok);background:rgba(31,138,91,.1)}.st.starting{color:var(--run);background:rgba(11,110,153,.1)}
.st.crashed,.st.missing,.st.degraded{color:var(--bad);background:rgba(180,35,24,.08)}
.ready{font-weight:700;color:var(--ok)}.notready{font-weight:700;color:var(--bad)}
.meta{color:var(--muted);font-size:.85rem;margin-top:1rem}
</style></head><body><div class="wrap">
<h1>Enterprise Suite</h1>
<p class="lede">ERP · SRM · PRM 一体运行时。网关统一入口，门户与管理台已接入，领域服务按目录端口拉起。</p>
<div class="links">
  <a class="primary" href="http://127.0.0.1:${payload.portalPort}/" target="_blank">Web Portal</a>
  <a href="http://127.0.0.1:${payload.adminPort}/" target="_blank">Admin Console</a>
  <a href="http://127.0.0.1:${payload.gatewayPort}/health" target="_blank">API Gateway</a>
  <a href="http://127.0.0.1:${payload.gatewayPort}/openapi.json" target="_blank">OpenAPI</a>
  <a href="http://127.0.0.1:${payload.gatewayPort}/__gateway/services" target="_blank">Service Catalog</a>
  <a href="http://127.0.0.1:8765/progress.html" target="_blank">Build Progress</a>
</div>
<div class="panel">
  <table>
    <thead><tr><th>Process</th><th>State</th><th>Port</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<p class="meta">
  <span class="${payload.ready ? "ready" : "notready"}">${payload.ready ? "READY" : "NOT READY"}</span>
  · updated ${payload.generatedAt} · up ${payload.upCount}/${payload.processes.length} · logs in .suite-logs/
</p>
<script>setTimeout(()=>location.reload(),8000)</script>
</div></body></html>`;
}

async function refreshStatuses() {
  await Promise.all(
    [...status.entries()].map(async ([id, cur]) => {
      if (!cur?.port || cur.state === "missing" || cur.state === "crashed" || cur.state === "exited") return;
      const hit = await probeProcess(cur.port);
      if (hit.up) {
        status.set(id, { ...cur, state: "up", http: hit.status });
      } else if (cur.state === "up") {
        status.set(id, { ...cur, state: "degraded", http: hit.status });
      }
    }),
  );
}

function statusPayload() {
  const processes = [...status.entries()].map(([id, s]) => ({ id, ...s }));
  return {
    generatedAt: new Date().toISOString(),
    ready: readiness.ready,
    readiness,
    gatewayPort: MANIFEST.gatewayPort,
    portalPort: MANIFEST.portalPort,
    adminPort: MANIFEST.adminPort,
    upCount: processes.filter((p) => p.state === "up").length,
    processes,
  };
}

function startShell() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    await refreshStatuses();
    if (url.pathname === "/api/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statusPayload(), null, 2));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(shellHtml(statusPayload()));
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log(`FATAL: shell port ${MANIFEST.shellPort} already in use — another suite instance running?`);
      log("stopping all child processes so nothing is orphaned…");
    } else {
      log(`FATAL: shell server error: ${err}`);
    }
    shutdown(1);
  });
  server.listen(MANIFEST.shellPort, "127.0.0.1", () => {
    log(`shell http://127.0.0.1:${MANIFEST.shellPort}/`);
  });
  return server;
}

/**
 * Kills every child (SIGTERM, then SIGKILL after a grace period) and exits
 * with the given code. Never leaves orphans behind.
 */
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down children…");
  for (const c of children) {
    if (c.exitCode === null && c.signalCode === null) {
      try { c.kill("SIGTERM"); } catch {}
    }
  }
  setTimeout(() => {
    for (const c of children) {
      if (c.exitCode === null && c.signalCode === null) {
        try { c.kill("SIGKILL"); } catch {}
      }
    }
    process.exit(code);
  }, SHUTDOWN_GRACE_MS).unref();
  // Exit sooner if every child is already gone.
  const poll = setInterval(() => {
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
      clearInterval(poll);
      process.exit(code);
    }
  }, 200);
  poll.unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (err) => {
  log(`FATAL: uncaught exception: ${err?.stack ?? err}`);
  shutdown(1);
});
process.on("unhandledRejection", (err) => {
  log(`FATAL: unhandled rejection: ${err}`);
  shutdown(1);
});

const all = [...MANIFEST.services, ...MANIFEST.apps];
for (const proc of all) startProcess(proc);
startShell();
const ready = await waitReady(all);

const exportPath = join(ROOT, "docs/suite-runtime.json");
writeFileSync(
  exportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      ready,
      shell: `http://127.0.0.1:${MANIFEST.shellPort}/`,
      portal: `http://127.0.0.1:${MANIFEST.portalPort}/`,
      admin: `http://127.0.0.1:${MANIFEST.adminPort}/`,
      gateway: `http://127.0.0.1:${MANIFEST.gatewayPort}/`,
      openapi: `http://127.0.0.1:${MANIFEST.gatewayPort}/openapi.json`,
      progress: "http://127.0.0.1:8765/progress.html",
      processes: [...status.entries()].map(([id, s]) => ({ id, ...s })),
    },
    null,
    2,
  ),
);
log(`runtime map -> ${exportPath}`);
log(`OPEN http://127.0.0.1:${MANIFEST.shellPort}/`);
