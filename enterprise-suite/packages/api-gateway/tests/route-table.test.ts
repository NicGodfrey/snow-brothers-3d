import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RouteTable } from "../src/domain/route-table.js";
import {
  compilePattern,
  matchPattern,
  resolveUpstreamPath,
  splitPath,
  type RouteDefinition,
} from "../src/domain/route.js";
import { MethodNotAllowedError, RouteConflictError, RouteNotFoundError, ValidationError } from "../src/domain/errors.js";

function route(partial: Partial<RouteDefinition> & Pick<RouteDefinition, "id" | "pattern">): RouteDefinition {
  return {
    method: "GET",
    upstream: "product-plm",
    auth: { mode: "tenant" },
    ...partial,
  } as RouteDefinition;
}

describe("pattern compilation", () => {
  it("classifies segments and derives a method-independent signature", () => {
    const compiled = compilePattern("/api/plm/products/:productId/bom");
    assert.deepEqual(
      compiled.segments.map((s) => s.kind),
      ["static", "static", "static", "param", "static"],
    );
    assert.equal(compiled.signature, "/api/plm/products/{}/bom");
    assert.deepEqual([...compiled.weights], [3, 3, 3, 2, 3]);
    assert.equal(compiled.hasWildcard, false);
  });

  it("rejects malformed patterns", () => {
    assert.throws(() => compilePattern("api/plm"), ValidationError);
    assert.throws(() => compilePattern("/api/:1bad"), ValidationError);
    assert.throws(() => compilePattern("/api/:id/:id"), ValidationError);
    assert.throws(() => compilePattern("/api/*rest/tail"), ValidationError);
  });

  it("binds params and captures wildcard tails", () => {
    const compiled = compilePattern("/api/plm/products/:productId");
    assert.deepEqual(matchPattern(compiled, splitPath("/api/plm/products/p_1")), {
      productId: "p_1",
    });
    assert.equal(matchPattern(compiled, splitPath("/api/plm/products")), undefined);
    assert.equal(matchPattern(compiled, splitPath("/api/plm/products/p_1/bom")), undefined);

    const wildcard = compilePattern("/api/*rest");
    assert.deepEqual(matchPattern(wildcard, splitPath("/api/plm/products/p_1")), {
      rest: "plm/products/p_1",
    });
    assert.deepEqual(matchPattern(wildcard, splitPath("/api")), { rest: "" });
  });

  it("percent-decodes path segments", () => {
    const compiled = compilePattern("/api/mdm/customers/:code");
    assert.deepEqual(matchPattern(compiled, splitPath("/api/mdm/customers/ACME%20GmbH")), {
      code: "ACME GmbH",
    });
  });
});

describe("route table matching", () => {
  const table = new RouteTable([
    route({ id: "products.get", pattern: "/api/plm/products/:productId" }),
    route({ id: "products.search", pattern: "/api/plm/products/search" }),
    route({ id: "products.bom", pattern: "/api/plm/products/:productId/bom" }),
    route({ id: "catch-all", pattern: "/api/*rest" }),
    route({ id: "products.create", pattern: "/api/plm/products", method: "POST" }),
    route({ id: "products.list", pattern: "/api/plm/products" }),
  ]);

  it("prefers static segments over params regardless of insertion order", () => {
    assert.equal(table.match("GET", "/api/plm/products/search")?.route.id, "products.search");
    assert.equal(table.match("GET", "/api/plm/products/p_9")?.route.id, "products.get");
    assert.deepEqual(table.match("GET", "/api/plm/products/p_9")?.params, { productId: "p_9" });
  });

  it("falls back to the wildcard only when nothing else matches", () => {
    assert.equal(table.match("GET", "/api/finance/journals")?.route.id, "catch-all");
    assert.equal(table.match("GET", "/api/plm/products")?.route.id, "products.list");
  });

  it("reports allowed methods and distinguishes 404 from 405", () => {
    assert.deepEqual(table.allowedMethods("/api/plm/products"), ["GET", "POST"]);
    assert.throws(() => table.resolve("PATCH", "/api/plm/products/p_1/bom"), MethodNotAllowedError);
    const bare = new RouteTable([route({ id: "only", pattern: "/health" })]);
    assert.throws(() => bare.resolve("GET", "/nope"), RouteNotFoundError);
    assert.throws(() => bare.resolve("POST", "/health"), MethodNotAllowedError);
  });

  it("refuses conflicting registrations", () => {
    const fresh = new RouteTable([route({ id: "a", pattern: "/api/x/:id" })]);
    assert.throws(() => fresh.add(route({ id: "b", pattern: "/api/x/:other" })), RouteConflictError);
    assert.throws(() => fresh.add(route({ id: "a", pattern: "/api/y" })), RouteConflictError);
    fresh.add(route({ id: "c", pattern: "/api/x/:id", method: "DELETE" }));
    assert.equal(fresh.size, 2);
  });

  it("audits unknown upstreams, anonymous writes and shadowed routes", () => {
    const audited = new RouteTable([
      route({ id: "ghost", pattern: "/api/ghost", upstream: "not-real" }),
      route({ id: "open-write", pattern: "/api/open", method: "POST", auth: { mode: "anonymous" } }),
      route({ id: "wide", pattern: "/api/plm/*rest" }),
      route({ id: "narrow", pattern: "/api/:service/products" }),
    ]);
    const findings = audited.audit(new Set(["product-plm"]));
    assert.ok(findings.some((f) => f.includes('unknown upstream "not-real"')));
    assert.ok(findings.some((f) => f.includes("anonymous POST")));
    assert.ok(findings.some((f) => f.includes("shadowed by wildcard route wide")));
  });

  it("groups routes by upstream and filters descriptions", () => {
    const grouped = table.byUpstream();
    assert.equal(grouped.get("product-plm")?.length, 6);
    assert.equal(table.describe({ method: "POST" }).length, 1);
    assert.equal(table.list({ pathPrefix: "/api/plm" }).length, 5);
  });
});

describe("upstream path rewriting", () => {
  it("strips the service prefix by default", () => {
    const definition = route({ id: "r", pattern: "/api/plm/products/:productId" });
    assert.equal(
      resolveUpstreamPath(definition, { productId: "p_1" }, "/api/plm"),
      "/products/p_1",
    );
    assert.equal(resolveUpstreamPath(route({ id: "r2", pattern: "/api/plm" }), {}, "/api/plm"), "/");
  });

  it("applies an explicit rewrite template", () => {
    const definition = route({
      id: "r3",
      pattern: "/api/plm/products/:productId/bom",
      rewrite: "/v2/boms/:productId",
    });
    assert.equal(resolveUpstreamPath(definition, { productId: "p 1" }, "/api/plm"), "/v2/boms/p%201");
  });

  it("replaces the public prefix with an upstream mount prefix", () => {
    const definition = route({ id: "sales", pattern: "/api/sales/quotes/:quoteId" });
    assert.equal(
      resolveUpstreamPath(definition, { quoteId: "q 1" }, "/api/sales", "/sales"),
      "/sales/quotes/q%201",
    );
    assert.equal(
      resolveUpstreamPath(
        route({ id: "admin", pattern: "/api/admin/tenants" }),
        {},
        "/api/admin",
        "/api/admin",
      ),
      "/api/admin/tenants",
    );
  });

  it("rejects rewrites that reference unknown parameters", () => {
    const table = new RouteTable();
    assert.throws(
      () =>
        table.add(
          route({ id: "bad", pattern: "/api/plm/products/:productId", rewrite: "/v2/:other" }),
        ),
      ValidationError,
    );
  });
});
