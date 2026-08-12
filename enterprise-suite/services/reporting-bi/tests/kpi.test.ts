/**
 * KPI definitions, snapshots and alerting.
 *
 * The interesting behaviour is at the edges: direction normalisation (a
 * defect rate beating target must score the same 1.25 as revenue beating
 * target), the dead band that stops noise reading as a trend, and the fact
 * that alerts fire on a status *transition* rather than on every recompute.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReportingEventTypes } from "../src/domain/events.js";
import { attainmentOf, statusFor, trendOf, DEFAULT_THRESHOLDS } from "../src/domain/kpi.js";
import { appendFacts, harness, publishedTypes, smallCube, TEST_CUBE, type Harness } from "./helpers.js";

/** Revenue by month: June 400, July 900, August 1200 (partial month). */
async function seeded(): Promise<Harness> {
  const h = harness();
  await smallCube(h);
  await appendFacts(h, [
    { at: "2026-06-05T10:00:00Z", orders: 2, revenue: 300 },
    { at: "2026-06-20T10:00:00Z", orders: 1, revenue: 100 },
    { at: "2026-07-11T10:00:00Z", orders: 3, revenue: 900 },
    { at: "2026-08-02T10:00:00Z", orders: 1, revenue: 200 },
    { at: "2026-08-09T10:00:00Z", orders: 4, revenue: 1000 },
  ]);
  return h;
}

async function withKpi(h: Harness, overrides: Partial<Parameters<typeof define>[1]> = {}) {
  return define(h, {
    code: "monthly_revenue",
    name: "Monthly revenue",
    cube: TEST_CUBE,
    metricCode: "revenue",
    unit: "currency" as const,
    grain: "month" as const,
    target: 1000,
    ...overrides,
  });
}

function define(h: Harness, input: Parameters<Harness["module"]["services"]["kpis"]["defineKpi"]>[1]) {
  return h.module.services.kpis.defineKpi(h.ctx, input);
}

describe("kpi / attainment arithmetic", () => {
  it("normalises direction so 1.0 always means on target", () => {
    assert.equal(attainmentOf(120, 100, "higher-is-better"), 1.2);
    assert.equal(attainmentOf(80, 100, "lower-is-better"), 1.25);
    assert.equal(attainmentOf(125, 100, "lower-is-better"), 0.8);
  });

  it("treats zero as perfect for a lower-is-better KPI", () => {
    assert.equal(attainmentOf(0, 5, "lower-is-better"), 2);
    assert.equal(attainmentOf(0, 0, "lower-is-better"), 1);
  });

  it("has no attainment without a target or a value", () => {
    assert.equal(attainmentOf(10, null, "higher-is-better"), null);
    assert.equal(attainmentOf(null, 10, "higher-is-better"), null);
  });

  it("maps attainment onto the status bands", () => {
    const t = DEFAULT_THRESHOLDS;
    assert.equal(statusFor(1, 1.4, t), "on-track");
    assert.equal(statusFor(1, 0.96, t), "watch");
    assert.equal(statusFor(1, 0.9, t), "at-risk");
    assert.equal(statusFor(1, 0.5, t), "off-track");
    assert.equal(statusFor(1, null, t), "no-target");
    assert.equal(statusFor(null, null, t), "no-data");
  });

  it("ignores movement inside the dead band", () => {
    assert.equal(trendOf(100.2, 100, "higher-is-better"), "flat");
    assert.equal(trendOf(110, 100, "higher-is-better"), "improving");
    assert.equal(trendOf(110, 100, "lower-is-better"), "worsening");
    assert.equal(trendOf(90, 100, "lower-is-better"), "improving");
    assert.equal(trendOf(90, 100, "neutral"), "flat");
    assert.equal(trendOf(10, null, "higher-is-better"), "unknown");
  });
});

