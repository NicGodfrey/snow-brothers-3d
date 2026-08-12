import type { TenantProfile, UserProfile } from "../../../domain/session.js";
import { html, join, type Html } from "../html.js";

export interface SignInPageModel {
  readonly users: readonly UserProfile[];
  readonly tenants: readonly TenantProfile[];
  readonly error?: string;
  readonly next?: string;
}

/**
 * Development sign-in. The mock directory is listed on the page on purpose:
 * this screen exists so the shell can be driven without identity-access, and
 * it is replaced by an OIDC redirect when that service is wired in.
 */
export function signInPage(model: SignInPageModel): Html {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in · Enterprise Portal</title>
    <link rel="stylesheet" href="/assets/portal.css" />
  </head>
  <body>
    <main class="content" style="max-width:480px;margin:64px auto">
      <div class="card">
        <h1 style="margin-top:0;font-size:20px">Enterprise Portal</h1>
        <p style="color:var(--muted)">Mock identity provider — pick a user to impersonate a role set.</p>
        ${model.error ? html`<p class="notice">${model.error}</p>` : ""}
        <form action="/sign-in" method="post" class="stack">
          <input type="hidden" name="next" value="${model.next ?? "/"}" />
          <div class="field">
            <label for="email">User</label>
            <select id="email" name="email">
              ${join(
                model.users.map(
                  (user) => html`<option value="${user.email}">
                    ${user.displayName} — ${Object.entries(user.memberships)
                      .map(([tenant, roles]) => `${tenant}: ${roles.join("/")}`)
                      .join(" · ")}
                  </option>`,
                ),
              )}
            </select>
          </div>
          <div class="field">
            <label for="tenantId">Tenant</label>
            <select id="tenantId" name="tenantId">
              ${join(
                model.tenants.map(
                  (tenant) =>
                    html`<option value="${tenant.tenantId}">
                      ${tenant.name} (${tenant.entitlements.length} modules)
                    </option>`,
                ),
              )}
            </select>
          </div>
          <button class="btn btn--primary" type="submit">Sign in</button>
        </form>
      </div>
    </main>
  </body>
</html>`;
}
