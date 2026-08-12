import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DECISION_REASON } from "../src/domain/decision.js";
import { AuthorizationDeniedError } from "../src/domain/errors.js";
import { grantPattern, patternsIntersect } from "../src/domain/permission-key.js";
import { ROOT_SCOPE, scopePath } from "../src/domain/scope.js";
import { apiKeySubject, userSubject } from "../src/domain/subject.js";
import { effectiveGrantScope } from "../src/application/policy/evaluator.js";
import { PermissionSet, can, requireAny } from "../src/rbac/helpers.js";
import { emptyTenant, makeModule, principalFor, seeded } from "./helpers.js";

describe("effectiveGrantScope", () => {
  const emea = scopePath("tenant/bu:emea");
  const hamburg = scopePath("tenant/bu:emea/site:hamburg");
  const amer = scopePath("tenant/bu:amer");

  it("uses the binding scope when the grant is unscoped", () => {
    assert.equal(effectiveGrantScope(emea, ROOT_SCOPE), emea);
  });

  it("takes whichever of the two is narrower", () => {
    assert.equal(effectiveGrantScope(ROOT_SCOPE, emea), emea);
    assert.equal(effectiveGrantScope(emea, hamburg), hamburg);
    assert.equal(effectiveGrantScope(hamburg, emea), hamburg);
  });

  it("yields nothing when the two are disjoint", () => {
    assert.equal(effectiveGrantScope(emea, amer), undefined);
  });
});

describe("authorization decisions", () => {
  it("allows a permission held through a direct binding", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.securityAdmin);
    const decision = module.authorization.check(principal, "identity.role_binding:grant");
    assert.ok(decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.allowedByGrant);
    assert.equal(decision.matched?.roleCode, "security_admin");
  });

  it("reports the superuser reason for a **:* grant", () => {
    const { module, refs } = seeded();
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.owner),
      "sales.order:approve",
    );
    assert.ok(decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.allowedBySuperuser);
  });

  it("denies a permission nobody granted", () => {
    const { module, refs } = seeded();
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.salesRep),
      "identity.role:delete",
    );
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedNoGrant);
  });

  it("lets an explicit deny beat a wildcard allow", () => {
    const { module, refs } = seeded();
    // tenant_admin has identity.**:* but an explicit deny on tenant suspension.
    module.bindings.grant(refs.tenantId, {
      subject: userSubject(refs.users.emeaManager),
      roleCode: "tenant_admin",
    });
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.emeaManager),
      "identity.tenant:suspend",
    );
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedByExplicitDeny);
    assert.equal(decision.matched?.effect, "deny");
  });

  it("keeps a scoped grant inside its scope", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.emeaManager);
    assert.ok(
      module.authorization.check(principal, "sales.order:approve", { scope: refs.scopes.emea })
        .allowed,
    );
    assert.ok(
      module.authorization.check(principal, "sales.order:approve", {
        scope: refs.scopes.emeaHamburg,
      }).allowed,
      "a grant at EMEA covers the Hamburg site beneath it",
    );
    const outside = module.authorization.check(principal, "sales.order:approve", {
      scope: refs.scopes.amer,
    });
    assert.ok(!outside.allowed);
    assert.equal(outside.reason, DECISION_REASON.deniedScope);
  });

  it("denies a tenant-wide request from a scoped binding", () => {
    const { module, refs } = seeded();
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.emeaManager),
      "sales.order:approve",
      { scope: ROOT_SCOPE },
    );
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedScope);
  });

  it("grants permissions inherited through group membership", () => {
    const { module, refs } = seeded();
    // salesRep holds no direct binding for user management; EMEA Sales does.
    const direct = module.bindings.list(refs.tenantId, {
      subject: userSubject(refs.users.salesRep),
      activeOnly: true,
    });
    assert.equal(direct.length, 0);
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.salesRep),
      "identity.user:invite",
      { scope: refs.scopes.emea },
    );
    assert.ok(decision.allowed);
    assert.equal(decision.matched?.subject.type, "group");
  });

  it("follows a parent group when the child grants nothing", () => {
    const { module, refs } = seeded();
    // "All Employees" is the parent of "EMEA Sales" and carries the member role.
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.salesRep),
      "srm.supplier:read",
    );
    assert.ok(decision.allowed);
    assert.equal(decision.matched?.roleCode, "member");
  });

  it("stops granting once the user leaves the group", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.salesRep);
    assert.ok(module.authorization.can(principal, "srm.supplier:read"));
    module.groups.removeMember(refs.tenantId, refs.groups.emeaSales, refs.users.salesRep);
    module.groups.removeMember(refs.tenantId, refs.groups.allEmployees, refs.users.salesRep);
    assert.ok(!module.authorization.can(principal, "srm.supplier:read"));
  });

  it("denies everything once the tenant is suspended", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.owner);
    assert.ok(module.authorization.can(principal, "identity.user:read"));
    module.tenants.suspend(refs.tenantId, "non-payment");
    const decision = module.authorization.check(principal, "identity.user:read");
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedTenantInactive);
  });

  it("denies a suspended user even where the binding survives", () => {
    const { module, refs } = seeded();
    module.users.suspend(refs.tenantId, refs.users.auditor, "leave of absence");
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.auditor),
      "identity.audit:read",
    );
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedSubjectInactive);
  });

  it("denies an unregistered permission rather than silently failing to match", () => {
    const { module, refs } = seeded();
    const decision = module.authorization.check(
      principalFor(refs.tenantId, refs.users.owner),
      "made.up:permission",
    );
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedUnknownPermission);
  });
});

