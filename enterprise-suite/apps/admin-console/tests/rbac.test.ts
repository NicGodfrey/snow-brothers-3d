import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImmutableRecordError, InvalidStateError, ValidationError } from "../src/domain/errors.js";
import {
  expandPermission,
  permissionsForRoles,
  resolveRolePermissions,
  Role,
  type Permission,
} from "../src/domain/role.js";
import { AdminUser, INVITE_TTL_MS, normalizeEmail } from "../src/domain/user.js";
import { activeTenant, activeUser, harness, rejects, throwsSync, TEST_TENANT } from "./support.js";

const tenant = "northwind" as never;
const at = (iso: string) => iso as never;

function roleMap(...roles: Role[]): Map<string, Role> {
  return new Map(roles.map((role) => [role.code, role]));
}

describe("permissions", () => {
  it("expands the admin shorthand and the wildcard", () => {
    assert.deepEqual(expandPermission("user:read"), ["user:read"]);
    assert.deepEqual(expandPermission("user:admin").sort(), [
      "user:admin",
      "user:delete",
      "user:read",
      "user:write",
    ]);
    assert.ok(expandPermission("*").includes("audit:read"));
    assert.ok(expandPermission("*").includes("webhook:delete"));
  });

  it("rejects grants outside the catalogue", () => {
    const error = throwsSync(() =>
      Role.create(tenant, { code: "bad-role", name: "Bad", permissions: ["user:sudo"] }),
    );
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /permission/i);
  });

  it("resolves inheritance chains and unions across assigned roles", () => {
    const base = Role.create(tenant, { code: "base-reader", name: "Reader", permissions: ["tenant:read"] });
    const middle = Role.create(tenant, {
      code: "middle-writer",
      name: "Writer",
      permissions: ["user:write"],
      inheritsFrom: "base-reader",
    });
    const top = Role.create(tenant, {
      code: "top-operator",
      name: "Operator",
      permissions: ["webhook:admin"],
      inheritsFrom: "middle-writer",
    });
    const other = Role.create(tenant, { code: "auditor-lite", name: "Auditor", permissions: ["audit:read"] });
    const roles = roleMap(base, middle, top, other);

    const resolved = resolveRolePermissions("top-operator", roles);
    assert.ok(resolved.has("tenant:read"), "inherits transitively through two levels");
    assert.ok(resolved.has("user:write"));
    assert.ok(resolved.has("webhook:delete"), "webhook:admin expands to the whole resource");
    assert.equal(resolved.has("user:delete"), false);

    const union = permissionsForRoles(["top-operator", "auditor-lite"], roles);
    assert.ok(union.has("audit:read"));
    assert.ok(union.has("tenant:read"));
  });

  it("reports an inheritance cycle instead of looping forever", () => {
    const a = Role.create(tenant, { code: "cycle-a", name: "A", permissions: ["tenant:read"] });
    const b = Role.create(tenant, {
      code: "cycle-b",
      name: "B",
      permissions: ["user:read"],
      inheritsFrom: "cycle-a",
    });
    a.update({ inheritsFrom: "cycle-b" });

    const error = throwsSync(() => resolveRolePermissions("cycle-a", roleMap(a, b)));
    assert.ok(error instanceof InvalidStateError);
    assert.match(error.message, /cycle/i);
  });

  it("treats system roles as immutable", () => {
    const role = Role.create(tenant, {
      code: "tenant-admin",
      name: "Tenant Administrator",
      permissions: ["*"],
      system: true,
    });
    assert.throws(() => role.update({ name: "Renamed" }), ImmutableRecordError);
  });
});

