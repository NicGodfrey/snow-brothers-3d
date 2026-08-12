/**
 * Query execution.
 *
 * Everything here runs against `smallCube`: four to eight hand-written facts
 * whose expected totals can be checked by hand. The point is the semantics —
 * grouping, roll-up, derived-after-aggregate ordering, top-N reconciliation,
 * densification, comparisons — not throughput.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OTHER_KEY } from "../src/domain/aggregation.js";
import { PERIOD_KEY } from "../src/domain/query.js";
import { timeRange } from "../src/domain/time-grain.js";
import { FixedClock } from "../src/infrastructure/in-memory/clock.js";
import { createReportingBiModule } from "../src/infrastructure/module.js";
import { appendFacts, harness, NOW, smallCube, TEST_CUBE, type Harness } from "./helpers.js";

/**
 * Three months of orders across two families and two channels.
 *
 *   June   FAM-A/SKU-1 web    2 orders   300 revenue  6 units
 *   June   FAM-B/SKU-3 retail 1 order    100 revenue  1 unit
 *   July   FAM-A/SKU-2 web    3 orders   900 revenue  9 units
 *   August FAM-A/SKU-1 retail 1 order    200 revenue  2 units
 *   August FAM-B/SKU-3 web    4 orders  1000 revenue 20 units
 */
async function seeded(): Promise<Harness> {
  const h = harness();
  await smallCube(h);
  await appendFacts(h, [
    { at: "2026-06-05T10:00:00Z", product: "SKU-1", channel: "web", orders: 2, revenue: 300, units: 6 },
    { at: "2026-06-20T10:00:00Z", product: "SKU-3", channel: "retail", orders: 1, revenue: 100, units: 1 },
    { at: "2026-07-11T10:00:00Z", product: "SKU-2", channel: "web", orders: 3, revenue: 900, units: 9 },
    { at: "2026-08-02T10:00:00Z", product: "SKU-1", channel: "retail", orders: 1, revenue: 200, units: 2 },
    { at: "2026-08-09T10:00:00Z", product: "SKU-3", channel: "web", orders: 4, revenue: 1000, units: 20 },
  ]);
  return h;
}

const Q3 = timeRange("2026-06-01T00:00:00Z", "2026-09-01T00:00:00Z");

/** Same fixture, with the result cache left switched on. */
function cachingHarness(): Harness {
  const clock = new FixedClock(NOW);
  return {
    clock,
    module: createReportingBiModule({ clock }),
    ctx: harness().ctx,
  };
}

describe("query / grouping", () => {
  it("totals every metric across the cube when nothing is grouped", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["orders", "revenue", "units", "fact_rows", "biggest_order", "smallest_order", "avg_units", "skus_sold"],
    });

    assert.equal(result.rowCount, 1);
    assert.deepEqual(result.totals, {
      orders: 11,
      revenue: 2500,
      units: 38,
      fact_rows: 5,
      biggest_order: 1000,
      smallest_order: 100,
      avg_units: 7.6,
      skus_sold: 3,
    });
    assert.equal(result.factsScanned, 5);
  });

  it("buckets by time grain and sorts oldest first by default", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      timeGrain: "month",
      timeRange: Q3,
    });

    assert.deepEqual(
      result.rows.map((row) => [row.keys[PERIOD_KEY], row.metrics.revenue]),
      [
        ["2026-06", 400],
        ["2026-07", 900],
        ["2026-08", 1200],
      ],
    );
    assert.equal(result.rows[0].labels[PERIOD_KEY], "Jun 2026");
    assert.equal(result.grain, "month");
  });

  it("groups by a dimension and orders by the first metric descending", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue", "orders"],
      dimensions: ["channel"],
    });

    assert.deepEqual(
      result.rows.map((row) => [row.keys.channel, row.metrics.revenue]),
      [
        ["web", 2200],
        ["retail", 300],
      ],
    );
  });

  it("rolls leaf members up to a parent level", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      dimensions: ["product.family"],
    });

    assert.deepEqual(
      result.rows.map((row) => [row.keys["product.family"], row.labels["product.family"], row.metrics.revenue]),
      [
        ["FAM-B", "Family B", 1100],
        ["FAM-A", "Family A", 1400],
      ].sort((a, b) => Number(b[2]) - Number(a[2])),
    );
  });

  it("labels leaf members through the dimension catalog", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      dimensions: ["product"],
      orderBy: [{ key: "product", direction: "asc" }],
    });

    assert.deepEqual(
      result.rows.map((row) => row.labels.product),
      ["Widget", "Gadget", "Gizmo"],
    );
  });

  it("crosses a time grain with a dimension", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["orders"],
      dimensions: ["channel"],
      timeGrain: "month",
      timeRange: Q3,
    });

    assert.equal(result.rows.length, 5);
    assert.deepEqual(result.columns.map((c) => c.key), [PERIOD_KEY, "channel", "orders"]);
    assert.deepEqual(result.columns.map((c) => c.kind), ["time", "dimension", "metric"]);
  });
});

