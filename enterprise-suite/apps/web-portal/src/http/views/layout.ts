import type { ShellModel } from "../../application/navigation-service.js";
import type { NavModuleView } from "../../domain/navigation.js";
import { classes, html, join, type Html } from "./html.js";

/**
 * The portal chrome: module rail, topbar with tenant switcher and search, and
 * the breadcrumb strip. Pages supply only their own content.
 */

export interface PageOptions {
  readonly title: string;
  readonly shell: ShellModel;
  readonly content: Html;
  /** Live counts keyed by `NavItem.countKey`, when the caller has them. */
  readonly counts?: Readonly<Record<string, number>>;
}

export function renderPage(options: PageOptions): Html {
  const { shell } = options;
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${options.title} · Enterprise Portal</title>
    <link rel="stylesheet" href="/assets/portal.css" />
  </head>
  <body class="${classes([`density-${shell.density}`, `theme-${shell.theme}`])}">
    <div class="layout">
      ${rail(shell, options.counts ?? {})}
      <div class="main">
        ${topbar(shell)}
        <main class="content">${options.content}</main>
      </div>
    </div>
    <script src="/assets/portal.js" defer></script>
  </body>
</html>`;
}

function rail(shell: ShellModel, counts: Readonly<Record<string, number>>): Html {
  return html`
    <nav class="rail" aria-label="Modules">
      <div class="rail__brand">
        Enterprise Suite
        <span>${shell.tenants.find((t) => t.current)?.name ?? "—"}</span>
      </div>
      <a class="${classes(["rail__link", shell.route.kind === "dashboard" && "rail__link--active"])}" href="/">
        Overview
      </a>
      ${join(shell.nav.map((module) => railModule(module, counts)))}
      <a class="${classes(["rail__link", shell.route.kind === "system" && shell.route.route === "preferences" && "rail__link--active"])}" href="/preferences">
        Preferences
      </a>
    </nav>
  `;
}

function railModule(module: NavModuleView, counts: Readonly<Record<string, number>>): Html {
  return html`
    <div class="rail__module">
      <div class="rail__module-head">
        <span class="rail__mark" style="background:${module.accent}">${module.mark}</span>
        ${module.label}
        ${module.pinned ? html`<span class="rail__pin">pinned</span>` : ""}
      </div>
      ${join(
        module.items.map((item) => {
          const count = item.countKey ? counts[item.countKey] : undefined;
          return html`
            <a
              class="${classes([
                "rail__link",
                item.active && "rail__link--active",
                !item.enabled && "rail__link--disabled",
              ])}"
              href="${item.enabled ? item.path : "#"}"
              title="${item.enabled ? item.summary : "You do not have access to this view"}"
            >
              <span>${item.label}</span>
              ${count !== undefined ? html`<span class="rail__count">${count}</span>` : ""}
            </a>
          `;
        }),
      )}
    </div>
  `;
}

function topbar(shell: ShellModel): Html {
  const crumbs = join(
    shell.crumbs.map((crumb) =>
      crumb.path ? html`<span><a href="${crumb.path}">${crumb.label}</a></span>` : html`<span>${crumb.label}</span>`,
    ),
  );
  return html`
    <header class="topbar">
      <div class="crumbs">${crumbs}</div>
      <div class="spacer"></div>
      ${shell.commandPaletteEnabled
        ? html`
            <form data-palette action="/search" method="get" role="search">
              <input type="search" name="q" placeholder="Search all modules (⌘K)" aria-label="Search" />
              <button class="btn" type="submit">Search</button>
            </form>
          `
        : ""}
      <form action="/switch-tenant" method="post">
        <label class="sr-only" for="tenant">Tenant</label>
        <select id="tenant" name="tenantId" data-autosubmit>
          ${join(
            shell.tenants.map(
              (tenant) =>
                html`<option value="${tenant.tenantId}" ${tenant.current ? "selected" : ""}>${tenant.name}</option>`,
            ),
          )}
        </select>
        <noscript><button class="btn" type="submit">Switch</button></noscript>
      </form>
      <div class="identity">
        <strong>${shell.user.displayName}</strong>
        ${shell.user.roles.join(", ")}
        ${shell.user.impersonatedBy ? html` · impersonated by ${shell.user.impersonatedBy}` : ""}
      </div>
      <form action="/sign-out" method="post"><button class="btn" type="submit">Sign out</button></form>
    </header>
  `;
}
