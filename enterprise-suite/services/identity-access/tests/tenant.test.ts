import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "../src/domain/errors.js";
import { DEFAULT_TENANT_SETTINGS, mergeSettings } from "../src/domain/tenant.js";
import { IDENTITY_EVENT } from "../src/domain/events.js";
import { makeModule, seeded } from "./helpers.js";

describe("tenant provisioning", () => {
  it("starts pending and can be activated", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({ slug: "acme", name: "Acme Corp" });
    assert.equal(tenant.status, "pending");
    assert.throws(() => tenant.assertActive(), (error: IdentityError) =>
      error.code === IDENTITY_ERROR.tenantInactive,
    );
    module.tenants.activate(tenant.tenantId);
    assert.equal(module.tenants.get(tenant.tenantId).status, "active");
  });

  it("normalizes and enforces a unique slug", () => {
    const { module } = makeModule();
    module.tenants.provision({ slug: "  Acme  ", name: "Acme Corp" });
    assert.equal(module.tenants.getBySlug("acme").name, "Acme Corp");
    assert.throws(
      () => module.tenants.provision({ slug: "ACME", name: "Impostor" }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.tenantSlugTaken,
    );
  });

  it("rejects a slug that is not URL-safe", () => {
    const { module } = makeModule();
    assert.throws(() => module.tenants.provision({ slug: "Acme Corp!", name: "Acme" }));
  });

  it("refuses to reactivate an archived tenant", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({ slug: "gone", name: "Gone Inc", activate: true });
    module.tenants.archive(tenant.tenantId);
    assert.throws(() => module.tenants.activate(tenant.tenantId), ConflictError);
    assert.throws(() => module.tenants.suspend(tenant.tenantId, "too late"), ConflictError);
  });

  it("installs the system roles at provisioning", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({ slug: "fresh", name: "Fresh Co", activate: true });
    module.installSystemRoles(tenant.tenantId);
    const codes = module.roles.list(tenant.tenantId).map((role) => String(role.code));
    assert.ok(codes.includes("platform_owner"));
    assert.ok(codes.includes("tenant_admin"));
    assert.ok(codes.includes("base_reader"));
    assert.ok(module.roles.list(tenant.tenantId).every((role) => role.isSystem));
  });

  it("installs system roles idempotently", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({ slug: "twice", name: "Twice Co", activate: true });
    module.installSystemRoles(tenant.tenantId);
    const first = module.roles.list(tenant.tenantId).length;
    module.installSystemRoles(tenant.tenantId);
    assert.equal(module.roles.list(tenant.tenantId).length, first);
  });

  it("keeps roles and users of different tenants apart", () => {
    const { module } = makeModule();
    const a = module.tenants.provision({ slug: "alpha", name: "Alpha", activate: true });
    const b = module.tenants.provision({ slug: "beta", name: "Beta", activate: true });
    module.installSystemRoles(a.tenantId);
    module.users.invite(a.tenantId, { email: "same@shared.test", displayName: "Alpha Person" });
    module.users.invite(b.tenantId, { email: "same@shared.test", displayName: "Beta Person" });

    assert.equal(module.users.list(a.tenantId).length, 1);
    assert.equal(module.users.list(b.tenantId).length, 1);
    assert.equal(module.roles.list(b.tenantId).length, 0);
    assert.equal(
      module.users.findByEmail(a.tenantId, "same@shared.test")?.displayName,
      "Alpha Person",
    );
  });
});

describe("tenant settings", () => {
  it("merges a partial patch without losing untouched fields", () => {
    const merged = mergeSettings(DEFAULT_TENANT_SETTINGS, {
      sessionPolicy: { idleTtlSeconds: 600 },
    });
    assert.equal(merged.sessionPolicy.idleTtlSeconds, 600);
    assert.equal(
      merged.sessionPolicy.absoluteTtlSeconds,
      DEFAULT_TENANT_SETTINGS.sessionPolicy.absoluteTtlSeconds,
    );
    assert.equal(merged.passwordPolicy.minLength, DEFAULT_TENANT_SETTINGS.passwordPolicy.minLength);
  });

  it("rejects incoherent policy values", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({ slug: "strict", name: "Strict", activate: true });
    assert.throws(() =>
      module.tenants.updateSettings(tenant.tenantId, { sessionPolicy: { idleTtlSeconds: 5 } }),
    );
    assert.throws(() =>
      module.tenants.updateSettings(tenant.tenantId, {
        sessionPolicy: { absoluteTtlSeconds: 60, idleTtlSeconds: 3600 },
      }),
    );
    assert.throws(() =>
      module.tenants.updateSettings(tenant.tenantId, { passwordPolicy: { minLength: 4 } }),
    );
  });

  it("normalizes the email domain allowlist", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({
      slug: "domains",
      name: "Domains",
      activate: true,
      settings: { allowedEmailDomains: ["@Example.COM", "other.test"] },
    });
    assert.deepEqual([...tenant.settings.allowedEmailDomains], ["example.com", "other.test"]);
    assert.ok(tenant.allowsEmail("person@example.com"));
    assert.ok(tenant.allowsEmail("person@mail.example.com"));
    assert.ok(!tenant.allowsEmail("person@notexample.com"));
  });
});