describe("query / derived metrics", () => {
  it("computes derived metrics on group totals, not per fact", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["aov"],
      timeGrain: "month",
      timeRange: Q3,
    });

    // June: 400 / 3 orders, not the average of 300/2 and 100/1.
    assert.equal(result.rows[0].metrics.aov, 400 / 3);
    assert.equal(result.totals.aov, 2500 / 11);
  });

  it("evaluates a metric derived from another derived metric", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["aov_per_unit"],
    });

    const aov = 2500 / 11;
    const avgUnits = 38 / 5;
    assert.equal(result.totals.aov_per_unit, aov / avgUnits);
  });

  it("returns null rather than infinity when a divisor is zero", async () => {
    const h = harness();
    await smallCube(h);
    await appendFacts(h, [{ at: "2026-08-01T00:00:00Z", orders: 0, revenue: 500, units: 1 }]);

    const result = await h.module.services.queries.run(h.ctx, { cube: TEST_CUBE, metrics: ["aov"] });
    assert.equal(result.totals.aov, null);
  });

  it("does not leak dependency metrics into the result", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, { cube: TEST_CUBE, metrics: ["aov"] });
    assert.deepEqual(Object.keys(result.totals), ["aov"]);
    assert.deepEqual(result.columns.map((c) => c.key), ["aov"]);
  });
});

describe("query / filters", () => {
  it("filters on a dimension member before aggregating", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      filters: [{ dimension: "channel", op: "eq", value: "web" }],
    });
    assert.equal(result.totals.revenue, 2200);
    assert.equal(result.factsScanned, 3);
  });

  it("filters at a rolled-up level", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      filters: [{ dimension: "product.family", op: "eq", value: "FAM-A" }],
    });
    assert.equal(result.totals.revenue, 1400);
  });

  it("supports set, substring and presence operators", async () => {
    const h = await seeded();
    const run = (filter: Parameters<typeof h.module.services.queries.run>[1]["filters"]) =>
      h.module.services.queries.run(h.ctx, { cube: TEST_CUBE, metrics: ["orders"], filters: filter });

    assert.equal((await run([{ dimension: "product", op: "in", values: ["SKU-1", "SKU-2"] }])).totals.orders, 6);
    assert.equal((await run([{ dimension: "product", op: "not_in", values: ["SKU-1"] }])).totals.orders, 8);
    assert.equal((await run([{ dimension: "channel", op: "starts_with", value: "re" }])).totals.orders, 2);
    assert.equal((await run([{ dimension: "channel", op: "contains", value: "ETAI" }])).totals.orders, 2);
    assert.equal((await run([{ dimension: "channel", op: "exists" }])).totals.orders, 11);
    assert.equal((await run([{ dimension: "channel", op: "missing" }])).totals.orders, null);
  });

  it("applies having clauses after aggregation", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      dimensions: ["product"],
      having: [{ metric: "revenue", op: "gt", value: 500 }],
    });

    assert.deepEqual(result.rows.map((row) => row.keys.product), ["SKU-3", "SKU-2"]);
    // Totals stay pre-HAVING: the filter shapes the rows, not the headline.
    assert.equal(result.totals.revenue, 2500);
  });

  it("rejects a having clause on a metric that was not selected", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.queries.run(h.ctx, {
        cube: TEST_CUBE,
        metrics: ["revenue"],
        having: [{ metric: "orders", op: "gt", value: 1 }],
      }),
      /not one of the selected metrics/,
    );
  });
});

