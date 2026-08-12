import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  breadcrumbs,
  buildNavigation,
  normalizePath,
  resolveRoute,
  visibleModules,
} from "../src/domain/navigation.js";
import { MODULE_CATALOG } from "../src/domain/module-catalog.js";
import { createHarness, USERS } from "./helpers.js";

const harness = createHarness();

describe("route resolution", () => {
  it("resolves the dashboard, module defaults and deep views", () => {
    assert.equal(resolveRoute("/").kind, "dashboard");

    const moduleDefault = resolveRoute("/m/sales");
    assert.equal(moduleDefault.kind, "module");
    assert.equal(moduleDefault.kind === "module" && moduleDefault.item.slug, "quotes");

    const deep = resolveRoute("/m/finance/journals");
    assert.equal(deep.kind === "module" && deep.module.key, "finance");
    assert.equal(deep.path, "/m/finance/journals");
  });

  it("rejects unknown modules, unknown slugs and extra segments", () => {
    assert.equal(resolveRoute("/m/hr").kind, "not-found");
    assert.equal(resolveRoute("/m/sales/nope").kind, "not-found");
    assert.equal(resolveRoute("/m/sales/quotes/extra").kind, "not-found");
  });

  it("normalises trailing slashes and query strings", () => {
    assert.equal(normalizePath("/m/sales/quotes/"), "/m/sales/quotes");
    assert.equal(normalizePath("/m/sales/quotes?q=x"), "/m/sales/quotes");
    assert.equal(normalizePath("///"), "/");
    assert.equal(resolveRoute("/preferences/").kind, "system");
  });

  it("builds breadcrumbs per route kind", () => {
    assert.deepEqual(
      breadcrumbs(resolveRoute("/m/srm/contracts")).map((c) => c.label),
      ["Home", "SRM", "Contracts"],
    );
    assert.deepEqual(breadcrumbs(resolveRoute("/search")).map((c) => c.label), ["Home", "Search"]);
  });
});

describe("navigation for a session", () => {
  it("hides modules the tenant is not entitled to", () => {
    const acme = harness.session(USERS.admin, "acme");
    const globex = harness.session(USERS.admin, "globex");
    assert.equal(visibleModules(acme).length, MODULE_CATALOG.length);
    assert.ok(!visibleModules(globex).some((m) => m.key === "prm"));
  });

  it("hides modules the role cannot read and marks denied views disabled", () => {
    const buyer = harness.session(USERS.buyer, "acme");
    const nav = buildNavigation(buyer, { showDenied: true });
    const sales = nav.find((m) => m.key === "sales");
    assert.ok(sales, "buyer inherits viewer so sales is readable");
    const approvals = sales?.items.find((i) => i.key === "sales.approvals");
    assert.equal(approvals?.enabled, false, "buyer cannot approve discounts");

    const hidden = buildNavigation(buyer, { showDenied: false })
      .find((m) => m.key === "sales")
      ?.items.map((i) => i.key);
    assert.ok(!hidden?.includes("sales.approvals"));
  });

  it("hoists pinned modules and preserves pin order", () => {
    const session = harness.session(USERS.admin, "acme");
    const nav = buildNavigation(session, { pinned: ["finance", "srm"] });
    assert.deepEqual(nav.slice(0, 2).map((m) => m.key), ["finance", "srm"]);
    assert.ok(nav.slice(2).every((m) => !m.pinned));
  });

  it("marks the active item and module from the current path", () => {
    const session = harness.session(USERS.admin, "acme");
    const nav = buildNavigation(session, { activePath: "/m/inventory/movements" });
    const inventory = nav.find((m) => m.key === "inventory");
    assert.equal(inventory?.active, true);
    assert.deepEqual(
      inventory?.items.filter((i) => i.active).map((i) => i.path),
      ["/m/inventory/movements"],
    );
  });

  it("points a module at the first view its session can open", () => {
    const marketer = harness.session(USERS.marketer, "acme");
    const nav = buildNavigation(marketer, { showDenied: true });
    const finance = nav.find((m) => m.key === "finance");
    // Marketing manager only inherits viewer for finance: periods needs finance:close.
    assert.equal(finance?.path, "/m/finance/receivables");
    assert.equal(finance?.items.find((i) => i.key === "finance.periods")?.enabled, false);
  });
});