describe("time-boxed bindings", () => {
  it("stops granting the moment the binding lapses", () => {
    const { module, clock, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.contractor);
    const options = { scope: refs.scopes.emeaHamburg };
    assert.ok(module.authorization.can(principal, "sales.order:read", options));

    clock.advanceHours(73);
    const decision = module.authorization.check(principal, "sales.order:read", options);
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedBindingExpired);
  });

  it("lists bindings that lapse inside a window and can extend them", () => {
    const { module, clock, refs } = seeded();
    assert.equal(module.bindings.expiringWithin(refs.tenantId, 24).length, 0);
    clock.advanceHours(50);
    const expiring = module.bindings.expiringWithin(refs.tenantId, 24);
    assert.ok(expiring.length >= 1);

    const binding = expiring[0];
    module.bindings.extend(refs.tenantId, binding.id, undefined);
    assert.equal(module.bindings.get(refs.tenantId, binding.id).validUntil, undefined);
    assert.equal(module.bindings.expiringWithin(refs.tenantId, 24).length, expiring.length - 1);
  });

  it("sweeps lapsed bindings into a revoked state", () => {
    const { module, clock, refs } = seeded();
    clock.advanceHours(80);
    assert.equal(module.bindings.sweepExpired(refs.tenantId), 1);
    assert.equal(module.bindings.sweepExpired(refs.tenantId), 0, "sweeping twice is a no-op");
  });
});

describe("API key restrictions", () => {
  it("caps a key at its scope-down list even when the role allows more", () => {
    const { module, refs } = seeded();
    const principal = {
      tenantId: refs.tenantId,
      subject: apiKeySubject(refs.apiKey.id),
      displayName: "warehouse-sync",
      apiKeyId: refs.apiKey.id,
      restrictions: [grantPattern("sales.order:read")],
      amr: ["api_key" as const],
      mfaSatisfied: false,
    };
    assert.ok(
      module.authorization.can(principal, "sales.order:read", { scope: refs.scopes.emeaHamburg }),
    );
    const denied = module.authorization.check(principal, "prm.partner:read", {
      scope: refs.scopes.emeaHamburg,
    });
    assert.ok(!denied.allowed);
    assert.equal(denied.reason, DECISION_REASON.deniedCredentialRestriction);
  });

  it("denies a revoked key regardless of its bindings", () => {
    const { module, refs } = seeded();
    module.apiKeys.revoke(refs.tenantId, refs.apiKey.id, { reason: "rotated out" });
    const principal = {
      tenantId: refs.tenantId,
      subject: apiKeySubject(refs.apiKey.id),
      displayName: "warehouse-sync",
      apiKeyId: refs.apiKey.id,
      amr: ["api_key" as const],
      mfaSatisfied: false,
    };
    const decision = module.authorization.check(principal, "sales.order:read");
    assert.ok(!decision.allowed);
    assert.equal(decision.reason, DECISION_REASON.deniedSubjectInactive);
  });
});