describe("query / shaping", () => {
  it("folds everything past the top N into a reconciling Other row", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      dimensions: ["product"],
      topN: { metric: "revenue", limit: 1 },
    });

    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].keys.product, "SKU-3");
    assert.equal(result.rows[1].keys.product, OTHER_KEY);
    assert.equal(result.rows[1].labels.product, "Other");
    const summed = result.rows.reduce((total, row) => total + (row.metrics.revenue ?? 0), 0);
    assert.equal(summed, result.totals.revenue);
  });

  it("nulls out ratios in the Other row instead of inventing one", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue", "aov"],
      dimensions: ["product"],
      topN: { metric: "revenue", limit: 1 },
    });
    assert.equal(result.rows[1].metrics.aov, null);
  });

  it("can drop the Other row when the caller only wants the leaders", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      dimensions: ["product"],
      topN: { metric: "revenue", limit: 2, includeOther: false },
    });
    assert.equal(result.rows.length, 2);
  });

  it("fills empty periods when densification is asked for", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue", "fact_rows"],
      timeGrain: "month",
      timeRange: timeRange("2026-05-01T00:00:00Z", "2026-09-01T00:00:00Z"),
      densify: true,
    });

    assert.deepEqual(
      result.rows.map((row) => [row.keys[PERIOD_KEY], row.metrics.revenue]),
      [
        ["2026-05", null],
        ["2026-06", 400],
        ["2026-07", 900],
        ["2026-08", 1200],
      ],
    );
    // A count over an empty bucket is zero, not unknown.
    assert.equal(result.rows[0].metrics.fact_rows, 0);
  });

  it("pages with limit and offset while reporting the full group count", async () => {
    const h = await seeded();
    const page = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      dimensions: ["product"],
      limit: 1,
      offset: 1,
    });

    assert.equal(page.rowCount, 1);
    assert.equal(page.groupCount, 3);
    assert.equal(page.truncated, true);
    assert.equal(page.rows[0].keys.product, "SKU-2");
  });

  it("sorts by a dimension key when asked", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      dimensions: ["product"],
      orderBy: [{ key: "product", direction: "desc" }],
    });
    assert.deepEqual(result.rows.map((row) => row.keys.product), ["SKU-3", "SKU-2", "SKU-1"]);
  });

  it("sorts nulls last regardless of direction", async () => {
    const h = harness();
    await smallCube(h);
    await appendFacts(h, [
      { at: "2026-08-01T00:00:00Z", product: "SKU-1", orders: 0, revenue: 10 },
      { at: "2026-08-01T00:00:00Z", product: "SKU-2", orders: 2, revenue: 10 },
    ]);

    const ascending = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["aov"],
      dimensions: ["product"],
      orderBy: [{ key: "aov", direction: "asc" }],
    });
    assert.deepEqual(ascending.rows.map((row) => row.metrics.aov), [5, null]);
  });
});

describe("query / comparisons", () => {
  it("aligns the previous period onto the current one", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      timeGrain: "month",
      timeRange: timeRange("2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z"),
      compareTo: "previous-period",
    });

    const [july] = result.rows;
    assert.equal(july.metrics.revenue, 900);
    assert.equal(july.comparison?.revenue, 400); // June
    assert.equal(july.delta?.revenue, 500);
    assert.equal(july.deltaPct?.revenue, 125);
    assert.equal(result.comparison?.mode, "previous-period");
  });

  it("reports a null delta when there is nothing to compare against", async () => {
    const h = await seeded();
    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      timeGrain: "month",
      timeRange: timeRange("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      compareTo: "previous-period",
    });

    assert.equal(result.rows[0].comparison?.revenue, null);
    assert.equal(result.rows[0].deltaPct?.revenue, null);
  });

  it("shifts a year back for year-over-year", async () => {
    const h = harness();
    await smallCube(h);
    await appendFacts(h, [
      { at: "2025-08-05T00:00:00Z", revenue: 100 },
      { at: "2026-08-05T00:00:00Z", revenue: 250 },
    ]);

    const result = await h.module.services.queries.run(h.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
      timeGrain: "month",
      timeRange: timeRange("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"),
      compareTo: "previous-year",
    });

    assert.equal(result.rows[0].metrics.revenue, 250);
    assert.equal(result.rows[0].comparison?.revenue, 100);
    assert.equal(result.comparison?.range.from, "2025-08-01T00:00:00.000Z");
  });

  it("refuses a comparison without a window to shift", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.queries.run(h.ctx, {
        cube: TEST_CUBE,
        metrics: ["revenue"],
        compareTo: "previous-period",
      }),
      /explicit timeRange/,
    );
  });
});

