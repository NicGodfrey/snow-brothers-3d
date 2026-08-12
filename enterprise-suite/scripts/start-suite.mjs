#!/usr/bin/env node
/**
 * Boots the whole Enterprise Suite as one system:
 *   - 18 domain services on ports 4101–4118
 *   - api-gateway on 4100 (ASSUME_DEPLOYED)
 *   - admin-console on 4119
 *   - web-portal on 4300
 *   - suite shell landing page on 4000
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "scripts/suite-manifest.json"), "utf8"));
const LOG_DIR = join(ROOT, ".suite-logs");
const children = [];
const status = new Map();

mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const line = `[suite] ${new Date().toISOString()} ${msg}`;
  console.log(line);
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
    ...(proc.env ?? {}),
  };

  const child = spawn(
    process.execPath,
    ["--import", "tsx", entry],
    {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );

  const logPath = join(LOG_DIR, `${proc.id}.log`);
  const stream = { write(chunk) { writeFileSync(logPath, chunk, { flag: "a" }); } };
  child.stdout.on("data", (buf) => stream.write(buf));
  child.stderr.on("data", (buf) => stream.write(buf));

  status.set(proc.id, { state: "starting", port: proc.port, pid: child.pid, log: logPath });
  child.on("exit", (code, signal) => {
    status.set(proc.id, {
      state: code === 0 ? "exited" : "crashed",
      port: proc.port,
      pid: child.pid,
      code,
      signal,
      log: logPath,
    });
    log(`${proc.id} exited code=${code} signal=${signal ?? "-"}`);
  });

  children.push(child);
  log(`START ${proc.id} :${proc.port} pid=${child.pid}`);
  return child;
}

async function probe(port, path = "/health") {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ctrl.signal });
    clearTimeout(t);
    return { ok: res.ok || res.status < 500, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function waitReady(procs, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    let ready = 0;
    for (const p of procs) {
      const cur = status.get(p.id);
      if (cur?.state === "missing" || cur?.state === "crashed") continue;
      const hit = await probe(p.port, "/health");
      if (!hit.ok) {
        // some services only expose /health/ready or /health/live
        const alt = await probe(p.port, "/health/live");
        if (alt.ok || (await probe(p.port, "/")).ok) {
          status.set(p.id, { ...cur, state: "up", http: alt.status || 200 });
          ready += 1;
          continue;
        }
      } else {
        status.set(p.id, { ...cur, state: "up", http: hit.status });
        ready += 1;
        continue;
      }
    }
    if (ready >= procs.filter((p) => status.get(p.id)?.state !== "missing").length * 0.6) {
      log(`readiness pass ${ready}/${procs.length}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  log("readiness timed out — shell still available");
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
.st.crashed,.st.missing{color:var(--bad);background:rgba(180,35,24,.08)}
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
<p class="meta">updated ${payload.generatedAt} · up ${payload.upCount}/${payload.processes.length} · logs in .suite-logs/</p>
<script>setTimeout(()=>location.reload(),8000)</script>
</div></body></html>`;
}

async function refreshStatuses() {
  for (const [id, cur] of status.entries()) {
    if (!cur?.port || cur.state === "missing" || cur.state === "crashed" || cur.state === "exited") continue;
    const hit = await probe(cur.port, "/health");
    if (hit.ok) {
      status.set(id, { ...cur, state: "up", http: hit.status });
      continue;
    }
    const root = await probe(cur.port, "/");
    if (root.ok) status.set(id, { ...cur, state: "up", http: root.status });
  }
}

function startShell() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    await refreshStatuses();
    if (url.pathname === "/api/status") {
      const processes = [...status.entries()].map(([id, s]) => ({ id, ...s }));
      const body = JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          gatewayPort: MANIFEST.gatewayPort,
          portalPort: MANIFEST.portalPort,
          adminPort: MANIFEST.adminPort,
          upCount: processes.filter((p) => p.state === "up").length,
          processes,
        },
        null,
        2,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    const processes = [...status.entries()].map(([id, s]) => ({ id, ...s }));
    const html = shellHtml({
      generatedAt: new Date().toISOString(),
      gatewayPort: MANIFEST.gatewayPort,
      portalPort: MANIFEST.portalPort,
      adminPort: MANIFEST.adminPort,
      upCount: processes.filter((p) => p.state === "up").length,
      processes,
    });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  server.listen(MANIFEST.shellPort, "127.0.0.1", () => {
    log(`shell http://127.0.0.1:${MANIFEST.shellPort}/`);
  });
  return server;
}

function shutdown() {
  log("shutting down children…");
  for (const c of children) {
    try { c.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => process.exit(0), 800);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const all = [...MANIFEST.services, ...MANIFEST.apps];
for (const proc of all) startProcess(proc);
startShell();
await waitReady(all);

const exportPath = join(ROOT, "docs/suite-runtime.json");
writeFileSync(
  exportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
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
