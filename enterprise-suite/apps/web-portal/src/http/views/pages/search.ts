import type { ShellModel } from "../../../application/navigation-service.js";
import type { SearchResult } from "../../../application/search-service.js";
import { emptyState } from "../components.js";
import { html, join, type Html } from "../html.js";

export interface SearchPageModel {
  readonly shell: ShellModel;
  readonly result: SearchResult;
}

export function searchPage(model: SearchPageModel): Html {
  const { result } = model;
  const body =
    result.term.length === 0
      ? emptyState("Search everything", "Quotes, campaigns, stock, suppliers, partners, invoices.")
      : result.totalHits === 0
        ? emptyState("No matches", `Nothing matched “${result.term}”.`)
        : join(result.groups.map(group));

  return html`
    <div class="page-head">
      <div>
        <h1>Search</h1>
        <p>${result.totalHits} result(s)${result.truncated ? " (truncated)" : ""} for “${result.term}”.</p>
      </div>
    </div>
    <form class="toolbar" action="/search" method="get">
      <input type="search" name="q" value="${result.term}" placeholder="Search all modules" autofocus />
      <button class="btn btn--primary" type="submit">Search</button>
    </form>
    ${result.unavailableModules.length > 0
      ? html`<p class="notice">Not searched (module unavailable): ${result.unavailableModules.join(", ")}.</p>`
      : ""}
    <div class="grid-2">${body}</div>
  `;
}

function group(group: SearchResult["groups"][number]): Html {
  return html`
    <section class="card">
      <h2 style="margin-top:0;font-size:15px">${group.label}</h2>
      <ul class="list-reset">
        ${join(
          group.hits.map(
            (hit) => html`
              <li class="hit">
                <a href="${hit.path}">${hit.title}</a>
                <div class="hit__sub">${hit.subtitle}</div>
              </li>
            `,
          ),
        )}
      </ul>
    </section>
  `;
}
