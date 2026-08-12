import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError } from "@enterprise-suite/shared-kernel";
import { checkPasswordComplexity, DEFAULT_PASSWORD_POLICY } from "../src/domain/credential.js";
import { IDENTITY_ERROR, IdentityError } from "../src/domain/errors.js";
import { emptyTenant, makeModule, SEED_PASSWORD, seeded } from "./helpers.js";

const STRONG = "An0ther!Str0ngPass";

describe("password policy", () => {
  it("reports every violated rule at once", () => {
    const complaints = checkPasswordComplexity("short", DEFAULT_PASSWORD_POLICY);
    const rules = complaints.map((complaint) => complaint.rule);
    assert.ok(rules.includes("minLength"));
    assert.ok(rules.includes("requireUppercase"));
    assert.ok(rules.includes("requireDigit"));
  });

  it("accepts a password meeting the tenant policy", () => {
    assert.deepEqual(checkPasswordComplexity(STRONG, DEFAULT_PASSWORD_POLICY), []);
  });
});

describe("user invitation and activation", () => {
  it("invites a user in the invited state with no credential", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, {
      email: "  New.User@Acme.test ",
      displayName: "New User",
    });
    assert.equal(user.email, "new.user@acme.test");
    assert.equal(user.status, "invited");
    assert.equal(user.password, undefined);
  });

  it("rejects a duplicate email regardless of casing", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.users.invite(tenantId, { email: "dup@acme.test", displayName: "First" });
    assert.throws(
      () => module.users.invite(tenantId, { email: "DUP@acme.test", displayName: "Second" }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.emailTaken,
    );
  });

  it("enforces the tenant email domain allowlist", () => {
    const { module } = makeModule();
    const tenant = module.tenants.provision({
      slug: "walled",
      name: "Walled Garden",
      activate: true,
      settings: { allowedEmailDomains: ["walled.example"] },
    });
    assert.throws(
      () =>
        module.users.invite(tenant.tenantId, {
          email: "outsider@elsewhere.test",
          displayName: "Outsider",
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.emailDomainNotAllowed,
    );
    const inside = module.users.invite(tenant.tenantId, {
      email: "insider@sub.walled.example",
      displayName: "Insider",
    });
    assert.equal(inside.status, "invited", "subdomains of an allowed domain are accepted");
  });

  it("rejects a weak password with every complaint attached", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "weak@acme.test", displayName: "Weak" });
    assert.throws(
      () => module.users.activate(tenantId, { userId: user.id, password: "abc" }),
      (error: IdentityError) => {
        assert.equal(error.code, IDENTITY_ERROR.weakPassword);
        assert.equal(error.status, 422);
        assert.ok(Array.isArray(error.details));
        return true;
      },
    );
  });

  it("activates with a password and verifies it against the stored digest", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "ok@acme.test", displayName: "Okay" });
    module.users.activate(tenantId, { userId: user.id, password: STRONG });

    const stored = module.users.get(tenantId, user.id);
    assert.equal(stored.status, "active");
    assert.ok(stored.password);
    assert.ok(!JSON.stringify(stored.password).includes(STRONG), "plaintext must never be stored");
    assert.ok(module.passwordHasher.verify(STRONG, stored.password));
    assert.ok(!module.passwordHasher.verify("wrong", stored.password));
  });
});

describe("password changes", () => {
  it("rejects reuse of a password still in history", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "hist@acme.test", displayName: "Hist" });
    module.users.activate(tenantId, { userId: user.id, password: STRONG });
    module.users.setPassword(tenantId, { userId: user.id, password: "Rotated!Passw0rd1" });

    assert.throws(
      () => module.users.setPassword(tenantId, { userId: user.id, password: STRONG }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.passwordReused,
    );
  });

  it("requires the current password for a self-service change", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "self@acme.test", displayName: "Self" });
    module.users.activate(tenantId, { userId: user.id, password: STRONG });

    assert.throws(
      () =>
        module.users.changePassword(tenantId, {
          userId: user.id,
          currentPassword: "not-it",
          newPassword: "Brand!New1Pass",
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.invalidCredentials,
    );
    module.users.changePassword(tenantId, {
      userId: user.id,
      currentPassword: STRONG,
      newPassword: "Brand!New1Pass",
    });
    assert.ok(module.passwordHasher.verify("Brand!New1Pass", module.users.get(tenantId, user.id).password!));
  });

  it("signs the user out everywhere after a self-service change", () => {
    const { module, refs } = seeded();
    module.authentication.loginWithPassword(refs.tenantId, {
      email: "raj.rep@northwind.example",
      password: SEED_PASSWORD,
    });
    assert.equal(module.sessions.listForUser(refs.tenantId, refs.users.salesRep, { activeOnly: true }).length, 1);

    module.users.changePassword(refs.tenantId, {
      userId: refs.users.salesRep,
      currentPassword: SEED_PASSWORD,
      newPassword: "Rotated!Passw0rd2",
    });
    assert.equal(
      module.sessions.listForUser(refs.tenantId, refs.users.salesRep, { activeOnly: true }).length,
      0,
    );
  });

  it("flags an expired password for rotation at next sign-in", () => {
    const { module, clock } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "old@acme.test", displayName: "Old" });
    module.users.activate(tenantId, { userId: user.id, password: STRONG });
    const policy = module.tenants.settings(tenantId).passwordPolicy;

    assert.ok(!module.users.get(tenantId, user.id).requirePasswordRotation(policy, clock.now()));
    clock.advanceDays(policy.maxAgeDays + 1);
    assert.ok(module.users.get(tenantId, user.id).requirePasswordRotation(policy, clock.now()));
  });
});

