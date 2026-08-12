import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "../src/domain/errors.js";
import { Role, allow, deny, dedupeGrants, roleCodeOf } from "../src/domain/role.js";
import { resolveRole } from "../src/application/policy/effective-permissions.js";
import { RoleService } from "../src/application/role-service.js";
import { emptyTenant, makeModule } from "./helpers.js";

describe("Role aggregate", () => {
  const tenantId = "ten_test" as never;

  it("normalizes the code and rejects malformed ones", () => {
    assert.equal(roleCodeOf("  Sales_Manager "), "sales_manager");
    assert.throws(() => roleCodeOf("sales manager"), IdentityError);
    assert.throws(() => roleCodeOf("S"), IdentityError);
  });

  it("refuses to inherit from itself", () => {
    assert.throws(
      () =>
        Role.create({
          tenantId,
          code: "loop",
          name: "Loop",
          inherits: ["loop"],
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.roleCycle,
    );
  });

  it("raises a creation event carrying the grant count", () => {
    const role = Role.create({
      tenantId,
      code: "ops",
      name: "Ops",
      grants: [allow("sales.order:read"), allow("sales.order:create")],
    });
    const events = role.pullEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "identity.role.created");
    assert.equal((events[0].payload as { grantCount: number }).grantCount, 2);
  });

  it("rejects a duplicate grant", () => {
    const role = Role.create({ tenantId, code: "ops", name: "Ops", grants: [allow("sales.order:read")] });
    assert.throws(() => role.addGrant(allow("sales.order:read")), ConflictError);
  });

  it("treats the same permission at different scopes as different grants", () => {
    const role = Role.create({ tenantId, code: "ops", name: "Ops" });
    role.addGrant(allow("sales.order:approve", "tenant/bu:emea"));
    role.addGrant(allow("sales.order:approve", "tenant/bu:amer"));
    assert.equal(role.grants.length, 2);
  });

  it("refuses every edit to a system role", () => {
    const role = Role.create({ tenantId, code: "sys", name: "System", system: true });
    assert.throws(() => role.addGrant(allow("sales.order:read")), (error: IdentityError) =>
      error.code === IDENTITY_ERROR.systemRoleImmutable,
    );
    assert.throws(() => role.describe({ name: "Renamed" }), IdentityError);
    assert.throws(() => role.setInherits(["member"]), IdentityError);
  });

  it("clones a system role into an editable copy", () => {
    const system = Role.create({
      tenantId,
      code: "sys",
      name: "System",
      system: true,
      grants: [allow("sales.order:read")],
    });
    const clone = system.cloneAs("sys_custom", "System (custom)");
    assert.equal(clone.isSystem, false);
    assert.deepEqual(
      clone.grants.map((grant) => grant.permission),
      ["sales.order:read"],
    );
    clone.addGrant(allow("sales.order:create"));
    assert.equal(clone.grants.length, 2);
  });
});

describe("grant deduplication", () => {
  it("drops an allow already implied by a broader allow at the same scope", () => {
    const grants = dedupeGrants([allow("sales.**:*"), allow("sales.order:read")]);
    assert.deepEqual(
      grants.map((grant) => grant.permission),
      ["sales.**:*"],
    );
  });

  it("keeps a narrower allow when the broader one is scoped elsewhere", () => {
    const grants = dedupeGrants([
      allow("sales.**:*", "tenant/bu:amer"),
      allow("sales.order:read", "tenant/bu:emea"),
    ]);
    assert.equal(grants.length, 2);
  });

  it("never drops a deny", () => {
    const grants = dedupeGrants([allow("sales.**:*"), deny("sales.order:approve")]);
    assert.equal(grants.length, 2);
    assert.ok(grants.some((grant) => grant.effect === "deny"));
  });

  it("collapses exact duplicates", () => {
    assert.equal(dedupeGrants([allow("sales.order:read"), allow("sales.order:read")]).length, 1);
  });
});

describe("role inheritance", () => {
  it("flattens a chain and records the depth each grant came from", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.roles.create(tenantId, {
      code: "level_one",
      name: "Level One",
      grants: [{ permission: "sales.order:read" }],
    });
    module.roles.create(tenantId, {
      code: "level_two",
      name: "Level Two",
      inherits: ["level_one"],
      grants: [{ permission: "sales.order:create" }],
    });
    const resolved = module.roles.resolve(tenantId, roleCodeOf("level_two"));
    const byPermission = new Map(
      resolved.grants.map((grant) => [String(grant.permission), grant]),
    );
    assert.equal(byPermission.get("sales.order:create")?.inheritanceDepth, 0);
    assert.equal(byPermission.get("sales.order:read")?.inheritanceDepth, 1);
    assert.deepEqual([...resolved.ancestry].sort(), ["level_one", "level_two"]);
  });

  it("resolves a diamond once, at the shallowest depth", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.roles.create(tenantId, {
      code: "base",
      name: "Base",
      grants: [{ permission: "sales.order:read" }],
    });
    module.roles.create(tenantId, { code: "left", name: "Left", inherits: ["base"] });
    module.roles.create(tenantId, {
      code: "right",
      name: "Right",
      inherits: ["base"],
      grants: [{ permission: "sales.order:read" }],
    });
    module.roles.create(tenantId, { code: "top", name: "Top", inherits: ["left", "right"] });

    const resolved = module.roles.resolve(tenantId, roleCodeOf("top"));
    const reads = resolved.grants.filter((grant) => grant.permission === "sales.order:read");
    assert.equal(reads.length, 1);
    assert.equal(reads[0].inheritanceDepth, 1, "reached via right, which holds it directly");
  });

  it("detects a cycle introduced by an inheritance edit and leaves the role untouched", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.roles.create(tenantId, { code: "a_role", name: "Role A" });
    module.roles.create(tenantId, { code: "b_role", name: "Role B", inherits: ["a_role"] });
    assert.throws(
      () => module.roles.setInherits(tenantId, roleCodeOf("a_role"), ["b_role"]),
      (error: IdentityError) => error.code === IDENTITY_ERROR.roleCycle,
    );
    assert.deepEqual([...module.roles.get(tenantId, roleCodeOf("a_role")).inherits], []);
  });

  it("treats a binding to a deleted role as granting nothing", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const resolved = resolveRole(module.repositories.roles.map(tenantId), roleCodeOf("ghost_role"));
    assert.deepEqual(resolved.grants, []);
  });
});