describe("kpi / definition", () => {
  it("rejects thresholds that are not ordered", async () => {
    const h = await seeded();
    await assert.rejects(
      withKpi(h, { thresholds: { warning: 0.8, critical: 0.9 } }),
      /must be below the warning threshold/,
    );
  });

  it("rejects a sparkline window outside the supported range", async () => {
    const h = await seeded();
    await assert.rejects(withKpi(h, { sparklinePeriods: 1 }), /sparklinePeriods/);
    await assert.rejects(withKpi(h, { sparklinePeriods: 500 }), /sparklinePeriods/);
  });

  it("refuses a duplicate code", async () => {
    const h = await seeded();
    await withKpi(h);
    await assert.rejects(withKpi(h), /already exists/);
  });

  it("retargets and refilters an existing KPI", async () => {
    const h = await seeded();
    await withKpi(h);
    const retargeted = await h.module.services.kpis.retarget(h.ctx, "monthly_revenue", 2000, {
      warning: 0.9,
      critical: 0.7,
    });
    assert.equal(retargeted.target, 2000);
    assert.deepEqual(retargeted.thresholds, { warning: 0.9, critical: 0.7 });

    const filtered = await h.module.services.kpis.refilter(h.ctx, "monthly_revenue", [
      { dimension: "channel", op: "eq", value: "web" },
    ]);
    assert.equal(filtered.filters.length, 1);
  });

  it("locks a retired KPI against further edits", async () => {
    const h = await seeded();
    await withKpi(h);
    await h.module.services.kpis.retire(h.ctx, "monthly_revenue");
    await assert.rejects(h.module.services.kpis.retarget(h.ctx, "monthly_revenue", 1), /retired/);
    await assert.rejects(h.module.services.kpis.retire(h.ctx, "monthly_revenue"), /already retired/);
  });
});

describe("kpi / snapshots", () => {
  it("reads the current period off a dense trailing series", async () => {
    const h = await seeded();
    await withKpi(h);
    const snapshot = await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");

    assert.equal(snapshot.period, "2026-08");
    assert.equal(snapshot.periodLabel, "Aug 2026");
    assert.equal(snapshot.value, 1200);
    assert.equal(snapshot.previousValue, 900);
    assert.equal(snapshot.targetValue, 1000);
    assert.equal(snapshot.attainment, 1.2);
    assert.equal(snapshot.variance, 200);
    assert.equal(snapshot.variancePct, 20);
    assert.equal(snapshot.changeVsPrevious, 300);
    assert.equal(snapshot.status, "on-track");
    assert.equal(snapshot.trend, "improving");
  });

  it("carries the whole trailing window as a sparkline, gaps included", async () => {
    const h = await seeded();
    await withKpi(h, { sparklinePeriods: 4 });
    const snapshot = await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");

    assert.deepEqual(snapshot.sparkline, [
      { period: "2026-05", value: null },
      { period: "2026-06", value: 400 },
      { period: "2026-07", value: 900 },
      { period: "2026-08", value: 1200 },
    ]);
  });

  it("reports no-data rather than zero when the period is empty", async () => {
    const h = await seeded();
    await withKpi(h, { code: "empty_kpi", metricCode: "revenue" });
    const snapshot = await h.module.services.kpis.computeSnapshot(
      h.ctx,
      "empty_kpi",
      h.clock.now(),
    );
    assert.equal(snapshot.status, "on-track");

    // A window with no facts at all: the value is unknown, not zero.
    await withKpi(h, { code: "future_kpi" });
    const future = await h.module.services.kpis.computeSnapshot(
      h.ctx,
      "future_kpi",
      "2027-03-15T00:00:00.000Z" as never,
    );
    assert.equal(future.value, null);
    assert.equal(future.status, "no-data");
    assert.equal(future.trend, "unknown");
  });

  it("respects the KPI's own filter", async () => {
    const h = harness();
    await smallCube(h);
    await appendFacts(h, [
      { at: "2026-08-05T00:00:00Z", channel: "web", revenue: 800 },
      { at: "2026-08-06T00:00:00Z", channel: "retail", revenue: 500 },
    ]);
    await withKpi(h, { filters: [{ dimension: "channel", op: "eq", value: "web" }] });

    const snapshot = await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");
    assert.equal(snapshot.value, 800);
  });

  it("scores a lower-is-better KPI by inverting the ratio", async () => {
    const h = await seeded();
    await withKpi(h, { direction: "lower-is-better", target: 600 });
    const snapshot = await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");

    assert.equal(snapshot.value, 1200);
    assert.equal(snapshot.attainment, 0.5);
    assert.equal(snapshot.status, "off-track");
    // Rising revenue is a bad thing for a lower-is-better KPI.
    assert.equal(snapshot.trend, "worsening");
  });

  it("says no-target when nobody set one", async () => {
    const h = await seeded();
    await withKpi(h, { target: undefined });
    const snapshot = await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");
    assert.equal(snapshot.attainment, null);
    assert.equal(snapshot.status, "no-target");
  });

  it("keeps one snapshot per period, in chronological order", async () => {
    const h = await seeded();
    await withKpi(h);
    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue", "2026-07-15T00:00:00.000Z" as never);
    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");
    // Recomputing a period already stored overwrites it rather than appending.
    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");

    const history = await h.module.services.kpis.history(h.ctx, "monthly_revenue");
    assert.deepEqual(history.map((s) => s.period), ["2026-07", "2026-08"]);
  });

  it("computes every active KPI in one pass and skips retired ones", async () => {
    const h = await seeded();
    await withKpi(h);
    await withKpi(h, { code: "monthly_orders", metricCode: "orders", unit: "count", target: 10 });
    await withKpi(h, { code: "retired_kpi" });
    await h.module.services.kpis.retire(h.ctx, "retired_kpi");

    const snapshots = await h.module.services.kpis.computeAll(h.ctx);
    assert.deepEqual(snapshots.map((s) => s.kpiCode).sort(), ["monthly_orders", "monthly_revenue"]);
  });

  it("fails loudly for an unknown KPI code", async () => {
    const h = await seeded();
    await assert.rejects(h.module.services.kpis.computeSnapshot(h.ctx, "nope"), /not found/i);
  });
});

