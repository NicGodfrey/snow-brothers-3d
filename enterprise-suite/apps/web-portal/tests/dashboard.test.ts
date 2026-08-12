import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatKpi, formatMoney, deltaSentiment, type Kpi } from "../src/domain/kpi.js";
import { money } from "@enterprise-suite/shared-kernel";
import { createHarness, USERS } from "./helpers.js";

const harness = createHarness();

describe("dashboard", () => {
  it("builds one tile per visible module with the descriptor's KPIs", async () => {
    const session = harness.session(USERS.admin, "acme");
    const dashboard = await harness.container.forSession(session).dashboard.load(session);

    assert.deepEqual(
      dashboard.tiles.map((t) => t.module),
      ["sales", "marketing", "inventory", "srm", "prm", "finance"],
    );
    const sales = dashboard.tiles[0]!;
    assert.equal(sales.status, "ok");
    assert.equal(sales.mark, "SL", "the tile reuses the rail's module mark");
    assert.deepEqual(
      sales.kpis.map((k) => k.key),
      ["openOrderValue", "openQuotes", "quoteWinRate", "avgCycleDays"],
    );
    assert.deepEqual(sales.kpis[0]!.value, { kind: "money", value: money(4_546_000, "USD") });
    assert.equal(dashboard.degradedModules.length, 0);
  });

  it("omits modules the tenant is not entitled to", async () => {
    const session = harness.session(USERS.admin, "globex");
    const dashboard = await harness.container.forSession(session).dashboard.load(session);
    assert.ok(!dashboard.tiles.some((t) => t.module === "prm"));
    // Globex reports in EUR, straight from the tenant's dataset.
    const sales = dashboard.tiles.find((t) => t.module === "sales");
    const value = sales?.kpis.find((k) => k.key === "openOrderValue")?.value;
    assert.equal(value?.kind === "money" && value.value.currency, "EUR");
  });

  it("isolates a failing module instead of blanking the page", async () => {
    const session = harness.session(USERS.admin, "acme");
    harness.transport.failModule("srm", { status: 503, code: "UNAVAILABLE", message: "maintenance" });
    try {
      const dashboard = await harness.container.forSession(session).dashboard.load(session);
      const srm = dashboard.tiles.find((t) => t.module === "srm");
      assert.equal(srm?.status, "degraded");
      assert.match(srm?.message ?? "", /srm-core returned 503/);
      assert.deepEqual(dashboard.degradedModules, ["srm"]);
      assert.equal(dashboard.tiles.filter((t) => t.status === "ok").length, 5);
    } finally {
      harness.transport.clearFailures();
    }
  });

  it("labels a 403 as no-access rather than an outage", async () => {
    const session = harness.session(USERS.admin, "acme");
    harness.transport.failModule("finance", { status: 403, code: "FORBIDDEN", message: "nope" });
    try {
      const dashboard = await harness.container.forSession(session).dashboard.load(session);
      const finance = dashboard.tiles.find((t) => t.module === "finance");
      assert.equal(finance?.status, "forbidden");
      assert.match(finance?.message ?? "", /do not have access/);
    } finally {
      harness.transport.clearFailures();
    }
  });

  it("collects count metrics for the nav rail", async () => {
    const session = harness.session(USERS.admin, "acme");
    const dashboard = await harness.container.forSession(session).dashboard.load(session);
    assert.equal(dashboard.counts.pendingApprovals, 2);
    assert.equal(dashboard.counts.belowReorder, 3);
    assert.equal(dashboard.counts.openMdf, 1);
  });
});

describe("KPI formatting", () => {
  it("formats each value kind", () => {
    assert.equal(formatKpi({ kind: "count", value: 1234 }), "1,234");
    assert.equal(formatKpi({ kind: "percent", value: 0.9471 }), "94.7%");
    assert.equal(formatKpi({ kind: "days", value: 6.42 }), "6.4 d");
    assert.equal(formatKpi({ kind: "money", value: money(4_546_000, "USD") }), "$45,460.00");
  });

  it("respects zero-decimal currencies", () => {
    assert.equal(formatMoney(money(1200, "JPY"), "en-US"), "¥1,200");
  });

  it("reads a delta against the KPI's polarity", () => {
    const base: Kpi = {
      key: "k",
      label: "K",
      value: { kind: "count", value: 1 },
      polarity: "down-good",
    };
    assert.equal(deltaSentiment({ ...base, delta: 0.2 }), "negative");
    assert.equal(deltaSentiment({ ...base, delta: -0.2 }), "positive");
    assert.equal(deltaSentiment({ ...base, polarity: "up-good", delta: 0.2 }), "positive");
    assert.equal(deltaSentiment({ ...base, polarity: "neutral", delta: 0.2 }), "neutral");
    assert.equal(deltaSentiment(base), "neutral");
  });
});