describe("RoleService guards", () => {
  it("rejects a grant pattern that matches no registered permission", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    assert.throws(
      () =>
        module.roles.create(tenantId, {
          code: "typo",
          name: "Typo",
          grants: [{ permission: "sales.ordr:read" }],
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.unknownPermission,
    );
  });

  it("refuses to delete a role that still has an active binding", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, {
      email: "someone@acme.test",
      displayName: "Someone",
    });
    module.roles.create(tenantId, {
      code: "temp_role",
      name: "Temp",
      grants: [{ permission: "sales.order:read" }],
    });
    module.bindings.grant(tenantId, {
      subject: { type: "user", id: user.id },
      roleCode: "temp_role",
    });
    assert.throws(
      () => module.roles.delete(tenantId, roleCodeOf("temp_role")),
      (error: IdentityError) => error.code === IDENTITY_ERROR.roleInUse,
    );
  });

  it("refuses to delete a role another role inherits from", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.roles.create(tenantId, {
      code: "parent_role",
      name: "Parent",
      grants: [{ permission: "sales.order:read" }],
    });
    module.roles.create(tenantId, { code: "child_role", name: "Child", inherits: ["parent_role"] });
    assert.throws(
      () => module.roles.delete(tenantId, roleCodeOf("parent_role")),
      (error: IdentityError) => error.code === IDENTITY_ERROR.roleInUse,
    );
  });

  it("lists the roles that grant a permission, excluding those that deny it", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.roles.create(tenantId, {
      code: "approver",
      name: "Approver",
      grants: [{ permission: "sales.order:approve" }],
    });
    module.roles.create(tenantId, {
      code: "blocked",
      name: "Blocked",
      grants: [
        { permission: "sales.**:*" },
        { effect: "deny", permission: "sales.order:approve" },
      ],
    });
    const granting = module.roles.rolesGranting(tenantId, "sales.order:approve");
    assert.ok(granting.includes(roleCodeOf("approver")));
    assert.ok(!granting.includes(roleCodeOf("blocked")));
  });

  it("parses a grant expression written the way an operator would type it", () => {
    assert.deepEqual(RoleService.parseGrantExpression("deny sales.order:approve @ tenant/bu:amer"), {
      effect: "deny",
      permission: "sales.order:approve",
      scope: "tenant/bu:amer",
    });
    assert.deepEqual(RoleService.parseGrantExpression("sales.order:read"), {
      effect: "allow",
      permission: "sales.order:read",
      scope: undefined,
    });
  });
});