describe("domain events", () => {
  it("publishes provisioning and activation to the outbox", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({ slug: "evented", name: "Evented", activate: true });
    const types = module.outbox.pending().map((event) => event.eventType);
    assert.ok(types.includes(IDENTITY_EVENT.tenantProvisioned));
    assert.ok(types.includes(IDENTITY_EVENT.tenantActivated));
    assert.equal(module.outbox.pending()[0].tenantId, tenant.tenantId);
  });

  it("stamps every event with the aggregate it came from", () => {
    const { module, refs } = seeded();
    const invited = module.outbox.ofType(IDENTITY_EVENT.userInvited)[0];
    assert.equal(invited.aggregateType, "identity.user");
    assert.equal(invited.tenantId, refs.tenantId);
    assert.equal(invited.schemaVersion, 1);
    assert.ok(invited.eventId.startsWith("evt_"));
  });

  it("notifies subscribers synchronously and drains once", () => {
    const { module } = makeModule();
    const seen: string[] = [];
    module.outbox.on(IDENTITY_EVENT.tenantProvisioned, (event) => seen.push(event.eventType));
    module.tenants.provision({ slug: "watched", name: "Watched" });

    assert.deepEqual(seen, [IDENTITY_EVENT.tenantProvisioned]);
    assert.ok(module.outbox.size() > 0);
    const drained = module.outbox.drain();
    assert.ok(drained.length > 0);
    assert.equal(module.outbox.size(), 0);
  });

  it("covers the full seeded lifecycle", () => {
    const { module } = seeded();
    const types = new Set(module.outbox.pending().map((event) => event.eventType));
    for (const expected of [
      IDENTITY_EVENT.tenantProvisioned,
      IDENTITY_EVENT.userInvited,
      IDENTITY_EVENT.userActivated,
      IDENTITY_EVENT.roleCreated,
      IDENTITY_EVENT.groupCreated,
      IDENTITY_EVENT.groupMemberAdded,
      IDENTITY_EVENT.bindingGranted,
      IDENTITY_EVENT.apiKeyIssued,
    ]) {
      assert.ok(types.has(expected), `expected ${expected} to have been published`);
    }
  });
});

describe("seed fixture", () => {
  it("produces a coherent tenant", () => {
    const { module, refs } = seeded();
    assert.equal(module.users.list(refs.tenantId).length, 6);
    assert.equal(module.groups.list(refs.tenantId).length, 2);
    assert.equal(module.apiKeys.list(refs.tenantId, { activeOnly: true }).length, 1);
    assert.ok(module.roles.list(refs.tenantId).length >= 10);
    assert.ok(module.bindings.list(refs.tenantId, { activeOnly: true }).length >= 8);
  });

  it("gives the demo users the access their titles imply", () => {
    const { module, refs } = seeded();
    const check = (userId: string, permission: string, scope?: string) =>
      module.authorization.can(
        {
          tenantId: refs.tenantId,
          subject: { type: "user", id: userId as never },
          displayName: "seed",
          amr: [],
          mfaSatisfied: false,
        },
        permission,
        { scope },
      );

    assert.ok(check(refs.users.owner, "identity.tenant:suspend"));
    assert.ok(check(refs.users.securityAdmin, "identity.role_binding:grant"));
    assert.ok(!check(refs.users.securityAdmin, "identity.user:impersonate"));
    assert.ok(check(refs.users.auditor, "identity.audit:export"));
    assert.ok(check(refs.users.emeaManager, "sales.order:approve", refs.scopes.emea));
    assert.ok(!check(refs.users.emeaManager, "sales.order:approve", refs.scopes.amer));
    assert.ok(check(refs.users.contractor, "sales.order:read", refs.scopes.emeaHamburg));
    assert.ok(!check(refs.users.contractor, "platform.report:export", refs.scopes.emeaHamburg));
  });
});
