import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MIN_SEARCH_LENGTH } from "../src/application/search-service.js";
import { createHarness, USERS } from "./helpers.js";

const harness = createHarness();

describe("cross-module search", () => {
  it("groups hits by module and links back into the shell", async () => {
    const session = harness.session(USERS.admin, "acme");
    const result = await harness.container.forSession(session).search.search(session, "northwind");

    assert.ok(result.groups.length >= 2, "the customer appears in sales and finance");
    const sales = result.groups.find((g) => g.module === "sales");
    assert.ok(sales?.hits.some((h) => h.title.includes("Northwind Traders")));
    assert.match(sales?.hits[0]!.path ?? "", /^\/m\/sales\/(quotes|orders|customers)\?q=northwind$/);
    assert.equal(result.totalHits, result.groups.reduce((sum, g) => sum + g.hits.length, 0));
  });

  it("ignores terms below the minimum length", async () => {
    const session = harness.session(USERS.admin, "acme");
    const result = await harness.container
      .forSession(session)
      .search.search(session, "a".repeat(MIN_SEARCH_LENGTH - 1));
    assert.deepEqual(result.groups, []);
    assert.equal(result.totalHits, 0);
  });

  it("never searches a module the session cannot see", async () => {
    const globex = harness.session(USERS.admin, "globex");
    const result = await harness.container.forSession(globex).search.search(globex, "vector");
    assert.ok(!result.groups.some((g) => g.module === "prm"));
    assert.ok(!harness.transport.calls.some((c) => c.module === "prm" && c.tenantId === "globex"));
  });

  it("reports an unavailable module and still returns the rest", async () => {
    const session = harness.session(USERS.admin, "acme");
    harness.transport.failModule("inventory", { status: 500, code: "BOOM", message: "down" });
    try {
      const result = await harness.container.forSession(session).search.search(session, "wheel");
      assert.deepEqual(result.unavailableModules, ["inventory"]);
      assert.ok(result.totalHits >= 0);
      assert.ok(!result.groups.some((g) => g.module === "inventory"));
    } finally {
      harness.transport.clearFailures();
    }
  });

  it("caps the total number of hits and flags truncation", async () => {
    const session = harness.session(USERS.admin, "acme");
    const result = await harness.container
      .forSession(session)
      .search.search(session, "a", { perModuleLimit: 5, totalLimit: 3 });
    assert.ok(result.totalHits <= 3);
    if (result.totalHits === 3) assert.equal(result.truncated, true);
  });
});
