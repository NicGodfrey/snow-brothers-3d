/**
 * The shipped catalog and the synthetic warehouse, end to end.
 *
 * These are the tests that would catch a mapping and a cube schema drifting
 * apart: the seed emits the real upstream event shapes, ingest projects them
 * through the real mappings, and the shipped cubes have to accept every one.
 * A single unmapped field shows up here as a dead letter.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReportingCubes, standardMappings } from "../src/application/mappings.js";
import { standardCatalog } from "../src/infrastructure/catalog.js";
import { installCatalog } from "../src/infrastructure/catalog.js";
import { demoEvents } from "../src/infrastructure/seed.js";
import { harness, warehouse } from "./helpers.js";

describe("catalog / installation", () => {
  it("installs dimensions, cubes, metrics, KPIs and dashboards", async () => {
    const h = harness();
    const summary = await installCatalog(h.ctx, h.module);
    const spec = standardCatalog();

    assert.deepEqual(summary, {
      dimensions: spec.dimensions.length,
      cubes: spec.cubes.length,
      metrics: spec.metrics.length,
      kpis: spec.kpis.length,
      dashboards: spec.dashboards.length,
    });
  });

  it("is idempotent, so it can run on every boot", async () => {
    const h = harness();
    await installCatalog(h.ctx, h.module);
    const second = await installCatalog(h.ctx, h.module);

    assert.deepEqual(second, { dimensions: 0, cubes: 0, metrics: 0, kpis: 0, dashboards: 0 });
  });

  it("leaves every metric published and every cube queryable", async () => {
    const h = harness();
    await installCatalog(h.ctx, h.module);

    const metrics = await h.module.repos.metrics.list(h.ctx.tenantId);
    assert.equal(metrics.filter((metric) => metric.status !== "published").length, 0);

    const cubes = await h.module.repos.cubes.list(h.ctx.tenantId);
    assert.equal(cubes.filter((cube) => cube.status !== "published").length, 0);
  });

  it("declares every dimension and measure its mappings emit", async () => {
    const h = harness();
    await installCatalog(h.ctx, h.module);
    const spec = standardCatalog();

    // Each mapping's cube must exist, and each metric's source field must be
    // a measure the cube declares — the two halves of the semantic layer.
    for (const mapping of standardMappings()) {
      if (!mapping.cube) continue;
      assert.ok(
        spec.cubes.some((cube) => cube.name === mapping.cube),
        `mapping '${mapping.eventType}' targets undeclared cube '${mapping.cube}'`,
      );
    }
    for (const metric of spec.metrics) {
      if (!metric.sourceField || metric.expression) continue;
      const cube = spec.cubes.find((c) => c.name === metric.cube)!;
      const known =
        cube.measureFields?.some((field) => field.field === metric.sourceField) ||
        cube.dimensions?.some((dimension) => dimension.factKey === metric.sourceField);
      assert.ok(known, `metric '${metric.code}' reads unknown field '${metric.sourceField}'`);
    }
  });

  it("points every KPI at a metric of its own cube", async () => {
    const spec = standardCatalog();
    for (const kpi of spec.kpis) {
      const metric = spec.metrics.find((m) => m.code === kpi.metricCode);
      assert.ok(metric, `KPI '${kpi.code}' references unknown metric '${kpi.metricCode}'`);
      assert.equal(metric.cube, kpi.cube, `KPI '${kpi.code}' crosses cubes`);
    }
  });
});

describe("seed / synthetic warehouse", () => {
  it("ingests the whole synthetic stream without a single dead letter", async () => {
    const h = await warehouse({ days: 45 });

    assert.equal(await h.module.repos.deadLetters.count(h.ctx.tenantId), 0);
    assert.ok((await h.module.repos.facts.count(h.ctx.tenantId)) > 500);
  });

  it("populates every shipped cube", async () => {
    const h = await warehouse({ days: 45 });

    for (const cube of Object.values(ReportingCubes)) {
      assert.ok(
        (await h.module.repos.facts.count(h.ctx.tenantId, cube)) > 0,
        `cube '${cube}' got no facts from the seed`,
      );
    }
  });

  it("never stamps a fact after the anchor", async () => {
    const h = await warehouse({ days: 45 });
    const facts = (
      await Promise.all(
        Object.values(ReportingCubes).map((cube) => h.module.repos.facts.scan(h.ctx.tenantId, { cube })),
      )
    ).flat();

    const future = facts.filter((fact) => fact.occurredAt > h.clock.now());
    assert.deepEqual(future.map((fact) => [fact.cube, fact.occurredAt]), []);
  });

  it("is deterministic: the same anchor produces the same stream", () => {
    const tenantId = harness().ctx.tenantId;
    const options = { days: 10, anchor: "2026-08-12T09:00:00.000Z" as never };
    const first = demoEvents(tenantId, options);
    const second = demoEvents(tenantId, options);

    assert.equal(first.length, second.length);
    assert.deepEqual(first.map((event) => event.eventId), second.map((event) => event.eventId));
  });

  it("computes a snapshot for every KPI, with a sparkline behind each", async () => {
    const h = await warehouse({ days: 90 });
    const scorecard = await h.module.services.kpis.scorecard(h.ctx);

    assert.equal(scorecard.length, standardCatalog().kpis.length);
    for (const { snapshot } of scorecard) {
      assert.notEqual(snapshot.status, "no-data", `${snapshot.kpiCode} produced no value`);
      assert.ok(snapshot.sparkline.length >= 2);
    }
  });

  it("renders both shipped dashboards without a broken tile", async () => {
    const h = await warehouse({ days: 90 });

    for (const spec of standardCatalog().dashboards) {
      const rendered = await h.module.services.dashboards.render(h.ctx, spec.dashboard.code);
      assert.equal(rendered.errorCount, 0, `${spec.dashboard.code}: ${JSON.stringify(rendered.tiles.filter((t) => t.kind === "error").map((t) => t.error))}`);
      assert.equal(rendered.tiles.length, spec.tiles.length);
    }
  });
});
