/**
 * The admin shell.
 *
 * A single self-contained page: no build step, no framework, no CDN. It talks
 * to the same JSON API as every other client, with the tenant headers taken
 * from the toolbar, which makes it a working demonstration of the header
 * contract rather than a mock.
 */

export interface ShellOptions {
  readonly basePath: string;
  readonly version: string;
  readonly defaultTenant: string;
  readonly defaultUser: string;
  readonly defaultRoles: string;
}

const STYLES = `
:root {
  --bg: #0f1216; --panel: #161b22; --panel-2: #1c232c; --line: #2a323d;
  --text: #e6edf3; --muted: #9aa7b4; --accent: #4f9cf9; --ok: #3fb950;
  --warn: #d29922; --bad: #f85149; --radius: 10px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { display: flex; gap: 12px; align-items: center; padding: 12px 20px;
  background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
header h1 { font-size: 15px; margin: 0 16px 0 0; letter-spacing: .3px; }
header .spacer { flex: 1; }
label { color: var(--muted); font-size: 12px; display: inline-flex; gap: 6px; align-items: center; }
input, select, textarea { background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 13px; }
input:focus, select:focus, textarea:focus { outline: 1px solid var(--accent); }
button { background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 13px; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #08111c; font-weight: 600; }
main { display: grid; grid-template-columns: 210px 1fr; min-height: calc(100vh - 57px); }
nav { border-right: 1px solid var(--line); padding: 14px 10px; background: var(--panel); }
nav a { display: block; padding: 8px 12px; border-radius: 8px; color: var(--muted);
  text-decoration: none; cursor: pointer; }
nav a.active, nav a:hover { background: var(--panel-2); color: var(--text); }
section { padding: 20px 24px; }
h2 { font-size: 18px; margin: 0 0 4px; }
p.hint { color: var(--muted); margin: 0 0 18px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin-bottom: 22px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }
.card .value { font-size: 24px; font-weight: 600; }
.card .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .6px; }
table { width: 100%; border-collapse: collapse; background: var(--panel);
  border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
tr:last-child td { border-bottom: none; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px;
  border: 1px solid var(--line); }
.pill.active, .pill.published, .pill.delivered, .pill.on { color: var(--ok); border-color: var(--ok); }
.pill.paused, .pill.draft, .pill.invited, .pill.pending { color: var(--warn); border-color: var(--warn); }
.pill.suspended, .pill.disabled, .pill.dead, .pill.deactivated, .pill.off { color: var(--bad); border-color: var(--bad); }
.toolbar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.bar { height: 6px; background: var(--panel-2); border-radius: 3px; overflow: hidden; width: 120px; }
.bar > i { display: block; height: 100%; background: var(--accent); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
pre { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px;
  padding: 12px; overflow: auto; max-height: 320px; }
#flash { position: fixed; right: 18px; bottom: 18px; max-width: 460px; padding: 10px 14px;
  border-radius: 8px; border: 1px solid var(--line); background: var(--panel);
  display: none; white-space: pre-wrap; }
#flash.error { border-color: var(--bad); color: var(--bad); }
#flash.ok { border-color: var(--ok); color: var(--ok); }
`;