describe("role service", () => {
  it("refuses to create a cycle through an existing role", async () => {
    const h = harness();
    await activeTenant(h);
    const { role } = h.container.services;

    await role.create(h.admin, {
      code: "planner",
      name: "Planner",
      permissions: ["reference-data:read"],
      inheritsFrom: "tenant-operator",
    });
    await role.create(h.admin, {
      code: "senior-planner",
      name: "Senior Planner",
      permissions: ["reference-data:write"],
      inheritsFrom: "planner",
    });

    const error = await rejects(() => role.update(h.admin, "planner", { inheritsFrom: "senior-planner" }));
    assert.match(error.message, /cycle/i);
    assert.equal(role.require(h.tenantId, "planner").inheritsFrom, "tenant-operator", "the change was rolled back");
  });

  it("will not delete a role that is still held or inherited", async () => {
    const h = harness();
    await activeTenant(h);
    const { role } = h.container.services;

    await role.create(h.admin, { code: "planner", name: "Planner", permissions: ["reference-data:read"] });
    await activeUser(h, "kim@northwind.example", ["planner"]);

    const held = await rejects(() => role.remove(h.admin, "planner"));
    assert.match(held.message, /still assigned to 1 user/);

    await h.container.services.user.assignRoles(h.admin, "kim@northwind.example", ["tenant-operator"]);
    await role.create(h.admin, {
      code: "senior-planner",
      name: "Senior Planner",
      permissions: ["reference-data:write"],
      inheritsFrom: "planner",
    });
    const inherited = await rejects(() => role.remove(h.admin, "planner"));
    assert.match(inherited.message, /inherited by senior-planner/);

    await role.remove(h.admin, "senior-planner");
    await role.remove(h.admin, "planner");
    assert.equal(role.list(h.tenantId).some((each) => each.code === "planner"), false);
  });

  it("clones a system role into an editable copy", async () => {
    const h = harness();
    await activeTenant(h);
    const { role } = h.container.services;

    const clone = await role.clone(h.admin, "tenant-operator", "site-operator", "Site Operator");
    assert.equal(clone.isSystem, false);
    assert.deepEqual(
      [...clone.permissions],
      [...role.require(h.tenantId, "tenant-operator").permissions],
    );
    clone.update({ name: "Renamed" });
    assert.equal(clone.name, "Renamed");
  });

  it("counts holders per role for the console matrix", async () => {
    const h = harness();
    await activeTenant(h);
    await activeUser(h, "ada@northwind.example", ["tenant-admin"]);
    await activeUser(h, "kim@northwind.example", ["tenant-operator"]);

    const matrix = h.container.services.role.matrix(h.tenantId);
    const admin = matrix.find((row) => row.code === "tenant-admin");
    assert.equal(admin?.userCount, 1);
    assert.ok((admin?.permissions.length ?? 0) > 10, "the matrix shows resolved, not authored, permissions");
  });
});

describe("user aggregate", () => {
  it("normalises addresses and rejects malformed ones", () => {
    assert.equal(normalizeEmail("  Ada@Northwind.Example "), "ada@northwind.example");
    assert.throws(() => normalizeEmail("ada@northwind"), ValidationError);
    assert.throws(() => normalizeEmail("ada at northwind.example"), ValidationError);
  });

  it("expires an invitation on the clock rather than on a sweeper", () => {
    const invitedAt = "2026-03-01T09:00:00.000Z";
    const user = AdminUser.invite(tenant, {
      email: "ada@northwind.example",
      displayName: "Ada Whitfield",
      roles: ["tenant-admin"],
      invitedBy: "ops",
      invitedAt: at(invitedAt),
      inviteToken: "token-abcdefghijklmnop",
    });

    const justInside = new Date(Date.parse(invitedAt) + INVITE_TTL_MS - 1_000).toISOString();
    const justOutside = new Date(Date.parse(invitedAt) + INVITE_TTL_MS + 1_000).toISOString();
    assert.equal(user.isInviteExpired(at(justInside)), false);
    assert.equal(user.isInviteExpired(at(justOutside)), true);

    const expired = throwsSync(() => user.acceptInvite("token-abcdefghijklmnop", at(justOutside)));
    assert.ok(expired instanceof InvalidStateError);

    assert.throws(() => user.acceptInvite("wrong-token", at(justInside)), InvalidStateError);
    user.acceptInvite("token-abcdefghijklmnop", at(justInside));
    assert.equal(user.status, "active");
    assert.equal(
      user.toPublicJSON()["inviteTokenPresent"],
      false,
      "the token is consumed and never serialised",
    );
    assert.throws(() => user.acceptInvite("token-abcdefghijklmnop", at(justInside)), InvalidStateError);
  });

  it("enforces the membership transition table", () => {
    const user = AdminUser.invite(tenant, {
      email: "kim@northwind.example",
      displayName: "Kim",
      roles: ["tenant-operator"],
      invitedBy: "ops",
      invitedAt: at("2026-03-01T09:00:00.000Z"),
      inviteToken: "token-abcdefghijklmnop",
    });

    assert.throws(() => user.suspend("early", at("2026-03-01T10:00:00.000Z")), InvalidStateError);
    user.acceptInvite("token-abcdefghijklmnop", at("2026-03-01T10:00:00.000Z"));
    user.suspend("leave of absence", at("2026-03-02T09:00:00.000Z"));
    assert.equal(user.canAct, false);
    user.reinstate(at("2026-03-09T09:00:00.000Z"));
    assert.equal(user.canAct, true);
    user.deactivate(at("2026-04-01T09:00:00.000Z"));
    assert.throws(() => user.assignRoles(["tenant-admin"]), InvalidStateError);
  });

  it("deduplicates and lower-cases assigned roles", () => {
    const user = AdminUser.invite(tenant, {
      email: "kim@northwind.example",
      displayName: "Kim",
      roles: ["Tenant-Operator", "tenant-operator", " auditor "],
      invitedBy: "ops",
      invitedAt: at("2026-03-01T09:00:00.000Z"),
      inviteToken: "token-abcdefghijklmnop",
    });
    assert.deepEqual([...user.roles], ["auditor", "tenant-operator"]);
  });
});

