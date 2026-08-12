import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DECISION_REASON } from "../src/domain/decision.js";
import { userSubject } from "../src/domain/subject.js";
import { emptyTenant, makeModule, principalFor, SEED_PASSWORD, seeded } from "./helpers.js";

describe("authorization auditing", () => {
  it("records every denial, whatever the tenant's audit setting", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "n@acme.test", displayName: "Nobody" });
    module.users.activate(tenantId, { userId: user.id, password: SEED_PASSWORD });
    assert.equal(module.tenants.settings(tenantId).auditAllDecisions, false);

    module.authorization.check(principalFor(tenantId, user.id), "identity.role:delete");
    const denials = module.audit.list(tenantId, { category: "authz", outcome: "deny" });
    assert.equal(denials.length, 1);
    assert.equal(denials[0].permission, "identity.role:delete");
    assert.equal(denials[0].reason, DECISION_REASON.deniedNoGrant);
  });

  it("records allows only when the tenant opts in", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const user = module.users.invite(tenantId, { email: "y@acme.test", displayName: "Yes" });
    module.users.activate(tenantId, { userId: user.id, password: SEED_PASSWORD });
    module.bindings.grant(tenantId, { subject: userSubject(user.id), roleCode: "auditor" });
    const principal = principalFor(tenantId, user.id);

    module.authorization.check(principal, "identity.audit:read");
    assert.equal(module.audit.count(tenantId, { category: "authz", outcome: "allow" }), 0);

    module.tenants.updateSettings(tenantId, { auditAllDecisions: true });
    module.authorization.check(principal, "identity.audit:read");
    assert.equal(module.audit.count(tenantId, { category: "authz", outcome: "allow" }), 1);
  });

  it("captures the matched role and the correlation id", () => {
    const { module, refs } = seeded();
    const correlationId = "req_trace_1" as never;
    module.authorization.check(
      principalFor(refs.tenantId, refs.users.auditor),
      "identity.audit:read",
      { correlationId },
    );
    const entry = module.audit.trace(refs.tenantId, correlationId)[0];
    assert.equal(entry.outcome, "allow");
    assert.equal(entry.metadata.matchedRole, "auditor");
  });

  it("keeps entries immutable and tenant-isolated", () => {
    const { module, refs } = seeded();
    const other = module.tenants.provision({ slug: "other", name: "Other Co", activate: true });
    module.authorization.check(
      principalFor(refs.tenantId, refs.users.contractor),
      "identity.role:delete",
    );
    assert.ok(module.audit.count(refs.tenantId, { category: "authz" }) > 0);
    assert.equal(module.audit.count(other.tenantId, { category: "authz" }), 0);
  });
});

describe("audit queries", () => {
  it("summarizes denials by permission and reason", () => {
    const { module, refs } = seeded();
    const principal = principalFor(refs.tenantId, refs.users.contractor);
    module.authorization.check(principal, "identity.role:delete");
    module.authorization.check(principal, "identity.role:delete", { scope: refs.scopes.emea });
    module.authorization.check(principal, "identity.user:deactivate");

    const summary = module.audit.denialSummary(refs.tenantId);
    const deleteRow = summary.find((row) => row.permission === "identity.role:delete");
    assert.equal(deleteRow?.count, 2);
    assert.equal(summary[0].count, 2, "the most frequent denial sorts first");
  });

  it("tallies allow and deny counts per subject", () => {
    const { module, refs } = seeded();
    module.authorization.check(principalFor(refs.tenantId, refs.users.auditor), "identity.audit:read");
    module.authorization.check(principalFor(refs.tenantId, refs.users.auditor), "identity.role:delete");

    const activity = module.audit.subjectActivity(refs.tenantId);
    const row = activity.find((entry) => entry.subject === `user:${refs.users.auditor}`);
    assert.ok(row);
    assert.equal(row.denies, 1);
    assert.ok(row.allows >= 1, "the seeded tenant audits allows too");
  });

  it("filters by subject, category and time window", () => {
    const { module, clock, refs } = seeded();
    const before = clock.now();
    clock.advanceHours(1);
    module.authorization.check(
      principalFor(refs.tenantId, refs.users.contractor),
      "identity.role:delete",
    );

    assert.equal(
      module.audit.list(refs.tenantId, {
        subject: userSubject(refs.users.contractor),
        category: "authz",
      }).length,
      1,
    );
    assert.equal(
      module.audit.list(refs.tenantId, { category: "authz", to: before }).length,
      0,
      "entries after the window are excluded",
    );
  });

  it("returns pages newest first", () => {
    const { module, clock, refs } = seeded();
    for (let i = 0; i < 5; i += 1) {
      clock.advanceMinutes(1);
      module.authorization.check(
        principalFor(refs.tenantId, refs.users.contractor),
        "identity.role:delete",
      );
    }
    const page = module.audit.page(refs.tenantId, { page: 1, pageSize: 3 }, { category: "authz" });
    assert.equal(page.items.length, 3);
    assert.ok(page.items[0].at > page.items[1].at);
  });

  it("exports newline-delimited JSON", () => {
    const { module, refs } = seeded();
    module.authorization.check(
      principalFor(refs.tenantId, refs.users.contractor),
      "identity.role:delete",
    );
    const lines = module.audit
      .exportNdjson(refs.tenantId, { category: "authz" })
      .split("\n")
      .filter((line) => line.length > 0);
    assert.ok(lines.length >= 1);
    assert.equal(JSON.parse(lines[0]).category, "authz");
  });
});

describe("administrative auditing", () => {
  it("records who granted a role binding and why", () => {
    const { module, refs } = seeded();
    module.bindings.grant(refs.tenantId, {
      subject: userSubject(refs.users.contractor),
      roleCode: "auditor",
      grantedBy: refs.users.owner,
      reason: "covering annual audit",
    });
    const entry = module.audit.list(refs.tenantId, { action: "admin.role_binding.granted" })[0];
    assert.equal(entry.actorId, refs.users.owner);
    assert.equal(entry.metadata.roleCode, "auditor");
  });

  it("records user administration", () => {
    const { module, refs } = seeded();
    module.users.suspend(refs.tenantId, refs.users.contractor, "policy breach", refs.users.owner);
    const entries = module.audit.list(refs.tenantId, { action: "admin.user.suspended" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].resourceId, refs.users.contractor);
  });

  it("renders a one-line log form", () => {
    const { module, refs } = seeded();
    module.authorization.check(
      principalFor(refs.tenantId, refs.users.contractor),
      "identity.role:delete",
    );
    const line = module.audit.recentDenials(refs.tenantId, 1)[0].toLogLine();
    assert.ok(line.includes("AUTHZ"));
    assert.ok(line.includes("identity.role:delete"));
    assert.ok(line.includes(DECISION_REASON.deniedNoGrant));
  });
});