describe("explanation and introspection", () => {
  it("returns a readable trace naming the deciding role", () => {
    const { module, refs } = seeded();
    const decision = module.authorization.explain(
      principalFor(refs.tenantId, refs.users.emeaManager),
      "sales.order:approve",
      { scope: refs.scopes.amer },
    );
    assert.ok(!decision.allowed);
    assert.ok(decision.trace && decision.trace.length > 0);
    assert.ok(decision.trace.some((line) => line.includes("does not cover")));
  });

  it("lists the concrete permissions a subject holds at a scope", () => {
    const { module, refs } = seeded();
    const keys = module.authorization.grantedPermissionKeys(
      refs.tenantId,
      userSubject(refs.users.auditor),
    );
    assert.ok(keys.includes("identity.audit:read" as never));
    assert.ok(keys.includes("platform.report:export" as never));
    assert.ok(!keys.includes("identity.user:deactivate" as never));
  });

  it("finds every subject that can exercise a permission", () => {
    const { module, refs } = seeded();
    const subjects = module.authorization.subjectsWithPermission(
      refs.tenantId,
      "identity.audit:read",
    );
    const ids = subjects.map((subject) => subject.id);
    assert.ok(ids.includes(refs.users.auditor));
    assert.ok(ids.includes(refs.users.owner));
    assert.ok(!ids.includes(refs.users.contractor));
  });

  it("summarizes effective patterns with the role each came from", () => {
    const { module, refs } = seeded();
    const patterns = module.authorization.effectivePermissions(
      refs.tenantId,
      userSubject(refs.users.emeaManager),
      refs.scopes.emea,
    );
    assert.ok(patterns.some((entry) => entry.permission === "sales.order:approve"));
    assert.ok(patterns.some((entry) => entry.effect === "deny"));
  });

  /**
   * A UI drives its menus off the introspection list, so anything it reports must survive
   * an actual check — otherwise a restricted API key is shown actions it cannot perform.
   */
  it("never reports a permission the same credential would be denied", () => {
    const { module, refs } = seeded();
    const key = module.apiKeys.get(refs.tenantId, refs.apiKey.id);
    const principal = module.authentication.authenticateBearer(refs.apiKey.token);
    assert.ok(key.restrictions.length > 0);

    const reported = module.authorization.permissionsForPrincipal(principal);
    assert.ok(reported.length > 0);
    for (const permission of reported) {
      assert.ok(
        module.authorization.can(principal, permission),
        `${permission} was reported but is denied`,
      );
    }
  });

  it("drops patterns outside a credential's scope-down list", () => {
    const { module, refs } = seeded();
    const subject = apiKeySubject(refs.apiKey.id);
    const unrestricted = module.authorization.effectivePermissions(refs.tenantId, subject);
    const restricted = module.authorization.effectivePermissions(refs.tenantId, subject, ROOT_SCOPE, [
      grantPattern("sales.order:read"),
    ]);

    assert.ok(unrestricted.length > restricted.length);
    assert.ok(
      restricted.every((entry) =>
        patternsIntersect(grantPattern("sales.order:read"), entry.permission),
      ),
    );
  });
});

describe("decision caching", () => {
  it("serves a repeated check from cache", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.owner);
    module.authorization.check(principal, "identity.user:read");
    const before = module.authorization.cacheStats();
    module.authorization.check(principal, "identity.user:read");
    const after = module.authorization.cacheStats();
    assert.equal(after.hits, before.hits + 1);
  });

  it("invalidates when the policy changes", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "e@acme.test", displayName: "Eve" });
    module.users.activate(tenantId, { userId: user.id, password: "Sup3rSecret!Passphrase" });
    const principal = principalFor(tenantId, user.id);

    assert.ok(!module.authorization.can(principal, "identity.user:read"));
    module.bindings.grant(tenantId, {
      subject: userSubject(user.id),
      roleCode: "auditor",
    });
    assert.ok(
      module.authorization.can(principal, "identity.user:read"),
      "granting a role must invalidate the cached denial",
    );

    const binding = module.bindings.list(tenantId, { subject: userSubject(user.id) })[0];
    module.bindings.revoke(tenantId, binding.id, { reason: "test" });
    assert.ok(!module.authorization.can(principal, "identity.user:read"));
  });
});

describe("RBAC helpers", () => {
  it("throws with the permission and scope in the error", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.contractor);
    assert.throws(
      () => module.authorization.require(principal, "identity.role:delete"),
      (error: AuthorizationDeniedError) => {
        assert.equal(error.status, 403);
        assert.equal(error.permission, "identity.role:delete");
        assert.equal(error.scope, ROOT_SCOPE);
        return true;
      },
    );
  });

  it("requireAny passes on the first held permission", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.auditor);
    const decision = requireAny(module.authorization, principal, [
      "identity.role:delete",
      "identity.audit:read",
    ]);
    assert.ok(decision.allowed);
    assert.throws(
      () => requireAny(module.authorization, principal, ["identity.role:delete", "identity.user:deactivate"]),
      AuthorizationDeniedError,
    );
  });

  it("can() answers without writing an audit entry", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.contractor);
    const before = module.audit.count(refs.tenantId, { category: "authz" });
    assert.ok(!can(module.authorization, principal, "identity.role:delete"));
    assert.equal(module.audit.count(refs.tenantId, { category: "authz" }), before);
  });

  it("builds a permission set a UI can query offline", () => {
    const { module, refs } = seeded();
    const set = PermissionSet.from(
      module.authorization,
      principalFor(refs.tenantId, refs.users.auditor),
    );
    assert.ok(set.has("identity.audit:read"));
    assert.ok(set.hasAll(["identity.audit:read", "identity.audit:export"]));
    assert.ok(set.hasAny(["identity.role:delete", "identity.audit:read"]));
    assert.ok(!set.has("identity.role:delete"));
    assert.ok(set.matching(grantPattern("identity.audit:*")).length >= 2);
    assert.equal(set.toJSON().scope, ROOT_SCOPE);
  });
});
