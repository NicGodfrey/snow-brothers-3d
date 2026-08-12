import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidStateError, QuotaExceededError, ValidationError } from "../src/domain/errors.js";
import { PLAN_QUOTAS, Tenant, mergeSettings } from "../src/domain/tenant.js";
import { activeTenant, harness, rejects, throwsSync, TEST_TENANT } from "./support.js";

const at = (iso: string) => iso as never;

describe("tenant aggregate", () => {
  it("provisions with plan quotas and merged settings", () => {
    const tenant = Tenant.create({
      key: "Northwind",
      name: "Northwind Manufacturing",
      plan: "standard",
      settings: { locale: "en-GB", defaultCurrency: "GBP" },
    });

    assert.equal(tenant.key, "northwind", "the key is normalised to lower case");
    assert.equal(tenant.status, "provisioning");
    assert.deepEqual(tenant.quotas, PLAN_QUOTAS.standard);
    assert.equal(tenant.settings.locale, "en-GB");
    assert.equal(tenant.settings.timeZone, "UTC", "unset settings fall back to the defaults");
    assert.equal(tenant.isOperational, false);
    assert.equal(tenant.pullEvents()[0]?.eventType, "admin.tenant.provisioned");
  });

  it("rejects keys, names and contacts that would embarrass a URL or an invoice", () => {
    assert.throws(() => Tenant.create({ key: "ab", name: "Too Short" }), ValidationError);
    assert.throws(() => Tenant.create({ key: "9lives", name: "Leading digit" }), ValidationError);
    assert.throws(() => Tenant.create({ key: "north_wind", name: "Underscore" }), ValidationError);
    assert.throws(() => Tenant.create({ key: "northwind", name: "x" }), ValidationError);
    assert.throws(
      () =>
        Tenant.create({
          key: "northwind",
          name: "Northwind",
          contacts: [{ kind: "billing", name: "P", email: "not-an-email" }],
        }),
      ValidationError,
    );
  });

  it("validates settings on merge rather than on read", () => {
    const base = mergeSettings(
      { locale: "en-US", timeZone: "UTC", defaultCurrency: "USD", fiscalYearStartMonth: 1, dataResidency: "eu-west" },
      { fiscalYearStartMonth: 4 },
    );
    assert.equal(base.fiscalYearStartMonth, 4);
    assert.throws(() => mergeSettings(base, { fiscalYearStartMonth: 13 }), ValidationError);
    assert.throws(() => mergeSettings(base, { locale: "english" }), ValidationError);
    assert.throws(() => mergeSettings(base, { defaultCurrency: "pounds" }), ValidationError);
    assert.throws(() => mergeSettings(base, { supportEmail: "help@" }), ValidationError);
  });

  it("enforces the lifecycle transition table", () => {
    const tenant = Tenant.create({ key: "northwind", name: "Northwind" });
    tenant.pullEvents();

    assert.throws(() => tenant.suspend("nonpayment", at("2026-03-01T00:00:00.000Z")), InvalidStateError);
    tenant.activate(at("2026-03-01T00:00:00.000Z"));
    assert.equal(tenant.pullEvents()[0]?.eventType, "admin.tenant.activated");

    tenant.suspend("nonpayment", at("2026-03-02T00:00:00.000Z"));
    assert.equal(tenant.status, "suspended");
    assert.equal(tenant.isOperational, false);
    assert.equal(tenant.pullEvents()[0]?.eventType, "admin.tenant.suspended");

    tenant.activate(at("2026-03-03T00:00:00.000Z"));
    assert.equal(
      tenant.pullEvents()[0]?.eventType,
      "admin.tenant.resumed",
      "a second activation is a resume, not a first activation",
    );

    tenant.archive(at("2026-03-04T00:00:00.000Z"));
    assert.equal(tenant.canTransitionTo("active"), false, "archival is terminal");
    assert.throws(() => tenant.rename("Southwind"), InvalidStateError);
  });

  it("requires a reason to suspend", () => {
    const tenant = Tenant.create({ key: "northwind", name: "Northwind" });
    tenant.activate(at("2026-03-01T00:00:00.000Z"));
    assert.throws(() => tenant.suspend("   ", at("2026-03-02T00:00:00.000Z")), ValidationError);
  });

  it("resets quotas to the new plan and re-applies negotiated overrides", () => {
    const tenant = Tenant.create({ key: "northwind", name: "Northwind", plan: "trial" });
    assert.equal(tenant.quotas.users, PLAN_QUOTAS.trial.users);

    tenant.changePlan("enterprise", { webhooks: 500 });
    assert.equal(tenant.quotas.users, PLAN_QUOTAS.enterprise.users);
    assert.equal(tenant.quotas.webhooks, 500, "the override survives the plan defaults");

    tenant.changePlan("standard");
    assert.equal(tenant.quotas.webhooks, PLAN_QUOTAS.standard.webhooks, "overrides do not persist across plans");
  });

  it("reports the quota that would be breached", () => {
    const tenant = Tenant.create({ key: "northwind", name: "Northwind", plan: "trial" });
    tenant.assertWithinQuota("webhooks", 1);
    const error = throwsSync(() => tenant.assertWithinQuota("webhooks", PLAN_QUOTAS.trial.webhooks));
    assert.ok(error instanceof QuotaExceededError);
    assert.match(error.message, /webhooks/);
  });

  it("keeps one contact per kind", () => {
    const tenant = Tenant.create({ key: "northwind", name: "Northwind" });
    tenant.setContact({ kind: "billing", name: "Priya", email: "priya@northwind.example" });
    tenant.setContact({ kind: "billing", name: "Sam", email: "sam@northwind.example" });
    tenant.setContact({ kind: "security", name: "Mei", email: "mei@northwind.example" });

    assert.equal(tenant.contacts.length, 2);
    assert.equal(tenant.contacts.find((c) => c.kind === "billing")?.name, "Sam");
  });
});

