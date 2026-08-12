import type { ShellModel } from "../../../application/navigation-service.js";
import type { PortalSession } from "../../../domain/session.js";
import { html, join, type Html } from "../html.js";

export interface ProfilePageModel {
  readonly shell: ShellModel;
  readonly session: PortalSession;
}

/** What the portal believes about you — the first stop when a screen 403s. */
export function profilePage(model: ProfilePageModel): Html {
  const { session } = model;
  return html`
    <div class="page-head">
      <div>
        <h1>${session.user.displayName}</h1>
        <p>${session.user.email} · session ${session.sessionId}</p>
      </div>
    </div>
    <div class="grid-2">
      <section class="card">
        <h2 style="margin-top:0;font-size:15px">Tenant</h2>
        <p><strong>${session.tenant.name}</strong> (${session.tenant.tenantId})</p>
        <p>Entitlements: ${session.tenant.entitlements.join(", ")}</p>
        <p>Locale ${session.tenant.defaultLocale} · currency ${session.tenant.defaultCurrency}</p>
        <p>Session expires ${session.expiresAt}</p>
      </section>
      <section class="card">
        <h2 style="margin-top:0;font-size:15px">Roles and permissions</h2>
        <p>${session.roles.join(", ")}</p>
        <ul class="list-reset">
          ${join(session.permissions.list().map((permission) => html`<li class="hit">${permission}</li>`))}
        </ul>
      </section>
    </div>
  `;
}
