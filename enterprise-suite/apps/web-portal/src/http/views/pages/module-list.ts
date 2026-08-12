import type { ListViewModel } from "../../../application/module-service.js";
import type { ShellModel } from "../../../application/navigation-service.js";
import { dataTable, pager } from "../components.js";
import { html, join, type Html } from "../html.js";

export interface ModuleListPageModel {
  readonly shell: ShellModel;
  readonly view: ListViewModel;
}

export function moduleListPage(model: ModuleListPageModel): Html {
  const { view } = model;
  const searchTerm = view.query.q ?? "";
  const queryTail = searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : "";

  return html`
    <div class="page-head">
      <div>
        <h1>${view.moduleLabel} · ${view.item.label}</h1>
        <p>${view.item.summary}</p>
      </div>
      <div class="spacer"></div>
      ${join(
        view.actions.map(
          (action) => html`
            <form action="${`/m/${view.module}/actions/${action.key}`}" method="post">
              <button class="btn btn--primary" type="submit">${action.label}</button>
            </form>
          `,
        ),
      )}
    </div>

    <div class="toolbar">
      <form action="${view.path}" method="get">
        <input type="search" name="q" value="${searchTerm}" placeholder="Filter ${view.item.label.toLowerCase()}" />
        <button class="btn" type="submit">Apply</button>
      </form>
      ${searchTerm ? html`<a class="btn" href="${view.path}">Clear</a>` : ""}
      <div class="spacer"></div>
      <form action="/preferences/views" method="post">
        <input type="hidden" name="module" value="${view.module}" />
        <input type="hidden" name="resource" value="${view.item.resource}" />
        <input type="hidden" name="q" value="${searchTerm}" />
        <input name="name" placeholder="Save this view as…" />
        <button class="btn" type="submit">Save</button>
      </form>
    </div>

    ${dataTable(view.columns, view.rows)}
    ${pager({
      path: view.path,
      page: view.page,
      pageSize: view.pageSize,
      total: view.total,
      query: queryTail,
    })}
  `;
}