const SCRIPT = `
const BASE = window.__ADMIN_BASE__;
const state = { view: "overview" };

function creds() {
  return {
    tenant: document.getElementById("tenant").value.trim(),
    user: document.getElementById("user").value.trim(),
    roles: document.getElementById("roles").value.trim(),
  };
}

function saveCreds() {
  localStorage.setItem("admin-console-creds", JSON.stringify(creds()));
}

async function api(path, options = {}) {
  const { tenant, user, roles } = creds();
  const response = await fetch(BASE + path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": tenant,
      "x-user-id": user,
      "x-roles": roles,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = payload && payload.message ? payload.message : response.statusText;
    throw new Error(response.status + " " + message);
  }
  return payload;
}

function flash(message, kind) {
  const el = document.getElementById("flash");
  el.textContent = message;
  el.className = kind || "ok";
  el.style.display = "block";
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { el.style.display = "none"; }, 4000);
}

function esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pill(value) {
  return '<span class="pill ' + esc(value) + '">' + esc(value) + "</span>";
}

function table(columns, rows) {
  if (!rows.length) return '<p class="hint">Nothing here yet.</p>';
  const head = columns.map((c) => "<th>" + esc(c.label) + "</th>").join("");
  const body = rows
    .map((row) => "<tr>" + columns.map((c) => "<td>" + c.render(row) + "</td>").join("") + "</tr>")
    .join("");
  return "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
}

const views = {
  async overview(root) {
    const data = await api("/overview");
    const quota = data.quotas.entries
      .map((entry) =>
        '<tr><td>' + esc(entry.resource) + "</td><td>" + entry.used + " / " + entry.limit +
        '</td><td><div class="bar"><i style="width:' + Math.min(100, entry.percent) + '%"></i></div></td></tr>')
      .join("");
    root.innerHTML =
      "<h2>" + esc(data.tenant.name) + "</h2>" +
      '<p class="hint">' + esc(data.tenant.key) + " · " + pill(data.tenant.status) + " · plan " +
      esc(data.tenant.plan) + "</p>" +
      '<div class="cards">' +
      card("Active users", data.users.active, data.users.invited + " invited") +
      card("Roles", data.roles, "") +
      card("Reference sets", data.referenceData.published, data.referenceData.drafts + " draft") +
      card("Webhooks", data.webhooks.active, data.webhooks.deadLetters + " dead letters") +
      card("Feature flags", data.featureFlags.enabled + "/" + data.featureFlags.total, data.featureFlags.rollingOut + " rolling out") +
      card("Audit entries", data.audit.total, "") +
      "</div>" +
      "<h3>Quota usage</h3><table><thead><tr><th>Resource</th><th>Used</th><th></th></tr></thead><tbody>" +
      quota + "</tbody></table>";
  },

  async users(root) {
    const [users, roles] = await Promise.all([api("/users?pageSize=100"), api("/roles")]);
    root.innerHTML =
      "<h2>Users &amp; roles</h2>" +
      '<p class="hint">Invitations expire after seven days. The last active administrator cannot be removed.</p>' +
      '<div class="toolbar">' +
      '<input id="inv-email" placeholder="email" size="26">' +
      '<input id="inv-name" placeholder="display name" size="20">' +
      '<input id="inv-roles" placeholder="roles (comma separated)" size="24" value="tenant-operator">' +
      '<button class="primary" onclick="invite()">Invite user</button></div>' +
      table(
        [
          { label: "Email", render: (u) => esc(u.email) },
          { label: "Name", render: (u) => esc(u.displayName) },
          { label: "Status", render: (u) => pill(u.status) },
          { label: "Roles", render: (u) => u.roles.map(esc).join(", ") },
          { label: "MFA", render: (u) => (u.mfaEnabled ? "on" : "off") },
          {
            label: "",
            render: (u) =>
              u.status === "active"
                ? '<button onclick="suspendUser(\\'' + esc(u.email) + '\\')">Suspend</button>'
                : u.status === "suspended"
                  ? '<button onclick="reinstateUser(\\'' + esc(u.email) + '\\')">Reinstate</button>'
                  : "",
          },
        ],
        users.items,
      ) +
      "<h3>Roles</h3>" +
      table(
        [
          { label: "Code", render: (r) => "<code>" + esc(r.code) + "</code>" },
          { label: "Name", render: (r) => esc(r.name) },
          { label: "Inherits", render: (r) => esc(r.inheritsFrom || "—") },
          { label: "Users", render: (r) => r.userCount },
          { label: "Permissions", render: (r) => r.permissions.length + " resolved" },
          { label: "Managed by", render: (r) => (r.system ? "platform" : "tenant") },
        ],
        roles.items,
      );
  },

  async reference(root) {
    const sets = await api("/reference-data");
    root.innerHTML =
      "<h2>Reference data</h2>" +
      '<p class="hint">Draft sets are invisible to domain services until published. Entries are retired, never deleted.</p>' +
      table(
        [
          { label: "Code", render: (s) => "<code>" + esc(s.code) + "</code>" },
          { label: "Name", render: (s) => esc(s.name) },
          { label: "Status", render: (s) => pill(s.status) },
          { label: "Entries", render: (s) => s.activeEntryCount + " / " + s.entryCount },
          { label: "Revision", render: (s) => s.revision },
          {
            label: "",
            render: (s) =>
              '<button onclick="showSet(\\'' + esc(s.code) + '\\')">Entries</button>' +
              (s.status === "draft"
                ? ' <button onclick="publishSet(\\'' + esc(s.code) + '\\')">Publish</button>'
                : ""),
          },
        ],
        sets.items,
      ) +
      '<div id="set-detail"></div>';
  },

  async webhooks(root) {
    const data = await api("/webhooks");
    root.innerHTML =
      "<h2>Webhooks</h2>" +
      '<p class="hint">Payloads are signed with HMAC-SHA256 over &lt;timestamp&gt;.&lt;body&gt;. Ten consecutive failures pause a subscription.</p>' +
      '<div class="toolbar"><button onclick="drain()">Run due deliveries</button></div>' +
      table(
        [
          { label: "Name", render: (w) => esc(w.name) },
          { label: "URL", render: (w) => "<code>" + esc(w.url) + "</code>" },
          { label: "Status", render: (w) => pill(w.status) },
          { label: "Events", render: (w) => w.eventFilters.map(esc).join("<br>") },
          { label: "Deliveries", render: (w) => w.totalDeliveries + " (" + w.totalFailures + " failed)" },
          {
            label: "",
            render: (w) =>
              '<button onclick="testHook(\\'' + esc(w.id) + '\\')">Test</button> ' +
              (w.status === "active"
                ? '<button onclick="pauseHook(\\'' + esc(w.id) + '\\')">Pause</button>'
                : w.status === "paused"
                  ? '<button onclick="resumeHook(\\'' + esc(w.id) + '\\')">Resume</button>'
                  : ""),
          },
        ],
        data.items,
      );
  },

  async flags(root) {
    const data = await api("/feature-flags");
    root.innerHTML =
      "<h2>Feature flags</h2>" +
      '<p class="hint">Rules are evaluated in priority order, then the percentage rollout. Bucketing is stable per flag and subject.</p>' +
      table(
        [
          { label: "Key", render: (f) => "<code>" + esc(f.key) + "</code>" },
          { label: "Name", render: (f) => esc(f.name) },
          { label: "State", render: (f) => pill(f.enabled ? "on" : "off") },
          { label: "Rollout", render: (f) => f.rolloutPercentage + "%" },
          { label: "Rules", render: (f) => f.rules.length },
          { label: "Tags", render: (f) => f.tags.map(esc).join(", ") },
          {
            label: "",
            render: (f) =>
              '<button onclick="toggleFlag(\\'' + esc(f.key) + '\\',' + (!f.enabled) + ')">' +
              (f.enabled ? "Disable" : "Enable") + "</button> " +
              '<button onclick="explainFlag(\\'' + esc(f.key) + '\\')">Explain</button>',
          },
        ],
        data.items,
      ) +
      '<div id="flag-detail"></div>';
  },

  async audit(root) {
    const data = await api("/audit-log?pageSize=50");
    root.innerHTML =
      "<h2>Audit log</h2>" +
      '<p class="hint">Every state change, with the acting principal and the before/after snapshot. Secrets are redacted at write time.</p>' +
      table(
        [
          { label: "When", render: (e) => esc(e.at) },
          { label: "Actor", render: (e) => esc(e.actor) },
          { label: "Action", render: (e) => "<code>" + esc(e.action) + "</code>" },
          { label: "Resource", render: (e) => esc(e.resourceType) + " " + esc(e.resourceId) },
          { label: "Outcome", render: (e) => pill(e.outcome) },
        ],
        data.items,
      );
  },
};

function card(label, value, sub) {
  return '<div class="card"><div class="label">' + esc(label) + '</div><div class="value">' +
    esc(value) + '</div><div class="label">' + esc(sub) + "</div></div>";
}

async function render(view) {
  state.view = view;
  for (const link of document.querySelectorAll("nav a")) {
    link.classList.toggle("active", link.dataset.view === view);
  }
  const root = document.getElementById("view");
  root.innerHTML = '<p class="hint">Loading…</p>';
  try {
    await views[view](root);
  } catch (error) {
    root.innerHTML = '<p class="hint">' + esc(error.message) + "</p>";
    flash(error.message, "error");
  }
}

async function run(promise, message) {
  try {
    const result = await promise;
    flash(message, "ok");
    await render(state.view);
    return result;
  } catch (error) {
    flash(error.message, "error");
  }
}

window.invite = () =>
  run(
    api("/users", {
      method: "POST",
      body: {
        email: document.getElementById("inv-email").value,
        displayName: document.getElementById("inv-name").value,
        roles: document.getElementById("inv-roles").value.split(",").map((r) => r.trim()).filter(Boolean),
      },
    }),
    "Invitation sent",
  );
window.suspendUser = (email) =>
  run(api("/users/" + encodeURIComponent(email) + "/suspend", { method: "POST", body: { reason: "suspended from console" } }), "User suspended");
window.reinstateUser = (email) =>
  run(api("/users/" + encodeURIComponent(email) + "/reinstate", { method: "POST", body: {} }), "User reinstated");
window.publishSet = (code) =>
  run(api("/reference-data/" + code + "/publish", { method: "POST", body: {} }), "Set published");
window.showSet = async (code) => {
  const set = await api("/reference-data/" + code + "?includeInactive=true");
  document.getElementById("set-detail").innerHTML =
    "<h3>" + esc(set.name) + "</h3>" +
    table(
      [
        { label: "Code", render: (e) => "<code>" + esc(e.code) + "</code>" },
        { label: "Label", render: (e) => esc(e.label) },
        { label: "Parent", render: (e) => esc(e.parentCode || "—") },
        { label: "Active", render: (e) => (e.active ? "yes" : "no") },
        { label: "Effective to", render: (e) => esc(e.effectiveTo || "—") },
      ],
      set.entries,
    );
};
window.drain = () => run(api("/webhooks/drain", { method: "POST", body: {} }), "Delivery queue drained");
window.testHook = (id) => run(api("/webhooks/" + id + "/test", { method: "POST", body: {} }), "Test delivery sent");
window.pauseHook = (id) => run(api("/webhooks/" + id + "/pause", { method: "POST", body: { reason: "paused from console" } }), "Webhook paused");
window.resumeHook = (id) => run(api("/webhooks/" + id + "/resume", { method: "POST", body: {} }), "Webhook resumed");
window.toggleFlag = (key, enabled) =>
  run(api("/feature-flags/" + key, { method: "PATCH", body: { enabled } }), "Flag " + (enabled ? "enabled" : "disabled"));
window.explainFlag = async (key) => {
  const result = await api("/feature-flags/" + key + "/explain", {
    method: "POST",
    body: { subject: creds().user, attributes: { site: "leeds", plan: "standard" } },
  });
  document.getElementById("flag-detail").innerHTML =
    "<h3>Evaluation for " + esc(creds().user) + "</h3><pre>" + esc(JSON.stringify(result, null, 2)) + "</pre>";
};

document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("admin-console-creds");
  if (saved) {
    const parsed = JSON.parse(saved);
    document.getElementById("tenant").value = parsed.tenant;
    document.getElementById("user").value = parsed.user;
    document.getElementById("roles").value = parsed.roles;
  }
  for (const link of document.querySelectorAll("nav a")) {
    link.addEventListener("click", () => render(link.dataset.view));
  }
  for (const field of ["tenant", "user", "roles"]) {
    document.getElementById(field).addEventListener("change", () => {
      saveCreds();
      render(state.view);
    });
  }
  render("overview");
});
`;

export function renderShell(options: ShellOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Enterprise Suite — Admin Console</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>Admin Console <span style="color:var(--muted);font-weight:400">v${escapeHtml(options.version)}</span></h1>
  <label>tenant <input id="tenant" size="14" value="${escapeHtml(options.defaultTenant)}"></label>
  <label>user <input id="user" size="20" value="${escapeHtml(options.defaultUser)}"></label>
  <label>roles <input id="roles" size="22" value="${escapeHtml(options.defaultRoles)}"></label>
  <span class="spacer"></span>
  <a href="${escapeHtml(options.basePath)}/openapi.json" style="color:var(--muted)">OpenAPI</a>
</header>
<main>
  <nav>
    <a data-view="overview" class="active">Overview</a>
    <a data-view="users">Users &amp; roles</a>
    <a data-view="reference">Reference data</a>
    <a data-view="webhooks">Webhooks</a>
    <a data-view="flags">Feature flags</a>
    <a data-view="audit">Audit log</a>
  </nav>
  <section id="view"></section>
</main>
<div id="flash"></div>
<script>window.__ADMIN_BASE__ = ${JSON.stringify(options.basePath)};</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
