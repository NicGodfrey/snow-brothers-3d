import type { ShellModel } from "../../../application/navigation-service.js";
import type { Dashboard } from "../../../domain/kpi.js";
import type { PortalPreferences } from "../../../domain/preferences.js";
import { moduleTile } from "../components.js";
import { html, join, type Html } from "../html.js";

export interface DashboardPageModel {
  readonly shell: ShellModel;
  readonly dashboard: Dashboard;
  readonly preferences: PortalPreferences;
  readonly locale: string;
}

export function dashboardPage(model: DashboardPageModel): Html {
  const { dashboard } = model;
  const degraded =
    dashboard.degradedModules.length > 0
      ? html`<p class="notice">
          ${dashboard.degradedModules.length} module(s) did not answer: ${dashboard.degradedModules.join(", ")}.
          The rest of the page is current as of ${dashboard.generatedAt}.
        </p>`
      : "";

  return html`
    <div class="page-head">
      <div>
        <h1>Overview</h1>
        <p>Live figures from every module you can see in ${dashboard.tenantId}.</p>
      </div>
    </div>
    ${degraded}
    <div class="tiles">${join(dashboard.tiles.map((tile) => moduleTile(tile, model.locale)))}</div>
    ${savedViews(model)}
  `;
}

function savedViews(model: DashboardPageModel): Html {
  if (model.preferences.savedViews.length === 0) return html``;
  return html`
    <section class="card" style="margin-top:16px">
      <h2 style="margin-top:0;font-size:15px">Saved views</h2>
      <ul class="list-reset">
        ${join(
          model.preferences.savedViews.map((view) => {
            const query = new URLSearchParams(view.query).toString();
            const href = `/m/${view.module}/${view.resource}${query ? `?${query}` : ""}`;
            return html`<li class="hit">
              <a href="${href}">${view.name}</a>
              <div class="hit__sub">${view.module} · ${view.resource}</div>
            </li>`;
          }),
        )}
      </ul>
    </section>
  `;
}
