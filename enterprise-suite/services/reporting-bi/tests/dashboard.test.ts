/**
 * Dashboards: layout rules and rendering.
 *
 * Two things carry weight. Tiles store relative windows, so a dashboard
 * saved in June must still resolve correctly in August without anyone
 * editing it. And rendering is per-tile: a tile whose metric was deprecated
 * out from under it reports its own error while the rest of the page still
 * draws.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRID_COLUMNS } from "../src/domain/dashboard.js";
import { ReportingEventTypes } from "../src/domain/events.js";
import { PERIOD_KEY } from "../src/domain/query.js";
import { appendFacts, harness, publishedTypes, smallCube, TEST_CUBE, type Harness } from "./helpers.js";

const CODE = "sales-overview";

async function seeded(): Promise<Harness> {
  const h = harness();
  await smallCube(h);
  await appendFacts(h, [
    { at: "2026-06-05T10:00:00Z", channel: "web", orders: 2, revenue: 300 },
    { at: "2026-07-11T10:00:00Z", channel: "web", orders: 3, revenue: 900 },
    { at: "2026-08-02T10:00:00Z", channel: "retail", orders: 1, revenue: 200 },
  ]);
  await h.module.services.dashboards.createDashboard(h.ctx, {
    code: CODE,
    title: "Sales overview",
  });
  return h;
}

const chartTile = {
  type: "chart" as const,
  title: "Revenue by month",
  chart: { kind: "line" as const },
  layout: { row: 0, col: 0, width: 8, height: 3 },
  window: { grain: "month" as const, trailingPeriods: 3 },
  query: { cube: TEST_CUBE, metrics: ["revenue"], densify: true },
};

describe("dashboard / composition", () => {
  it("rejects a code that is not kebab-case", async () => {
    const h = harness();
    await assert.rejects(
      h.module.services.dashboards.createDashboard(h.ctx, { code: "Sales Overview", title: "x" }),
      /kebab-case/,
    );
  });

  it("refuses a duplicate code", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.dashboards.createDashboard(h.ctx, { code: CODE, title: "Again" }),
      /already exists/,
    );
  });

  it("requires the payload each tile type needs", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.dashboards.addTile(h.ctx, CODE, { type: "kpi", title: "No code" }),
      /requires a kpiCode/,
    );
    await assert.rejects(
      h.module.services.dashboards.addTile(h.ctx, CODE, { type: "table", title: "No query" }),
      /requires a query/,
    );
  });

  it("stacks tiles down the page when no layout is given", async () => {
    const h = await seeded();
    const first = await h.module.services.dashboards.addTile(h.ctx, CODE, { ...chartTile, layout: undefined });
    const second = await h.module.services.dashboards.addTile(h.ctx, CODE, { ...chartTile, layout: undefined });

    assert.equal(first.layout.row, 0);
    assert.equal(second.layout.row, first.layout.row + first.layout.height);
  });

  it("refuses a tile that runs off the grid", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.dashboards.addTile(h.ctx, CODE, {
        ...chartTile,
        layout: { row: 0, col: 8, width: 6, height: 1 },
      }),
      new RegExp(`beyond the ${GRID_COLUMNS}-column grid`),
    );
  });

  it("refuses a tile that would sit on top of another", async () => {
    const h = await seeded();
    await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);
    await assert.rejects(
      h.module.services.dashboards.addTile(h.ctx, CODE, {
        ...chartTile,
        title: "Overlapping",
        layout: { row: 1, col: 4, width: 4, height: 2 },
      }),
      /overlaps/,
    );
  });

  it("allows a tile to be moved into the space it just vacated", async () => {
    const h = await seeded();
    const tile = await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);
    const moved = await h.module.services.dashboards.updateTile(h.ctx, CODE, tile.id, {
      layout: { col: 4, width: 8 },
      title: "Renamed",
    });

    assert.equal(moved.layout.col, 4);
    assert.equal(moved.title, "Renamed");
  });

  it("removes a tile and frees its space", async () => {
    const h = await seeded();
    const tile = await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);
    await h.module.services.dashboards.removeTile(h.ctx, CODE, tile.id);
    const dashboard = await h.module.services.dashboards.getDashboard(h.ctx, CODE);
    assert.equal(dashboard.tiles.length, 0);

    await assert.rejects(
      h.module.services.dashboards.removeTile(h.ctx, CODE, tile.id),
      /is not on dashboard/,
    );
  });

  it("will not publish an empty dashboard", async () => {
    const h = await seeded();
    await assert.rejects(h.module.services.dashboards.publishDashboard(h.ctx, CODE), /no tiles/);
  });

  it("announces creation, publication and archival", async () => {
    const h = await seeded();
    await h.module.outbox.drain();
    await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);
    await h.module.services.dashboards.publishDashboard(h.ctx, CODE);
    await h.module.services.dashboards.archiveDashboard(h.ctx, CODE, "superseded");

    assert.deepEqual(await publishedTypes(h), [
      ReportingEventTypes.DashboardPublished,
      ReportingEventTypes.DashboardArchived,
    ]);
  });

  it("freezes an archived dashboard", async () => {
    const h = await seeded();
    await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);
    await h.module.services.dashboards.archiveDashboard(h.ctx, CODE, "superseded");
    await assert.rejects(h.module.services.dashboards.addTile(h.ctx, CODE, chartTile), /is archived/);
  });

  it("hides a dashboard from roles outside its audience", async () => {
    const h = await seeded();
    await h.module.services.dashboards.createDashboard(h.ctx, {
      code: "finance-only",
      title: "Finance only",
      audienceRoles: ["cfo"],
    });

    const visible = await h.module.services.dashboards.listDashboards(h.ctx);
    assert.deepEqual(visible.map((d) => d.code), [CODE]);
    await assert.rejects(h.module.services.dashboards.render(h.ctx, "finance-only"), /requires one of/);
  });
});

describe("dashboard / rendering", () => {
  it("resolves the relative window against the render clock", async () => {
    const h = await seeded();
    await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);
    const rendered = await h.module.services.dashboards.render(h.ctx, CODE);

    const [tile] = rendered.tiles;
    assert.equal(tile.kind, "result");
    // Anchored at 2026-08-12, trailing 3 months, densified.
    assert.deepEqual(
      tile.result?.rows.map((row) => [row.keys[PERIOD_KEY], row.metrics.revenue]),
      [
        ["2026-06", 300],
        ["2026-07", 900],
        ["2026-08", 200],
      ],
    );
  });

  it("renders the same tile differently as the clock moves", async () => {
    const h = await seeded();
    await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);

    const june = await h.module.services.dashboards.render(h.ctx, CODE, "2026-06-15T00:00:00.000Z" as never);
    assert.deepEqual(
      june.tiles[0].result?.rows.map((row) => row.keys[PERIOD_KEY]),
      ["2026-04", "2026-05", "2026-06"],
    );
  });

  it("uses the grain as a window length only when the tile does not group by period", async () => {
    const h = await seeded();
    await h.module.services.dashboards.addTile(h.ctx, CODE, {
      type: "table",
      title: "By channel",
      layout: { row: 0, col: 0, width: 12, height: 2 },
      window: { grain: "month", trailingPeriods: 3, groupByPeriod: false },
      query: { cube: TEST_CUBE, metrics: ["revenue"], dimensions: ["channel"] },
    });

    const rendered = await h.module.services.dashboards.render(h.ctx, CODE);
    const result = rendered.tiles[0].result;
    assert.equal(result?.grain, undefined);
    assert.deepEqual(
      result?.rows.map((row) => [row.keys.channel, row.metrics.revenue]),
      [
        ["web", 1200],
        ["retail", 200],
      ],
    );
  });

  it("renders a KPI tile from a snapshot", async () => {
    const h = await seeded();
    await h.module.services.kpis.defineKpi(h.ctx, {
      code: "monthly_revenue",
      name: "Monthly revenue",
      cube: TEST_CUBE,
      metricCode: "revenue",
      unit: "currency",
      grain: "month",
      target: 100,
    });
    await h.module.services.dashboards.addTile(h.ctx, CODE, {
      type: "kpi",
      title: "Revenue",
      kpiCode: "monthly_revenue",
      layout: { row: 0, col: 0, width: 3, height: 1 },
      window: { grain: "month", trailingPeriods: 6 },
    });

    const rendered = await h.module.services.dashboards.render(h.ctx, CODE);
    assert.equal(rendered.tiles[0].kind, "kpi");
    assert.equal(rendered.tiles[0].snapshot?.value, 200);
    assert.equal(rendered.tiles[0].snapshot?.status, "on-track");
  });

  it("isolates a broken tile instead of failing the page", async () => {
    const h = await seeded();
    await h.module.services.dashboards.addTile(h.ctx, CODE, chartTile);
    await h.module.services.dashboards.addTile(h.ctx, CODE, {
      type: "table",
      title: "Broken",
      layout: { row: 3, col: 0, width: 6, height: 2 },
      query: { cube: TEST_CUBE, metrics: ["no_such_metric"] },
    });

    const rendered = await h.module.services.dashboards.render(h.ctx, CODE);
    assert.equal(rendered.errorCount, 1);
    assert.equal(rendered.tiles[0].kind, "result");
    assert.equal(rendered.tiles[1].kind, "error");
    assert.match(rendered.tiles[1].error?.message ?? "", /no_such_metric/);
  });

  it("reports the refresh interval the client should poll at", async () => {
    const h = await seeded();
    await h.module.services.dashboards.createDashboard(h.ctx, {
      code: "fast-refresh",
      title: "Fast",
      refreshIntervalSeconds: 30,
    });
    await h.module.services.dashboards.addTile(h.ctx, "fast-refresh", chartTile);
    const rendered = await h.module.services.dashboards.render(h.ctx, "fast-refresh");
    assert.equal(rendered.refreshIntervalSeconds, 30);
    assert.equal(rendered.renderedAt, h.clock.now());
  });

  it("rejects a nonsensical refresh interval at creation", async () => {
    const h = harness();
    await assert.rejects(
      h.module.services.dashboards.createDashboard(h.ctx, {
        code: "too-fast",
        title: "Too fast",
        refreshIntervalSeconds: 1,
      }),
      /refreshIntervalSeconds/,
    );
  });
});
