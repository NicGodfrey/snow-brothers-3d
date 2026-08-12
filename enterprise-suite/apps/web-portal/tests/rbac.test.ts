import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenError } from "@enterprise-suite/shared-kernel";
import { PermissionSet, expandGrants, findRole } from "../src/domain/rbac.js";

describe("RBAC", () => {
  it("expands inherited roles transitively", () => {
    const grants = expandGrants(["sales-manager"]);
    // sales-manager -> sales-rep -> viewer
    assert.ok(grants.has("sales:approve"));
    assert.ok(grants.has("sales:write"));
    assert.ok(grants.has("*:read"));
  });

  it("ignores unknown roles instead of throwing", () => {
    const grants = expandGrants(["not-a-role", "viewer"]);
    assert.deepEqual([...grants], ["*:read"]);
  });

  it("matches wildcards in resource and action position", () => {
    const viewer = PermissionSet.fromRoles(["viewer"]);
    assert.ok(viewer.has("finance:read"));
    assert.ok(!viewer.has("finance:write"));

    const admin = PermissionSet.fromRoles(["tenant-admin"]);
    assert.ok(admin.has("finance:close"));
    assert.ok(admin.has("*"));

    const scoped = PermissionSet.fromGrants(["sales:*"]);
    assert.ok(scoped.has("sales:approve"));
    assert.ok(!scoped.has("srm:approve"));
  });

  it("does not let a wildcard action satisfy a wildcard request", () => {
    // "*:read" must not be treated as full admin.
    const viewer = PermissionSet.fromRoles(["viewer"]);
    assert.ok(!viewer.has("*"));
  });

  it("treats an undefined requirement as allowed", () => {
    assert.ok(PermissionSet.fromGrants([]).has(undefined));
  });

  it("require() raises ForbiddenError with the missing permission", () => {
    const buyer = PermissionSet.fromRoles(["buyer"]);
    assert.ok(buyer.has("srm:write"));
    assert.throws(
      () => buyer.require("finance:close"),
      (error: unknown) =>
        error instanceof ForbiddenError && /finance:close/.test((error as Error).message),
    );
  });

  it("hasAny / hasAll behave over lists", () => {
    const clerk = PermissionSet.fromRoles(["warehouse-clerk"]);
    assert.ok(clerk.hasAny(["inventory:write", "finance:close"]));
    assert.ok(!clerk.hasAll(["inventory:write", "finance:close"]));
    assert.ok(clerk.hasAny([]));
  });

  it("publishes readable role metadata for the sign-in screen", () => {
    const role = findRole("controller");
    assert.equal(role?.label, "Controller");
    assert.ok(role?.inherits?.includes("accountant"));
  });
});