describe("kpi / alerting", () => {
  it("announces every snapshot", async () => {
    const h = await seeded();
    await withKpi(h);
    await h.module.outbox.drain();
    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");

    assert.deepEqual(await publishedTypes(h), [ReportingEventTypes.KpiSnapshotComputed]);
  });

  it("raises a breach on the transition into an alerting state, once", async () => {
    const h = await seeded();
    await withKpi(h, { target: 5000 }); // 1200 against 5000 is off-track
    await h.module.outbox.drain();

    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");
    assert.deepEqual(await publishedTypes(h), [
      ReportingEventTypes.KpiSnapshotComputed,
      ReportingEventTypes.KpiThresholdBreached,
    ]);

    await h.module.outbox.drain();
    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");
    assert.deepEqual(await publishedTypes(h), [ReportingEventTypes.KpiSnapshotComputed]);
  });

  it("announces recovery when the KPI climbs back out", async () => {
    const h = await seeded();
    await withKpi(h, { target: 5000 });
    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");
    await h.module.services.kpis.retarget(h.ctx, "monthly_revenue", 1000);
    await h.module.outbox.drain();

    await h.module.services.kpis.computeSnapshot(h.ctx, "monthly_revenue");
    assert.deepEqual(await publishedTypes(h), [
      ReportingEventTypes.KpiSnapshotComputed,
      ReportingEventTypes.KpiRecovered,
    ]);
  });
});

describe("kpi / scorecard", () => {
  it("orders worst first, then by attainment", async () => {
    const h = await seeded();
    await withKpi(h, { code: "healthy", target: 100 });
    await withKpi(h, { code: "failing", target: 10_000 });
    await withKpi(h, { code: "wobbling", target: 1300 }); // 1200/1300 = 0.92
    await withKpi(h, { code: "grazing", target: 1240 }); // 1200/1240 = 0.97

    const scorecard = await h.module.services.kpis.scorecard(h.ctx);
    assert.deepEqual(
      scorecard.map((entry) => [entry.snapshot.kpiCode, entry.snapshot.status]),
      [
        ["failing", "off-track"],
        ["wobbling", "at-risk"],
        ["grazing", "watch"],
        ["healthy", "on-track"],
      ],
    );
  });

  it("computes a missing snapshot on demand", async () => {
    const h = await seeded();
    await withKpi(h);
    const [entry] = await h.module.services.kpis.scorecard(h.ctx, ["monthly_revenue"]);
    assert.equal(entry.snapshot.value, 1200);
  });
});