describe("lockout", () => {
  it("locks after the configured number of failures inside the window", () => {
    const { module, clock, refs } = seeded();
    const attempt = () =>
      assert.throws(() =>
        module.authentication.loginWithPassword(refs.tenantId, {
          email: "ava.auditor@northwind.example",
          password: "wrong",
        }),
      );
    attempt();
    attempt();
    assert.equal(module.users.get(refs.tenantId, refs.users.auditor).failedAttempts, 2);
    attempt();

    const locked = module.users.get(refs.tenantId, refs.users.auditor);
    assert.ok(locked.isLockedAt(clock.now()));
    assert.throws(
      () =>
        module.authentication.loginWithPassword(refs.tenantId, {
          email: "ava.auditor@northwind.example",
          password: SEED_PASSWORD,
        }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.userLocked,
    );
  });

  it("forgets failures that fall outside the attempt window", () => {
    const { module, clock, refs } = seeded();
    const policy = module.tenants.settings(refs.tenantId).lockoutPolicy;
    const user = module.users.get(refs.tenantId, refs.users.auditor);

    user.recordFailedLogin(clock.now(), policy);
    user.recordFailedLogin(clock.now(), policy);
    assert.equal(user.failedAttempts, 2);

    clock.advanceSeconds(policy.attemptWindowSeconds + 1);
    user.recordFailedLogin(clock.now(), policy);
    assert.equal(user.failedAttempts, 1, "the counter restarts outside the window");
  });

  it("clears the lock automatically once the lockout elapses", () => {
    const { module, clock, refs } = seeded();
    for (let i = 0; i < 3; i += 1) {
      assert.throws(() =>
        module.authentication.loginWithPassword(refs.tenantId, {
          email: "ava.auditor@northwind.example",
          password: "wrong",
        }),
      );
    }
    clock.advanceSeconds(module.tenants.settings(refs.tenantId).lockoutPolicy.lockoutSeconds + 1);
    const result = module.authentication.loginWithPassword(refs.tenantId, {
      email: "ava.auditor@northwind.example",
      password: SEED_PASSWORD,
    });
    assert.ok(result.token);
    assert.equal(module.users.get(refs.tenantId, refs.users.auditor).failedAttempts, 0);
  });

  it("unlocks on demand", () => {
    const { module, clock, refs } = seeded();
    for (let i = 0; i < 3; i += 1) {
      assert.throws(() =>
        module.authentication.loginWithPassword(refs.tenantId, {
          email: "ava.auditor@northwind.example",
          password: "wrong",
        }),
      );
    }
    module.users.unlock(refs.tenantId, refs.users.auditor, refs.users.owner);
    assert.ok(!module.users.get(refs.tenantId, refs.users.auditor).isLockedAt(clock.now()));
  });
});

describe("user lifecycle", () => {
  it("suspends, reactivates and deactivates", () => {
    const { module, refs } = seeded();
    module.users.suspend(refs.tenantId, refs.users.contractor, "engagement paused");
    assert.equal(module.users.get(refs.tenantId, refs.users.contractor).status, "suspended");

    module.users.reactivate(refs.tenantId, refs.users.contractor);
    assert.equal(module.users.get(refs.tenantId, refs.users.contractor).status, "active");

    module.users.deactivate(refs.tenantId, refs.users.contractor, "engagement ended");
    const gone = module.users.get(refs.tenantId, refs.users.contractor);
    assert.equal(gone.status, "deactivated");
    assert.equal(gone.password, undefined, "credentials are dropped on deactivation");
    assert.throws(() => module.users.reactivate(refs.tenantId, refs.users.contractor), ConflictError);
  });

  it("never exposes credential material in the public projection", () => {
    const { module, refs } = seeded();
    const json = module.users.get(refs.tenantId, refs.users.owner).toPublicJSON();
    const serialized = JSON.stringify(json);
    assert.ok(!serialized.includes("password"));
    assert.ok(!serialized.includes("hashB64"));
    assert.equal(json.email, "ada.owner@northwind.example");
  });

  it("keeps a renamed email findable", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "before@acme.test", displayName: "Before" });
    module.users.changeEmail(tenantId, user.id, "after@acme.test");
    assert.equal(module.users.findByEmail(tenantId, "after@acme.test")?.id, user.id);
    assert.equal(module.users.findByEmail(tenantId, "before@acme.test"), undefined);
  });

  it("stores an MFA enrollment as a digest only", () => {
    const { module, refs } = seeded();
    const user = module.users.enrollMfa(refs.tenantId, {
      userId: refs.users.owner,
      method: "totp",
      label: "iPhone",
      secret: "JBSWY3DPEHPK3PXP",
    });
    assert.ok(user.mfaEnabled);
    assert.ok(!JSON.stringify(user.mfa).includes("JBSWY3DPEHPK3PXP"));
    assert.throws(
      () =>
        module.users.enrollMfa(refs.tenantId, {
          userId: refs.users.owner,
          method: "totp",
          label: "iPhone",
          secret: "JBSWY3DPEHPK3PXP",
        }),
      ConflictError,
    );
  });

  it("pages and filters the user list", () => {
    const { module, refs } = seeded();
    const page = module.users.page(refs.tenantId, { page: 1, pageSize: 2 });
    assert.equal(page.items.length, 2);
    assert.equal(page.total, 6);
    assert.equal(module.users.list(refs.tenantId, { search: "manager" }).length, 1);
    assert.equal(module.users.list(refs.tenantId, { status: "active" }).length, 6);
  });
});