describe("tenant service", () => {
  it("seeds the system roles on provisioning and refuses a duplicate key", async () => {
    const h = harness();
    await h.container.services.tenant.provision(h.platform, {
      key: TEST_TENANT,
      name: "Northwind Manufacturing",
    });

    const roles = h.container.services.role.list(h.tenantId).map((role) => role.code);
    assert.deepEqual(roles.sort(), ["auditor", "service", "tenant-admin", "tenant-operator"]);
    assert.ok(
      h.container.services.role.list(h.tenantId).every((role) => role.isSystem),
      "seeded roles are marked as platform-managed",
    );

    const error = await rejects(() =>
      h.container.services.tenant.provision(h.platform, { key: TEST_TENANT, name: "Impostor" }),
    );
    assert.match(error.message, /already/i);
  });

  it("refuses work for a tenant that is not active", async () => {
    const h = harness();
    await h.container.services.tenant.provision(h.platform, { key: TEST_TENANT, name: "Northwind" });

    const error = await rejects(() =>
      h.container.services.featureFlag.create(h.admin, { key: "any-flag", name: "Any" }),
    );
    assert.ok(error instanceof InvalidStateError);

    await h.container.services.tenant.activate(h.platform, TEST_TENANT);
    await h.container.services.featureFlag.create(h.admin, { key: "any-flag", name: "Any" });
    assert.equal(h.container.services.featureFlag.list(h.tenantId).length, 1);
  });

  it("blocks a downgrade that current usage would immediately breach", async () => {
    const h = harness();
    await activeTenant(h);
    const { tenant, featureFlag } = h.container.services;

    for (let i = 0; i < 21; i += 1) {
      await featureFlag.create(h.admin, { key: `flag-${String(i).padStart(3, "0")}`, name: `Flag ${i}` });
    }

    const error = await rejects(() => tenant.changePlan(h.platform, TEST_TENANT, "trial"));
    assert.match(error.message, /featureFlags/);
    assert.equal(tenant.require(TEST_TENANT).plan, "standard", "the plan is unchanged after a rejected downgrade");

    await tenant.changePlan(h.platform, TEST_TENANT, "enterprise");
    assert.equal(tenant.require(TEST_TENANT).plan, "enterprise");
  });

  it("reports quota headroom per resource", async () => {
    const h = harness();
    await activeTenant(h);
    await h.container.services.webhook.register(h.admin, {
      name: "Ops",
      url: "https://hooks.northwind.example/events",
      eventFilters: ["admin.user.*"],
    });

    const report = h.container.services.tenant.quotaReport(TEST_TENANT);
    const webhooks = report.entries.find((entry) => entry.resource === "webhooks");
    assert.equal(report.plan, "standard");
    assert.deepEqual(
      { used: webhooks?.used, limit: webhooks?.limit, percent: webhooks?.percent },
      { used: 1, limit: PLAN_QUOTAS.standard.webhooks, percent: 5 },
    );
  });

  it("audits every state change with the acting principal", async () => {
    const h = harness();
    await activeTenant(h);
    await h.container.services.tenant.suspend(h.platform, TEST_TENANT, "billing dispute");

    const entries = h.container.services.audit.query(h.tenantId, { resourceType: "Tenant" });
    const actions = entries.items.map((entry) => entry.action);
    assert.deepEqual(actions, ["tenant.suspend", "tenant.activate", "tenant.provision"]);
    assert.equal(entries.items[0]?.actor, h.platform.actor);
    assert.equal(entries.items[0]?.reason, "billing dispute");
  });
});
