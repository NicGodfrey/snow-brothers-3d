import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "@enterprise-suite/shared-kernel";
import {
  applyPatch,
  defaultPreferences,
  togglePin,
  MAX_PINNED_MODULES,
} from "../src/domain/preferences.js";
import { createHarness, NOW, USERS } from "./helpers.js";

const harness = createHarness();
const base = defaultPreferences("acme", "u-avery", "en-US", NOW);

describe("preferences domain", () => {
  it("validates every patched field", () => {
    const patched = applyPatch(
      base,
      { density: "compact", theme: "dark", locale: "en-GB", landingModule: "finance" },
      NOW,
    );
    assert.equal(patched.density, "compact");
    assert.equal(patched.landingModule, "finance");

    assert.throws(() => applyPatch(base, { density: "cosy" }, NOW), DomainError);
    assert.throws(() => applyPatch(base, { theme: "neon" }, NOW), DomainError);
    assert.throws(() => applyPatch(base, { locale: "english" }, NOW), DomainError);
    assert.throws(() => applyPatch(base, { landingModule: "hr" }, NOW), DomainError);
  });

  it("clears the landing module with an explicit null", () => {
    const set = applyPatch(base, { landingModule: "sales" }, NOW);
    assert.equal(applyPatch(set, { landingModule: null }, NOW).landingModule, undefined);
  });

  it("rejects duplicate and over-long pin lists", () => {
    assert.throws(() => applyPatch(base, { pinnedModules: ["sales", "sales"] }, NOW), DomainError);
    assert.throws(
      () =>
        applyPatch(base, { pinnedModules: ["sales", "srm", "prm", "finance", "inventory"] }, NOW),
      DomainError,
    );
  });

  it("toggles pins and caps them", () => {
    let prefs = togglePin(base, "sales", NOW);
    assert.deepEqual(prefs.pinnedModules, ["sales"]);
    prefs = togglePin(prefs, "sales", NOW);
    assert.deepEqual(prefs.pinnedModules, []);

    for (const module of ["sales", "srm", "prm", "finance"] as const) {
      prefs = togglePin(prefs, module, NOW);
    }
    assert.equal(prefs.pinnedModules.length, MAX_PINNED_MODULES);
    assert.throws(() => togglePin(prefs, "inventory", NOW), DomainError);
  });
});

describe("preferences service", () => {
  it("returns defaults for a first-time user and persists updates", async () => {
    const session = harness.session(USERS.salesManager, "acme");
    const service = harness.container.preferences;

    const initial = await service.load(session);
    assert.deepEqual(initial.pinnedModules, []);
    assert.equal(initial.locale, "en-US");

    await service.update(session, { density: "compact" });
    assert.equal((await service.load(session)).density, "compact");
  });

  it("keeps preferences per tenant", async () => {
    const acme = harness.session(USERS.admin, "acme");
    const globex = harness.session(USERS.admin, "globex");
    await harness.container.preferences.togglePinned(acme, "finance");
    assert.deepEqual((await harness.container.preferences.load(acme)).pinnedModules, ["finance"]);
    assert.deepEqual((await harness.container.preferences.load(globex)).pinnedModules, []);
  });

  it("refuses to pin a module the tenant is not entitled to", async () => {
    const globex = harness.session(USERS.admin, "globex");
    await assert.rejects(
      harness.container.preferences.togglePinned(globex, "prm"),
      (error: unknown) => error instanceof DomainError && error.code === "NOT_ENTITLED",
    );
  });

  it("requires a name on a saved view", async () => {
    const marketer = harness.session(USERS.marketer, "acme");
    await assert.rejects(
      harness.container.preferences.saveView(marketer, {
        module: "marketing",
        resource: "leads",
        name: "   ",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "VALIDATION",
    );
  });

  it("prunes pins that a tenant switch invalidated, without persisting the prune", async () => {
    const acme = harness.session(USERS.admin, "acme");
    const globex = harness.session(USERS.admin, "globex");
    await harness.container.preferences.update(acme, { pinnedModules: ["prm", "sales"] });

    const globexView = await harness.container.preferences.load(globex);
    assert.deepEqual(globexView.pinnedModules, [], "globex has no stored preferences");

    const acmeView = await harness.container.preferences.load(acme);
    assert.deepEqual(acmeView.pinnedModules, ["prm", "sales"]);
  });

  it("stores, lists and removes saved views", async () => {
    const session = harness.session(USERS.controller, "acme");
    const service = harness.container.preferences;
    const saved = await service.saveView(session, {
      module: "finance",
      resource: "receivables",
      name: "90+ ageing",
      query: { q: "90+" },
    });
    assert.equal(saved.savedViews.length, 1);
    assert.equal(saved.savedViews[0]!.query.q, "90+");

    await assert.rejects(
      service.saveView(session, { module: "finance", resource: "receivables", name: "90+ ageing" }),
      (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
    );

    const removed = await service.deleteView(session, saved.savedViews[0]!.id);
    assert.deepEqual(removed.savedViews, []);
    await assert.rejects(service.deleteView(session, "view-nope"), DomainError);
  });

  it("rejects an unknown module key outright", async () => {
    const session = harness.session(USERS.admin, "acme");
    await assert.rejects(harness.container.preferences.togglePinned(session, "hr"), DomainError);
  });

  it("hides a saved view when the module leaves the subscription, without deleting it", async () => {
    const acme = harness.session(USERS.admin, "acme");
    await harness.container.preferences.saveView(acme, {
      module: "prm",
      resource: "deals",
      name: "Pending registrations",
    });

    const downgraded = {
      ...acme,
      tenant: {
        ...acme.tenant,
        entitlements: acme.tenant.entitlements.filter((key) => key !== "prm"),
      },
    };
    assert.deepEqual((await harness.container.preferences.load(downgraded)).savedViews, []);

    const stored = await harness.container.preferencesRepository.find("acme", "u-admin");
    assert.equal(stored?.savedViews.length, 1, "the row itself is untouched");
  });
});
