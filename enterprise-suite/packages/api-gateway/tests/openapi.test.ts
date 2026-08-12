import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenApiAggregator } from "../src/application/openapi-aggregator.js";
import {
  mergeOpenApiDocuments,
  rewriteRefs,
  synthesizeSpecFromRoutes,
  toOpenApiPath,
  type OpenApiDocument,
} from "../src/domain/openapi.js";
import { RouteTable } from "../src/domain/route-table.js";
import { ServiceCatalog, defineService } from "../src/domain/service-catalog.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { MemoryLogger } from "../src/infrastructure/logger.js";
import { NullSpecSource, StaticSpecSource } from "../src/infrastructure/spec-source.js";

function doc(overrides: Partial<OpenApiDocument> = {}): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {},
    ...overrides,
  };
}

const plmDoc = doc({
  info: { title: "PLM", version: "1.2.0" },
  tags: [{ name: "catalog" }],
  paths: {
    "/products": {
      get: {
        operationId: "listProducts",
        tags: ["catalog"],
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Product: { type: "object", properties: { sku: { $ref: "#/components/schemas/Sku" } } },
      Sku: { type: "string" },
    },
  },
});

const salesDoc = doc({
  info: { title: "Sales", version: "2.0.0" },
  paths: {
    "/orders": {
      get: {
        operationId: "listOrders",
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } },
          },
        },
      },
      post: { operationId: "createOrder", responses: { "201": { description: "created" } } },
    },
  },
  // Same name, different shape: must be renamed, not silently merged.
  components: { schemas: { Product: { type: "string" } } },
});

describe("document merging", () => {
  const merged = mergeOpenApiDocuments(
    [
      { serviceId: "product-plm", document: plmDoc, prefix: "/api/plm" },
      { serviceId: "sales-erp", document: salesDoc, prefix: "/api/sales" },
    ],
    { info: { title: "Suite", version: "0.1.0" }, namespaceTags: true },
  );

  it("prefixes paths with the owning service", () => {
    assert.deepEqual(Object.keys(merged.document.paths), ["/api/plm/products", "/api/sales/orders"]);
    assert.equal(merged.report.operationCount, 3);
    assert.equal(merged.report.pathCount, 2);
  });

  it("namespaces operationIds and tags", () => {
    const operation = merged.document.paths["/api/plm/products"]!["get"]!;
    assert.equal(operation.operationId, "productPlm_listProducts");
    assert.deepEqual(operation.tags, ["product-plm:catalog"]);
    assert.equal(operation["x-upstream-service"], "product-plm");
  });

  it("renames colliding component schemas and rewrites refs", () => {
    assert.deepEqual(merged.report.renamedComponents, [
      { from: "Product", to: "SalesErp_Product", serviceId: "sales-erp" },
    ]);
    const salesRef = merged.document.paths["/api/sales/orders"]!["get"]!.responses["200"]!.content![
      "application/json"
    ]!.schema;
    assert.deepEqual(salesRef, { $ref: "#/components/schemas/SalesErp_Product" });
    const plmRef = merged.document.paths["/api/plm/products"]!["get"]!.responses["200"]!.content![
      "application/json"
    ]!.schema;
    assert.deepEqual(plmRef, { $ref: "#/components/schemas/Product" }, "the first owner keeps the name");
    assert.ok(merged.document.components?.schemas?.["SalesErp_Product"]);
    assert.ok(merged.document.components?.schemas?.["Error"], "the shared error envelope is always present");
  });

  it("keeps structurally identical schemas shared", () => {
    const twin = mergeOpenApiDocuments(
      [
        { serviceId: "a", document: plmDoc, prefix: "/api/a" },
        { serviceId: "b", document: plmDoc, prefix: "/api/b" },
      ],
      { info: { title: "Suite", version: "0.1.0" } },
    );
    assert.deepEqual(twin.report.renamedComponents, []);
    assert.equal(Object.keys(twin.document.components?.schemas ?? {}).length, 3);
  });

  it("drops a duplicate operation rather than overwriting it", () => {
    const clash = mergeOpenApiDocuments(
      [
        { serviceId: "a", document: plmDoc, prefix: "/api/shared" },
        { serviceId: "b", document: plmDoc, prefix: "/api/shared" },
      ],
      { info: { title: "Suite", version: "0.1.0" } },
    );
    assert.equal(clash.report.droppedPaths.length, 1);
    assert.equal(clash.report.droppedPaths[0]?.serviceId, "b");
    assert.equal(clash.document.paths["/api/shared/products"]!["get"]!["x-upstream-service"], "a");
  });

  it("rewrites nested refs inside arrays and objects", () => {
    const rewritten = rewriteRefs(
      { anyOf: [{ $ref: "#/components/schemas/A" }, { items: { $ref: "#/components/schemas/B" } }] },
      new Map([["A", "X_A"]]),
    );
    assert.deepEqual(rewritten, {
      anyOf: [{ $ref: "#/components/schemas/X_A" }, { items: { $ref: "#/components/schemas/B" } }],
    });
  });
});

