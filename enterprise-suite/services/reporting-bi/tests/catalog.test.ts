/**
 * The semantic layer: cubes, dimensions and metric definitions.
 *
 * Definition-time validation carries most of the weight in this context. A
 * metric pointed at a field its cube does not have returns null forever and
 * nobody notices until a board pack is wrong, so the tests below are mostly
 * about what the catalog *refuses* to accept.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError, NotFoundError } from "@enterprise-suite/shared-kernel";
import { DefinitionError } from "../src/domain/errors.js";
import { ReportingEventTypes } from "../src/domain/events.js";
import { harness, otherTenantCtx, smallCube, TEST_CUBE } from "./helpers.js";

describe("dimensions", () => {
  it("registers a hierarchy and rolls members up through it", async () => {
    const h = harness();
    await smallCube(h);
    const product = await h.module.services.dimensions.getDimension(h.ctx, "product");

    assert.deepEqual(product.levels.map((level) => level.key), ["family", "sku"]);
    assert.equal(product.leafLevel.key, "sku");
    assert.equal(product.rollUp("SKU-1", "family"), "FAM-A");
    assert.equal(product.rollUp("SKU-3", "family"), "FAM-B");
    // A leaf rolls up to itself; an unknown member rolls up to nothing.
    assert.equal(product.rollUp("SKU-1", "sku"), "SKU-1");
    assert.equal(product.rollUp("SKU-UNKNOWN", "family"), null);
    // Roll-down is not a thing: a family has no single SKU.
    assert.equal(product.rollUp("FAM-A", "sku"), null);
  });

  it("orders bulk loads parent-first, whatever order the caller sends", async () => {
    const h = harness();
    await h.module.services.dimensions.registerDimension(h.ctx, {
      key: "geo",
      label: "Geography",
      levels: [
        { key: "region", label: "Region" },
        { key: "country", label: "Country" },
        { key: "site", label: "Site" },
      ],
    });
    // Deliberately children-first.
    const { dimension } = await h.module.services.dimensions.loadMembers(h.ctx, "geo", [
      { key: "SITE-BER", label: "Berlin", levelKey: "site", parentKey: "DE" },
      { key: "DE", label: "Germany", levelKey: "country", parentKey: "EMEA" },
      { key: "EMEA", label: "EMEA", levelKey: "region" },
    ]);
    assert.equal(dimension.memberCount, 3);
    assert.equal(dimension.rollUp("SITE-BER", "region"), "EMEA");
    assert.deepEqual(dimension.ancestry("SITE-BER").map((m) => m.key), ["DE", "EMEA"]);
  });

  it("reports every unloadable member at once instead of one per attempt", async () => {
    const h = harness();
    await smallCube(h);
    await assert.rejects(
      () =>
        h.module.services.dimensions.loadMembers(h.ctx, "product", [
          { key: "SKU-9", label: "Orphan", levelKey: "sku", parentKey: "FAM-MISSING" },
          { key: "SKU-8", label: "Wrong level", levelKey: "nope" },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof DefinitionError);
        assert.match(error.message, /2 of 2 members/);
        const details = error.details as { failures: string[] };
        assert.equal(details.failures.length, 2);
        return true;
      },
    );
  });

  it("keeps dimensions inside their tenant", async () => {
    const h = harness();
    await smallCube(h);
    await assert.rejects(
      () => h.module.services.dimensions.getDimension(otherTenantCtx(), "product"),
      NotFoundError,
    );
  });

  it("rejects malformed keys and duplicate registration", async () => {
    const h = harness();
    await assert.rejects(
      () => h.module.services.dimensions.registerDimension(h.ctx, { key: "Product Line", label: "x" }),
      DefinitionError,
    );
    await h.module.services.dimensions.registerDimension(h.ctx, { key: "channel", label: "Channel" });
    await assert.rejects(
      () => h.module.services.dimensions.registerDimension(h.ctx, { key: "channel", label: "Again" }),
      ConflictError,
    );
  });
});

describe("cubes", () => {
  it("cannot be published without a measure field", async () => {
    const h = harness();
    await h.module.services.cubes.defineCube(h.ctx, { name: "empty_cube", title: "Empty" });
    await assert.rejects(() => h.module.services.cubes.publishCube(h.ctx, "empty_cube"), DefinitionError);
  });

  it("refuses changes once archived", async () => {
    const h = harness();
    await smallCube(h);
    await h.module.services.cubes.archiveCube(h.ctx, TEST_CUBE, "superseded by test_orders_v2");
    await assert.rejects(
      () => h.module.services.cubes.addMeasureField(h.ctx, TEST_CUBE, { field: "late" }),
      ConflictError,
    );
  });

  it("describes itself well enough to build a query against", async () => {
    const h = harness();
    await smallCube(h);
    const described = await h.module.services.cubes.describe(h.ctx, TEST_CUBE);

    assert.equal(described.status, "published");
    assert.deepEqual(
      described.dimensions.map((d) => d.key).sort(),
      ["channel", "product"],
    );
    const product = described.dimensions.find((d) => d.key === "product")!;
    // Every groupable reference, spelled the way a query must spell it.
    assert.deepEqual(product.levels.map((l) => l.ref), ["product.family", "product"]);
    assert.equal(product.memberCount, 5);
    assert.ok(described.metrics.some((metric) => metric.code === "aov" && metric.kind === "derived"));
    assert.equal(described.factCount, 0);
    assert.equal(described.latestFactAt, null);
  });
});

describe("metric definitions", () => {
  it("rejects a base metric pointed at a field the cube does not declare", async () => {
    const h = harness();
    await smallCube(h);
    await assert.rejects(
      () =>
        h.module.services.metrics.defineMetric(h.ctx, {
          code: "phantom",
          name: "Phantom",
          cube: TEST_CUBE,
          unit: "count",
          aggregation: "sum",
          sourceField: "does_not_exist",
        }),
      (error: unknown) => {
        assert.ok(error instanceof DefinitionError);
        const details = error.details as { availableMeasures: string[] };
        assert.ok(details.availableMeasures.includes("revenue_minor"));
        return true;
      },
    );
  });

  it("allows count_distinct over a dimension key", async () => {
    const h = harness();
    await smallCube(h);
    const metric = await h.module.services.metrics.getMetric(h.ctx, "skus_sold");
    assert.equal(metric.aggregation, "count_distinct");
    assert.equal(metric.sourceField, "product");
  });

  it("enforces the base/derived split", async () => {
    const h = harness();
    await smallCube(h);
    await assert.rejects(
      () =>
        h.module.services.metrics.defineMetric(h.ctx, {
          code: "hybrid",
          name: "Hybrid",
          cube: TEST_CUBE,
          unit: "count",
          aggregation: "sum",
          sourceField: "orders",
          expression: "orders * 2",
        }),
      DefinitionError,
    );
    // count() folds rows and must not name a field.
    await assert.rejects(
      () =>
        h.module.services.metrics.defineMetric(h.ctx, {
          code: "bad_count",
          name: "Bad count",
          cube: TEST_CUBE,
          unit: "count",
          aggregation: "count",
          sourceField: "orders",
        }),
      DefinitionError,
    );
  });

  it("rejects dependency cycles at definition time", async () => {
    const h = harness();
    await smallCube(h);
    await h.module.services.metrics.defineMetric(h.ctx, {
      code: "loop_a",
      name: "Loop A",
      cube: TEST_CUBE,
      unit: "count",
      expression: "orders + 1",
    });
    await assert.rejects(
      () =>
        h.module.services.metrics.updateMetric(h.ctx, "loop_a", { expression: "loop_a + 1" }),
      (error: unknown) => {
        assert.ok(error instanceof DefinitionError);
        assert.match(error.message, /cycle/);
        return true;
      },
    );
  });

  it("refuses to reference a metric on another cube", async () => {
    const h = harness();
    await smallCube(h);
    await h.module.services.cubes.defineCube(h.ctx, {
      name: "other_cube",
      title: "Other",
      measureFields: [{ field: "value" }],
    });
    await assert.rejects(
      () =>
        h.module.services.metrics.defineMetric(h.ctx, {
          code: "cross_cube",
          name: "Cross cube",
          cube: "other_cube",
          unit: "count",
          expression: "orders * 2",
        }),
      DefinitionError,
    );
  });

  it("will not publish a metric whose dependency is still a draft", async () => {
    const h = harness();
    await smallCube(h);
    await h.module.services.metrics.defineMetric(h.ctx, {
      code: "draft_base",
      name: "Draft base",
      cube: TEST_CUBE,
      unit: "count",
      aggregation: "sum",
      sourceField: "units",
    });
    await h.module.services.metrics.defineMetric(h.ctx, {
      code: "needs_draft",
      name: "Needs draft",
      cube: TEST_CUBE,
      unit: "count",
      expression: "draft_base * 2",
    });
    await assert.rejects(
      () => h.module.services.metrics.publishMetric(h.ctx, "needs_draft"),
      ConflictError,
    );
    await h.module.services.metrics.publishMetric(h.ctx, "draft_base");
    const published = await h.module.services.metrics.publishMetric(h.ctx, "needs_draft");
    assert.equal(published.status, "published");
  });

  it("blocks deprecation while something still reads the metric", async () => {
    const h = harness();
    await smallCube(h);
    await assert.rejects(
      () => h.module.services.metrics.deprecateMetric(h.ctx, "revenue", "replaced"),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        assert.match(error.message, /aov/);
        return true;
      },
    );
    // Deprecate the dependents first and the base becomes free.
    await h.module.services.metrics.deprecateMetric(h.ctx, "aov_per_unit", "replaced");
    await h.module.services.metrics.deprecateMetric(h.ctx, "aov", "replaced");
    const deprecated = await h.module.services.metrics.deprecateMetric(h.ctx, "revenue", "replaced");
    assert.equal(deprecated.status, "deprecated");
    // And a deprecated metric is frozen.
    await assert.rejects(
      () => h.module.services.metrics.updateMetric(h.ctx, "revenue", { name: "Revenue v2" }),
      ConflictError,
    );
  });

  it("resolves transitive dependencies into evaluation order", async () => {
    const h = harness();
    await smallCube(h);
    const ordered = await h.module.services.metrics.resolveForQuery(h.ctx, TEST_CUBE, ["aov_per_unit"]);
    const codes = ordered.map((metric) => metric.code);

    assert.ok(codes.includes("revenue") && codes.includes("orders") && codes.includes("avg_units"));
    assert.ok(codes.indexOf("aov") < codes.indexOf("aov_per_unit"));
    assert.ok(codes.indexOf("revenue") < codes.indexOf("aov"));
  });

  it("exposes lineage in both directions", async () => {
    const h = harness();
    await smallCube(h);
    const lineage = await h.module.services.metrics.lineage(h.ctx, TEST_CUBE);
    const revenue = lineage.find((entry) => entry.code === "revenue")!;
    const aov = lineage.find((entry) => entry.code === "aov")!;

    assert.deepEqual(revenue.dependsOn, []);
    assert.deepEqual(revenue.usedBy, ["aov"]);
    assert.deepEqual([...aov.dependsOn].sort(), ["orders", "revenue"]);
    assert.deepEqual(aov.usedBy, ["aov_per_unit"]);
  });

  it("announces catalog changes on the outbox", async () => {
    const h = harness();
    await smallCube(h);
    const types = new Set((await h.module.outbox.pending()).map((event) => event.eventType));

    assert.ok(types.has(ReportingEventTypes.DimensionRegistered));
    assert.ok(types.has(ReportingEventTypes.DimensionMembersLoaded));
    assert.ok(types.has(ReportingEventTypes.CubeDefined));
    assert.ok(types.has(ReportingEventTypes.CubePublished));
    assert.ok(types.has(ReportingEventTypes.MetricDefined));
    assert.ok(types.has(ReportingEventTypes.MetricPublished));
  });
});
