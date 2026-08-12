import { deltaSentiment, formatDelta, formatKpi, type DashboardTile, type Kpi } from "../../domain/kpi.js";
import type { Column, ListRow } from "../../application/module-service.js";
import { classes, html, join, type Html } from "./html.js";

/** Shared presentational pieces: KPI cards, tiles, tables, badges, pagers. */

export function badge(text: string, tone: "neutral" | "ok" | "warn" | "error" = "neutral"): Html {
  return html`<span class="${classes(["badge", tone !== "neutral" && `badge--${tone}`])}">${text}</span>`;
}

export function kpiCard(kpi: Kpi, locale: string): Html {
  const sentiment = deltaSentiment(kpi);
  const delta = formatDelta(kpi.delta, locale);
  return html`
    <div class="kpi">
      <div class="kpi__label">${kpi.label}</div>
      <div class="kpi__value">${formatKpi(kpi.value, locale)}</div>
      ${delta ? html`<div class="kpi__delta kpi__delta--${sentiment}">${delta}</div>` : ""}
    </div>
  `;
}

export function moduleTile(tile: DashboardTile, locale: string): Html {
  const body =
    tile.status === "ok"
      ? html`<div class="tile__kpis">${join(tile.kpis.map((kpi) => kpiCard(kpi, locale)))}</div>`
      : html`<p class="notice">${tile.message ?? "Unavailable"}</p>`;
  return html`
    <section class="card tile">
      <div class="tile__head">
        <span class="rail__mark" style="background:${tile.accent}">${tile.label.slice(0, 2).toUpperCase()}</span>
        <h2><a href="${tile.path}">${tile.label}</a></h2>
        ${tile.status === "ok" ? "" : badge(tile.status === "forbidden" ? "no access" : "unavailable", tile.status === "forbidden" ? "warn" : "error")}
      </div>
      ${body}
    </section>
  `;
}

export function dataTable(columns: readonly Column[], rows: readonly ListRow[]): Html {
  if (columns.length === 0 || rows.length === 0) {
    return emptyState("Nothing to show", "No records match the current filter.");
  }
  const head = join(
    columns.map(
      (column) => html`<th class="${column.align === "right" ? "num" : ""}">${column.label}</th>`,
    ),
  );
  const body = join(
    rows.map(
      (row) => html`
        <tr>
          ${join(
            row.cells.map(
              (cell, index) =>
                html`<td class="${columns[index]?.align === "right" ? "num" : ""}">${cell.text}</td>`,
            ),
          )}
        </tr>
      `,
    ),
  );
  return html`
    <div class="table-wrap">
      <table class="grid">
        <thead>
          <tr>${head}</tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
    </div>
  `;
}

export function emptyState(title: string, message: string): Html {
  return html`<div class="empty"><strong>${title}</strong><div>${message}</div></div>`;
}

export interface PagerModel {
  readonly path: string;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly query: string;
}

export function pager(model: PagerModel): Html {
  const lastPage = Math.max(1, Math.ceil(model.total / model.pageSize));
  const link = (page: number, label: string): Html =>
    page >= 1 && page <= lastPage && page !== model.page
      ? html`<a href="${`${model.path}?page=${page}${model.query}`}">${label}</a>`
      : html`<span>${label}</span>`;
  const from = model.total === 0 ? 0 : (model.page - 1) * model.pageSize + 1;
  const to = Math.min(model.total, model.page * model.pageSize);
  return html`
    <div class="pager">
      ${link(model.page - 1, "‹ Previous")} ${link(model.page + 1, "Next ›")}
      <span>${from}–${to} of ${model.total}</span>
    </div>
  `;
}
