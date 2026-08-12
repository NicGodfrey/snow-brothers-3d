import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundError } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "../src/domain/errors.js";
import { roleCodeOf } from "../src/domain/role.js";
import { scopePath } from "../src/domain/scope.js";
import { groupSubject, subjectKey, userSubject } from "../src/domain/subject.js";
import { wouldCreateGroupCycle } from "../src/application/policy/effective-permissions.js";
import { createActiveUser, emptyTenant, makeModule, seeded } from "./helpers.js";

describe("granting roles", () => {
  it("rejects a duplicate active binding at the same scope", () => {
    const { module, refs } = seeded();
    assert.throws(
      () =>
        module.bindings.grant(refs.tenantId, {
          subject: userSubject(refs.users.auditor),
          roleCode: "auditor",
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.bindingDuplicate,
    );
  });

  it("allows the same role at a different scope", () => {
    const { module, refs } = seeded();
    const binding = module.bindings.grant(refs.tenantId, {
      subject: userSubject(refs.users.auditor),
      roleCode: "auditor",
      scope: refs.scopes.emea,
    });
    assert.equal(binding.scope, refs.scopes.emea);
  });

  it("permits re-granting after a revocation", () => {
    const { module, refs } = seeded();
    const existing = module.bindings.list(refs.tenantId, {
      subject: userSubject(refs.users.auditor),
      activeOnly: true,
    })[0];
    module.bindings.revoke(refs.tenantId, existing.id, { reason: "reorg" });
    const regranted = module.bindings.grant(refs.tenantId, {
      subject: userSubject(refs.users.auditor),
      roleCode: "auditor",
    });
    assert.equal(regranted.status, "active");
  });

  it("refuses to bind a role that exists only to be inherited", () => {
    const { module, refs } = seeded();
    assert.throws(
      () =>
        module.bindings.grant(refs.tenantId, {
          subject: userSubject(refs.users.contractor),
          roleCode: "base_reader",
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.roleNotAssignable,
    );
  });

  it("refuses to bind an unknown subject", () => {
    const { module, refs } = seeded();
    assert.throws(
      () =>
        module.bindings.grant(refs.tenantId, {
          subject: userSubject("usr_does_not_exist"),
          roleCode: "member",
        }),
      NotFoundError,
    );
  });

  it("rejects a validity window that ends before it starts", () => {
    const { module, refs } = seeded();
    assert.throws(() =>
      module.bindings.grant(refs.tenantId, {
        subject: userSubject(refs.users.contractor),
        roleCode: "member",
        validFrom: "2026-05-01T00:00:00.000Z" as never,
        validUntil: "2026-04-01T00:00:00.000Z" as never,
      }),
    );
  });

  it("does not activate a binding before its start date", () => {
    const { module, clock, refs } = seeded();
    const future = new Date(clock.epochMs() + 86_400_000).toISOString();
    const binding = module.bindings.grant(refs.tenantId, {
      subject: userSubject(refs.users.contractor),
      roleCode: "member",
      validFrom: future as never,
    });
    assert.ok(!binding.isActiveAt(clock.now()));
    clock.advanceDays(2);
    assert.ok(binding.isActiveAt(clock.now()));
  });
});

describe("delegation", () => {
  it("lets a delegable holder pass the role on at a narrower scope", () => {
    const { module, refs } = seeded();
    const target = createActiveUser(module, refs.tenantId, "deputy@northwind.example", "Deputy");
    const binding = module.bindings.delegate(
      refs.tenantId,
      userSubject(refs.users.securityAdmin),
      {
        subject: userSubject(target),
        roleCode: "security_admin",
        scope: refs.scopes.emea,
      },
    );
    assert.equal(binding.scope, refs.scopes.emea);
    assert.equal(binding.delegable, false, "delegated bindings are not themselves delegable");
  });

  it("refuses to delegate a role the actor does not hold as delegable", () => {
    const { module, refs } = seeded();
    assert.throws(
      () =>
        module.bindings.delegate(refs.tenantId, userSubject(refs.users.auditor), {
          subject: userSubject(refs.users.contractor),
          roleCode: "auditor",
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.roleNotAssignable,
    );
  });

  it("refuses to delegate outside the actor's own scope", () => {
    const { module, refs } = seeded();
    const scoped = createActiveUser(module, refs.tenantId, "scoped@northwind.example", "Scoped");
    module.bindings.grant(refs.tenantId, {
      subject: userSubject(scoped),
      roleCode: "user_manager",
      scope: refs.scopes.emea,
      delegable: true,
    });
    assert.throws(
      () =>
        module.bindings.delegate(refs.tenantId, userSubject(scoped), {
          subject: userSubject(refs.users.contractor),
          roleCode: "user_manager",
          scope: refs.scopes.amer,
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.roleNotAssignable,
    );
    const inside = module.bindings.delegate(refs.tenantId, userSubject(scoped), {
      subject: userSubject(refs.users.contractor),
      roleCode: "user_manager",
      scope: refs.scopes.emeaHamburg,
    });
    assert.equal(inside.scope, refs.scopes.emeaHamburg);
  });
});

describe("queries over bindings", () => {
  it("returns direct and group-inherited bindings for a user", () => {
    const { module, refs } = seeded();
    const effective = module.bindings.effectiveFor(refs.tenantId, userSubject(refs.users.emeaManager));
    const subjects = new Set(effective.map((binding) => subjectKey(binding.subject)));
    assert.ok(subjects.has(subjectKey(userSubject(refs.users.emeaManager))));
    assert.ok(subjects.has(subjectKey(groupSubject(refs.groups.emeaSales))));
  });

  it("lists every subject holding a role at or above a scope", () => {
    const { module, refs } = seeded();
    const holders = module.bindings.subjectsWithRole(
      refs.tenantId,
      roleCodeOf("member"),
      refs.scopes.emeaHamburg,
    );
    const keys = holders.map(subjectKey);
    assert.ok(keys.includes(subjectKey(groupSubject(refs.groups.allEmployees))));
  });

  it("filters by scope prefix", () => {
    const { module, refs } = seeded();
    const emea = module.bindings.list(refs.tenantId, { scopePrefix: "tenant/bu:emea" });
    assert.ok(emea.length >= 2);
    assert.ok(emea.every((binding) => binding.scope.startsWith("tenant/bu:emea")));
  });

  it("revokes everything a subject holds in one call", () => {
    const { module, refs } = seeded();
    const revoked = module.bindings.revokeAllFor(refs.tenantId, userSubject(refs.users.emeaManager), {
      reason: "left the company",
    });
    assert.ok(revoked >= 1);
    assert.equal(
      module.bindings.list(refs.tenantId, {
        subject: userSubject(refs.users.emeaManager),
        activeOnly: true,
      }).length,
      0,
    );
  });
});

describe("groups", () => {
  it("rejects a parent link that would create a cycle", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const parent = module.groups.create(tenantId, { name: "Parent" });
    const child = module.groups.create(tenantId, { name: "Child", parentGroupId: parent.id });
    assert.ok(wouldCreateGroupCycle(module.groups.list(tenantId), parent.id, child.id));
    assert.throws(
      () => module.groups.setParent(tenantId, parent.id, child.id),
      (error: IdentityError) => error.code === IDENTITY_ERROR.groupCycle,
    );
  });

  it("refuses local membership edits on an externally managed group", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = createActiveUser(module, tenantId, "sync@acme.test");
    const group = module.groups.create(tenantId, {
      name: "Directory Group",
      externallyManaged: true,
    });
    assert.throws(() => module.groups.addMember(tenantId, group.id, user));
    const synced = module.groups.syncMembers(tenantId, group.id, [user]);
    assert.equal(synced.added, 1);
  });

  it("reports what a directory sync changed", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const a = createActiveUser(module, tenantId, "a@acme.test");
    const b = createActiveUser(module, tenantId, "b@acme.test");
    const group = module.groups.create(tenantId, { name: "Team", memberUserIds: [a] });
    const result = module.groups.syncMembers(tenantId, group.id, [b]);
    assert.deepEqual({ added: result.added, removed: result.removed }, { added: 1, removed: 1 });
  });

  it("revokes a deleted group's bindings", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const group = module.groups.create(tenantId, { name: "Doomed" });
    module.bindings.grant(tenantId, { subject: groupSubject(group.id), roleCode: "member" });
    const result = module.groups.delete(tenantId, group.id);
    assert.equal(result.revokedBindings, 1);
    assert.throws(() => module.groups.get(tenantId, group.id), NotFoundError);
  });

  it("refuses to delete a group that still has children", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const parent = module.groups.create(tenantId, { name: "Parent" });
    module.groups.create(tenantId, { name: "Child", parentGroupId: parent.id });
    assert.throws(() => module.groups.delete(tenantId, parent.id));
  });
});

describe("scoped binding coverage", () => {
  it("covers only scopes at or beneath the binding", () => {
    const { module, refs } = seeded();
    const binding = module.bindings.list(refs.tenantId, {
      subject: userSubject(refs.users.emeaManager),
      activeOnly: true,
    })[0];
    assert.ok(binding.covers(refs.scopes.emea));
    assert.ok(binding.covers(refs.scopes.emeaHamburg));
    assert.ok(!binding.covers(scopePath("tenant")));
    assert.ok(!binding.covers(refs.scopes.amer));
  });
});