describe("user service", () => {
  it("returns the invitation token exactly once", async () => {
    const h = harness();
    await activeTenant(h);
    const { user } = h.container.services;

    const invited = await user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });
    assert.ok(invited.inviteToken.length >= 16);
    assert.equal(user.require(h.tenantId, "ada@northwind.example").toPublicJSON()["inviteToken"], undefined);

    const reissued = await user.reissueInvite(h.admin, "ada@northwind.example");
    assert.notEqual(reissued.inviteToken, invited.inviteToken, "reissuing mints a fresh token");
    await rejects(() => user.acceptInvite(h.admin, "ada@northwind.example", invited.inviteToken));
    await user.acceptInvite(h.admin, "ada@northwind.example", reissued.inviteToken);
  });

  it("refuses roles the tenant has not defined", async () => {
    const h = harness();
    await activeTenant(h);
    const error = (await rejects(() =>
      h.container.services.user.invite(h.admin, {
        email: "ada@northwind.example",
        displayName: "Ada",
        roles: ["tenant-admin", "wizard"],
      }),
    )) as ValidationError;
    assert.ok(error instanceof ValidationError);
    assert.ok(
      error.issues.some((issue) => issue.message.includes("wizard")),
      "the unknown role is named in the issue list",
    );
  });

  it("protects the last active administrator from every route out", async () => {
    const h = harness();
    await activeTenant(h);
    const { user } = h.container.services;
    await activeUser(h, "ada@northwind.example", ["tenant-admin"]);
    await activeUser(h, "kim@northwind.example", ["tenant-operator"]);

    for (const attempt of [
      () => user.suspend(h.admin, "ada@northwind.example", "holiday"),
      () => user.deactivate(h.admin, "ada@northwind.example"),
      () => user.assignRoles(h.admin, "ada@northwind.example", ["tenant-operator"]),
    ]) {
      const error = await rejects(attempt);
      assert.match(error.message, /last active administrator/i);
    }

    // A second administrator makes all three legal again.
    await user.assignRoles(h.admin, "kim@northwind.example", ["tenant-admin"]);
    await user.suspend(h.admin, "ada@northwind.example", "holiday");
    assert.equal(user.require(h.tenantId, "ada@northwind.example").status, "suspended");
  });

  it("does not count invited or suspended administrators as cover", async () => {
    const h = harness();
    await activeTenant(h);
    const { user } = h.container.services;
    await activeUser(h, "ada@northwind.example", ["tenant-admin"]);
    await user.invite(h.admin, {
      email: "pending@northwind.example",
      displayName: "Pending",
      roles: ["tenant-admin"],
    });

    const error = await rejects(() => user.suspend(h.admin, "ada@northwind.example", "holiday"));
    assert.match(error.message, /last active administrator/i);
  });

  it("resolves effective permissions through the role graph", async () => {
    const h = harness();
    await activeTenant(h);
    await h.container.services.role.create(h.admin, {
      code: "integration-engineer",
      name: "Integration Engineer",
      permissions: ["webhook:admin"],
      inheritsFrom: "tenant-operator",
    });
    await activeUser(h, "raj@northwind.example", ["integration-engineer"]);

    const granted = h.container.services.user.effectivePermissions(h.tenantId, "raj@northwind.example");
    assert.ok(granted.includes("webhook:delete"), "webhook:admin expands");
    assert.ok(granted.includes("reference-data:write"), "inherited from tenant-operator");
    assert.equal(granted.includes("user:delete" as Permission), false);
  });

  it("keeps quota enforcement on invitations", async () => {
    const h = harness({ tenantKey: TEST_TENANT });
    await h.container.services.tenant.provision(h.platform, {
      key: TEST_TENANT,
      name: "Northwind",
      plan: "trial",
    });
    await h.container.services.tenant.activate(h.platform, TEST_TENANT);

    for (let i = 0; i < 10; i += 1) {
      await h.container.services.user.invite(h.admin, {
        email: `user${i}@northwind.example`,
        displayName: `User ${i}`,
        roles: ["tenant-operator"],
      });
    }
    const error = await rejects(() =>
      h.container.services.user.invite(h.admin, {
        email: "overflow@northwind.example",
        displayName: "Overflow",
        roles: ["tenant-operator"],
      }),
    );
    assert.match(error.message, /users/);
  });
});
