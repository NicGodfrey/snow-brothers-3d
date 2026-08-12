import type { ShellModel } from "../../../application/navigation-service.js";
import type { PortalPreferences } from "../../../domain/preferences.js";
import { MAX_PINNED_MODULES } from "../../../domain/preferences.js";
import type { NavModuleView } from "../../../domain/navigation.js";
import { html, join, type Html } from "../html.js";

export interface PreferencesPageModel {
  readonly shell: ShellModel;
  readonly preferences: PortalPreferences;
  readonly modules: readonly NavModuleView[];
  readonly saved?: boolean;
}

export function preferencesPage(model: PreferencesPageModel): Html {
  const { preferences } = model;
  return html`
    <div class="page-head">
      <div>
        <h1>Preferences</h1>
        <p>Applies to ${model.shell.user.email} in this tenant only.</p>
      </div>
    </div>
    ${model.saved ? html`<p class="notice">Preferences saved.</p>` : ""}
    <div class="grid-2">
      <section class="card">
        <h2 style="margin-top:0;font-size:15px">Display</h2>
        <form action="/preferences" method="post" class="stack">
          <div class="field">
            <label for="density">Row density</label>
            <select id="density" name="density">
              ${option("comfortable", "Comfortable", preferences.density)}
              ${option("compact", "Compact", preferences.density)}
            </select>
          </div>
          <div class="field">
            <label for="theme">Theme</label>
            <select id="theme" name="theme">
              ${option("system", "Match system", preferences.theme)}
              ${option("light", "Light", preferences.theme)}
              ${option("dark", "Dark", preferences.theme)}
            </select>
          </div>
          <div class="field">
            <label for="landingModule">Landing module</label>
            <select id="landingModule" name="landingModule">
              <option value="">Overview dashboard</option>
              ${join(
                model.modules.map(
                  (module) =>
                    html`<option value="${module.key}" ${preferences.landingModule === module.key ? "selected" : ""}>
                      ${module.label}
                    </option>`,
                ),
              )}
            </select>
          </div>
          <div class="field">
            <label for="locale">Locale</label>
            <input id="locale" name="locale" value="${preferences.locale}" />
          </div>
          <button class="btn btn--primary" type="submit">Save</button>
        </form>
      </section>

      <section class="card">
        <h2 style="margin-top:0;font-size:15px">Pinned modules</h2>
        <p style="color:var(--muted)">Pinned modules sort to the top of the rail (max ${MAX_PINNED_MODULES}).</p>
        <ul class="list-reset">
          ${join(
            model.modules.map(
              (module) => html`
                <li class="hit" style="display:flex;align-items:center;gap:8px">
                  <span class="rail__mark" style="background:${module.accent}">${module.mark}</span>
                  <span>${module.label}</span>
                  <span class="spacer"></span>
                  <form action="${`/preferences/pins/${module.key}`}" method="post">
                    <button class="btn" type="submit">
                      ${preferences.pinnedModules.includes(module.key) ? "Unpin" : "Pin"}
                    </button>
                  </form>
                </li>
              `,
            ),
          )}
        </ul>
      </section>

      <section class="card">
        <h2 style="margin-top:0;font-size:15px">Saved views</h2>
        ${preferences.savedViews.length === 0
          ? html`<p style="color:var(--muted)">Save a filtered list from any module screen.</p>`
          : html`<ul class="list-reset">
              ${join(
                preferences.savedViews.map(
                  (view) => html`
                    <li class="hit" style="display:flex;align-items:center;gap:8px">
                      <div>
                        <a href="${`/m/${view.module}/${view.resource}`}">${view.name}</a>
                        <div class="hit__sub">${view.module} · ${view.resource}</div>
                      </div>
                      <span class="spacer"></span>
                      <form action="${`/preferences/views/${view.id}/delete`}" method="post">
                        <button class="btn" type="submit">Remove</button>
                      </form>
                    </li>
                  `,
                ),
              )}
            </ul>`}
      </section>
    </div>
  `;
}

function option(value: string, label: string, current: string): Html {
  return html`<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
}