describe("stub synthesis", () => {
  const service = { id: "quality-qms", label: "Quality QMS", version: "0.1.0", prefix: "/api/quality" };
  const table = new RouteTable([
    {
      id: "quality.ncrs.list",
      method: "GET",
      pattern: "/api/quality/ncrs",
      upstream: "quality-qms",
      auth: { mode: "tenant" },
      rateLimit: { limit: 100, windowMs: 60_000, key: "tenant" },
    },
    {
      id: "quality.ncrs.get",
      method: "GET",
      pattern: "/api/quality/ncrs/:ncrId",
      upstream: "quality-qms",
      auth: { mode: "roles", anyOfRoles: ["quality-manager"] },
    },
    {
      id: "quality.internal",
      method: "GET",
      pattern: "/api/quality/internal",
      upstream: "quality-qms",
      auth: { mode: "tenant" },
      exposeInOpenApi: false,
    },
  ]);

  it("turns route patterns into OpenAPI paths with tenant headers", () => {
    const document = synthesizeSpecFromRoutes(service, table.list());
    assert.deepEqual(Object.keys(document.paths), ["/ncrs", "/ncrs/{ncrId}"]);
    const get = document.paths["/ncrs/{ncrId}"]!["get"]!;
    assert.equal(get["x-stub"], true);
    assert.deepEqual(
      get.parameters?.map((p) => p.name),
      ["ncrId", "x-tenant-id", "x-user-id", "x-roles", "x-request-id"],
    );
    assert.ok(get.responses["403"], "role-guarded routes document a 403");
    assert.ok(!document.paths["/ncrs"]!["get"]!.responses["403"]);
    assert.ok(document.paths["/ncrs"]!["get"]!.responses["429"], "throttled routes document a 429");
  });

  it("honours exposeInOpenApi", () => {
    const document = synthesizeSpecFromRoutes(service, table.list());
    assert.equal(document.paths["/internal"], undefined);
  });

  it("converts colon params to braces", () => {
    assert.equal(toOpenApiPath("/products/:id/bom/:line"), "/products/{id}/bom/{line}");
    assert.equal(toOpenApiPath("/files/*rest"), "/files/{rest}");
  });
});

describe("aggregator", () => {
  const catalog = new ServiceCatalog([
    defineService({ id: "product-plm", label: "PLM", system: "ERP", prefix: "/api/plm", baseUrl: "http://127.0.0.1:4105" }),
    defineService({ id: "sales-erp", label: "Sales", system: "ERP", prefix: "/api/sales", baseUrl: "http://127.0.0.1:4103" }),
  ]);
  const routes = new RouteTable([
    {
      id: "sales.orders.list",
      method: "GET",
      pattern: "/api/sales/orders",
      upstream: "sales-erp",
      auth: { mode: "tenant" },
    },
  ]);

  it("merges upstream documents and stubs the rest", async () => {
    const clock = new FixedClock();
    const aggregator = new OpenApiAggregator(
      catalog,
      routes,
      new StaticSpecSource({ "product-plm": plmDoc }),
      clock,
      new MemoryLogger(),
      { stubMissing: true },
    );
    const result = await aggregator.aggregate();
    assert.deepEqual(
      result.report.sources.map((s) => [s.serviceId, s.source]),
      [
        ["product-plm", "upstream"],
        ["sales-erp", "stub"],
      ],
    );
    assert.deepEqual(Object.keys(result.document.paths), ["/api/plm/products", "/api/sales/orders"]);
    assert.deepEqual(result.document.security, [{ TenantHeader: [], UserHeader: [] }]);
    assert.ok(result.document.components?.securitySchemes?.["TenantHeader"]);
  });

  it("survives an upstream that fails to serve its spec", async () => {
    const clock = new FixedClock();
    const logger = new MemoryLogger();
    const aggregator = new OpenApiAggregator(
      catalog,
      routes,
      new StaticSpecSource({}, { "product-plm": "connection refused" }),
      clock,
      logger,
      { stubMissing: true },
    );
    const result = await aggregator.aggregate();
    const plm = result.report.sources.find((s) => s.serviceId === "product-plm")!;
    assert.equal(plm.source, "failed", "no routes to stub from, so the service is reported failed");
    assert.equal(plm.error, "connection refused");
    assert.equal(logger.withLevel("warn").length, 1);
    assert.ok(Object.keys(result.document.paths).includes("/api/sales/orders"));
  });

  it("caches for the TTL and invalidates on demand", async () => {
    const clock = new FixedClock();
    let fetches = 0;
    const counting = {
      async fetchSpec() {
        fetches += 1;
        return plmDoc;
      },
    };
    const aggregator = new OpenApiAggregator(catalog, routes, counting, clock, undefined, {
      cacheTtlMs: 10_000,
    });
    await aggregator.aggregate();
    const cached = await aggregator.aggregate();
    assert.equal(cached.report.cached, true);
    assert.equal(fetches, 2, "one fetch per service on the first pass only");

    clock.advance(10_001);
    await aggregator.aggregate();
    assert.equal(fetches, 4);

    aggregator.invalidate();
    await aggregator.aggregate();
    assert.equal(fetches, 6);
  });

  it("stubs everything when no upstream publishes a document", async () => {
    const clock = new FixedClock();
    const aggregator = new OpenApiAggregator(catalog, routes, new NullSpecSource(), clock);
    const result = await aggregator.aggregate();
    assert.deepEqual(
      result.report.sources.map((s) => s.source).sort(),
      ["skipped", "stub"],
    );
  });
});