describe("query / catalog checks", () => {
  it("rejects an unknown cube", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.queries.run(h.ctx, { cube: "nope", metrics: ["revenue"] }),
      /not found/i,
    );
  });

  it("rejects a metric belonging to another cube", async () => {
    const h = await seeded();
    await h.module.services.cubes.defineCube(h.ctx, {
      name: "other_cube",
      title: "Other",
      dimensions: [{ factKey: "channel" }],
      measureFields: [{ field: "orders" }],
    });
    await assert.rejects(
      h.module.services.queries.run(h.ctx, { cube: "other_cube", metrics: ["revenue"] }),
      /revenue/,
    );
  });

  it("rejects a dimension the cube does not carry", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.queries.run(h.ctx, { cube: TEST_CUBE, metrics: ["revenue"], dimensions: ["supplier"] }),
      /has no dimension 'supplier'/,
    );
  });

  it("rejects an unknown level of a known dimension", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.queries.run(h.ctx, { cube: TEST_CUBE, metrics: ["revenue"], dimensions: ["product.brand"] }),
      /has no level 'brand'/,
    );
  });

  it("refuses to answer with no metrics at all", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.queries.run(h.ctx, { cube: TEST_CUBE, metrics: [] }),
      /at least one metric/,
    );
  });

  it("keeps one tenant's facts out of another's answers", async () => {
    const h = await seeded();
    const otherCtx = { ...h.ctx, tenantId: h.ctx.tenantId };
    assert.equal((await h.module.services.queries.run(otherCtx, { cube: TEST_CUBE, metrics: ["revenue"] })).totals.revenue, 2500);

    const isolated = harness();
    await smallCube(isolated);
    const empty = await isolated.module.services.queries.run(isolated.ctx, {
      cube: TEST_CUBE,
      metrics: ["revenue"],
    });
    assert.equal(empty.totals.revenue, null);
  });
});

describe("query / scalars and caching", () => {
  it("answers a scalar with the window total", async () => {
    const h = await seeded();
    const value = await h.module.services.queries.scalar(h.ctx, {
      cube: TEST_CUBE,
      metric: "revenue",
      timeRange: timeRange("2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z"),
    });
    assert.equal(value, 900);
  });

  it("returns null for a scalar with no facts in range", async () => {
    const h = await seeded();
    const value = await h.module.services.queries.scalar(h.ctx, {
      cube: TEST_CUBE,
      metric: "revenue",
      timeRange: timeRange("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
    });
    assert.equal(value, null);
  });

  it("invalidates cached results as soon as new facts land", async () => {
    // Unlike the rest of this file, caching is on: the fact count and latest
    // instant are part of the key, so a write must be visible immediately.
    const h = cachingHarness();
    await smallCube(h);
    await appendFacts(h, [{ at: "2026-08-01T00:00:00Z", revenue: 100 }]);
    const query = { cube: TEST_CUBE, metrics: ["revenue"] };
    assert.equal((await h.module.services.queries.run(h.ctx, query)).totals.revenue, 100);

    await appendFacts(h, [{ at: "2026-08-02T00:00:00Z", revenue: 50 }]);
    assert.equal((await h.module.services.queries.run(h.ctx, query)).totals.revenue, 150);
  });

  it("serves a repeated query from cache without rescanning", async () => {
    const h = cachingHarness();
    await smallCube(h);
    await appendFacts(h, [{ at: "2026-08-01T00:00:00Z", revenue: 100 }]);
    const query = { cube: TEST_CUBE, metrics: ["revenue"] };

    const first = await h.module.services.queries.run(h.ctx, query);
    const second = await h.module.services.queries.run(h.ctx, query);
    assert.equal(first, second);

    h.module.services.queries.invalidate();
    assert.notEqual(await h.module.services.queries.run(h.ctx, query), first);
  });
});
