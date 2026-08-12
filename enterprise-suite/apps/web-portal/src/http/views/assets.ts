/**
 * Static assets, served from memory by `asset-routes.ts`.
 *
 * The shell has no build step and no framework: one stylesheet and a small
 * progressive-enhancement script (command palette, tenant switcher). Every
 * screen works with JavaScript disabled — the palette degrades to `/search`.
 */

export const PORTAL_CSS = `
:root {
  --bg: #f5f6f8;
  --surface: #ffffff;
  --rail: #10172a;
  --rail-text: #93a3bd;
  --rail-active: #ffffff;
  --border: #dde1e8;
  --text: #1b2333;
  --muted: #66708a;
  --positive: #0f7a4d;
  --negative: #b4242c;
  --radius: 8px;
  --rail-width: 216px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
}
a { color: #1d4ed8; text-decoration: none; }
a:hover { text-decoration: underline; }
.layout { display: grid; grid-template-columns: var(--rail-width) 1fr; min-height: 100vh; }
.rail { background: var(--rail); color: var(--rail-text); padding: 16px 0; }
.rail__brand { padding: 0 18px 18px; color: #fff; font-weight: 600; letter-spacing: 0.02em; }
.rail__brand span { display: block; font-size: 11px; font-weight: 400; color: var(--rail-text); }
.rail__module { padding: 4px 0 10px; }
.rail__module-head {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 18px; color: #cbd5e1; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
}
.rail__mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 5px; font-size: 10px; font-weight: 700; color: #fff;
}
.rail__pin { margin-left: auto; font-size: 11px; color: #7c8bab; }
.rail__link {
  display: flex; justify-content: space-between; gap: 8px;
  padding: 6px 18px 6px 46px; color: var(--rail-text); font-size: 13px;
}
.rail__link:hover { background: rgba(255,255,255,0.06); color: #fff; text-decoration: none; }
.rail__link--active { background: rgba(255,255,255,0.12); color: var(--rail-active); font-weight: 600; }
.rail__link--disabled { color: #55607a; pointer-events: none; }
.rail__count { color: #8fa0bd; font-variant-numeric: tabular-nums; }
.main { display: flex; flex-direction: column; min-width: 0; }
.topbar {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 24px; background: var(--surface); border-bottom: 1px solid var(--border);
}
.topbar form { display: flex; gap: 6px; align-items: center; }
.crumbs { color: var(--muted); font-size: 13px; }
.crumbs span + span::before { content: "/"; margin: 0 8px; color: #c3cad6; }
.spacer { flex: 1; }
.identity { text-align: right; font-size: 12px; color: var(--muted); }
.identity strong { display: block; color: var(--text); font-size: 13px; }
.content { padding: 24px; min-width: 0; }
.page-head { display: flex; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
.page-head h1 { margin: 0; font-size: 20px; }
.page-head p { margin: 4px 0 0; color: var(--muted); }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px;
}
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.tile__head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.tile__head h2 { margin: 0; font-size: 15px; }
.tile__kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.kpi__label { color: var(--muted); font-size: 12px; }
.kpi__value { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.kpi__delta { font-size: 12px; }
.kpi__delta--positive { color: var(--positive); }
.kpi__delta--negative { color: var(--negative); }
.kpi__delta--neutral { color: var(--muted); }
.badge {
  display: inline-block; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; border: 1px solid var(--border); color: var(--muted); background: #f1f3f7;
}
.badge--warn { color: #92400e; background: #fef3c7; border-color: #fde68a; }
.badge--error { color: #7f1d1d; background: #fee2e2; border-color: #fecaca; }
.badge--ok { color: #14532d; background: #dcfce7; border-color: #bbf7d0; }
table.grid { width: 100%; border-collapse: collapse; background: var(--surface); }
table.grid th, table.grid td {
  padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap;
}
table.grid th { font-size: 12px; color: var(--muted); font-weight: 600; background: #fafbfc; }
table.grid td.num, table.grid th.num { text-align: right; font-variant-numeric: tabular-nums; }
table.grid tbody tr:hover { background: #f8fafc; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.toolbar input[type=search], .field input, .field select {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font: inherit;
}
.btn {
  padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px;
  background: #fff; color: var(--text); font: inherit; cursor: pointer;
}
.btn:hover { background: #f1f3f7; }
.btn--primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
.btn--primary:hover { background: #1e40af; }
.pager { display: flex; gap: 12px; align-items: center; margin-top: 12px; color: var(--muted); font-size: 13px; }
.empty { padding: 40px; text-align: center; color: var(--muted); background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius); }
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; font-size: 13px; }
.field label { color: var(--muted); }
.stack > * + * { margin-top: 12px; }
.list-reset { list-style: none; margin: 0; padding: 0; }
.hit { padding: 8px 0; border-bottom: 1px solid var(--border); }
.hit__sub { color: var(--muted); font-size: 12px; }
.notice { padding: 10px 12px; border-radius: 6px; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; }
body.density-compact .content { padding: 14px; }
body.density-compact table.grid th, body.density-compact table.grid td { padding: 4px 8px; }
`;

export const PORTAL_JS = `
(function () {
  var palette = document.querySelector("[data-palette]");
  if (palette) {
    document.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        var input = palette.querySelector("input[name=q]");
        if (input) input.focus();
      }
    });
  }
  document.querySelectorAll("[data-autosubmit]").forEach(function (element) {
    element.addEventListener("change", function () {
      var form = element.closest("form");
      if (form) form.submit();
    });
  });
})();
`;
