import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuditEntry, matchesAuditQuery, redact, REDACTED, summarizeAudit } from "../src/domain/audit.js";
import { ALL_EVENT_TYPES, EVENT_NAMESPACES, isKnownEventType } from "../src/domain/events.js";
import { activeTenant, activeUser, harness } from "./support.js";

const tenant = "northwind" as never;
const at = (iso: string) => iso as never;

function entry(overrides: Record<string, unknown> = {}) {
  return createAuditEntry({
    tenantId: tenant,
    at: at("2026-03-01T09:00:00.000Z"),
    actor: "ada@northwind.example",
    actorRoles: ["tenant-admin"],
    action: "webhook.register",
    resourceType: "WebhookSubscription",
    resourceId: "wh_1",
    ...overrides,
  } as never);
}

describe("redaction", () => {
  it("strips anything that looks like a credential, at any depth", () => {
    const redacted = redact({
      name: "Ops bridge",
      secret: "super-secret",
      headers: { authorization: "Bearer abc", "x-environment": "production" },
      nested: [{ apiKey: "k-1" }, { inviteToken: "t-1" }, { password: "hunter2" }],
      credentials: { api_key: "k-2" },
    }) as Record<string, any>;

    assert.equal(redacted["name"], "Ops bridge");
    assert.equal(redacted["secret"], REDACTED);
    assert.equal(redacted["headers"].authorization, REDACTED);
    assert.equal(redacted["headers"]["x-environment"], "production");
    assert.equal(redacted["nested"][0].apiKey, REDACTED);
    assert.equal(redacted["nested"][1].inviteToken, REDACTED);
    assert.equal(redacted["nested"][2].password, REDACTED);
    assert.equal(redacted["credentials"], REDACTED);
    assert.equal(JSON.stringify(redacted).includes("super-secret"), false);
  });

  it("passes primitives, null and undefined through untouched", () => {
    assert.equal(redact("plain"), "plain");
    assert.equal(redact(7), 7);
    assert.equal(redact(null), null);
    assert.equal(redact(undefined), undefined);
    assert.deepEqual(redact([1, "two"]), [1, "two"]);
  });

  it("redacts on the way in, so a secret never reaches storage", () => {
    const recorded = entry({ after: { secret: "shhh", url: "https://hooks.example/h" } });
    assert.deepEqual(recorded.after, { secret: REDACTED, url: "https://hooks.example/h" });
    assert.equal(recorded.outcome, "success", "outcome defaults to success");
  });
});

describe("audit queries", () => {
  const entries = [
    entry({ action: "user.invite", actor: "ada@northwind.example", resourceId: "u1" }),
    entry({ action: "user.suspend", actor: "kim@northwind.example", resourceId: "u2", outcome: "denied" }),
    entry({ action: "webhook.register", actor: "ada@northwind.example", at: at("2026-04-01T09:00:00.000Z") }),
  ];

  it("matches on prefix for actions and exact values elsewhere", () => {
    assert.equal(matchesAuditQuery(entries[0]!, { action: "user." }), true);
    assert.equal(matchesAuditQuery(entries[2]!, { action: "user." }), false);
    assert.equal(matchesAuditQuery(entries[1]!, { outcome: "denied" }), true);
    assert.equal(matchesAuditQuery(entries[1]!, { actor: "ada@northwind.example" }), false);
    assert.equal(matchesAuditQuery(entries[0]!, { resourceType: "WebhookSubscription" }), true);
  });

  it("filters by time window and free text", () => {
    assert.equal(matchesAuditQuery(entries[2]!, { from: "2026-03-15T00:00:00.000Z" }), true);
    assert.equal(matchesAuditQuery(entries[0]!, { from: "2026-03-15T00:00:00.000Z" }), false);
    assert.equal(matchesAuditQuery(entries[0]!, { to: "2026-03-15T00:00:00.000Z" }), true);
    assert.equal(matchesAuditQuery(entries[1]!, { search: "KIM" }), true, "search is case insensitive");
    assert.equal(matchesAuditQuery(entries[1]!, { search: "nothing here" }), false);
  });

  it("summarises by outcome, action and actor", () => {
    const summary = summarizeAudit(entries);
    assert.equal(summary.total, 3);
    assert.deepEqual(summary.byOutcome, { success: 2, denied: 1, error: 0 });
    assert.equal(summary.byAction["user.invite"], 1);
    assert.deepEqual(summary.topActors[0], { actor: "ada@northwind.example", count: 2 });
  });
});

describe("event catalogue", () => {
  it("names every event `admin.<aggregate>.<past-tense>`", () => {
    for (const type of ALL_EVENT_TYPES) {
      assert.match(type, /^admin\.[a-z-]+\.[a-z-]+$/, type);
    }
    assert.equal(new Set(ALL_EVENT_TYPES).size, ALL_EVENT_TYPES.length, "no duplicate event types");
  });

  it("derives the subscribable namespaces from the catalogue", () => {
    assert.deepEqual(
      [...EVENT_NAMESPACES].sort(),
      ["admin.feature-flag", "admin.reference-data", "admin.role", "admin.tenant", "admin.user", "admin.webhook"],
    );
    assert.equal(isKnownEventType("admin.user.invited"), true);
    assert.equal(isKnownEventType("admin.user.deleted"), false);
  });
});

describe("audit service", () => {
  it("writes one entry per state-changing command, and none for reads", async () => {
    const h = harness();
    await activeTenant(h);
    const { audit, user } = h.container.services;

    const afterSetup = audit.query(h.tenantId, {}).total;
    user.list(h.tenantId);
    audit.summary(h.tenantId);
    assert.equal(audit.query(h.tenantId, {}).total, afterSetup, "reads leave no trace");

    await activeUser(h, "kim@northwind.example");
    const actions = audit.query(h.tenantId, { resourceType: "AdminUser" }).items.map((e) => e.action);
    assert.deepEqual(actions, ["user.accept-invite", "user.invite"]);
  });

  it("keeps the before and after snapshot of a change", async () => {
    const h = harness();
    await activeTenant(h);
    await h.container.services.tenant.changePlan(h.platform, "northwind", "enterprise");

    const change = h.container.services.audit.query(h.tenantId, { action: "tenant.change-plan" }).items[0];
    assert.equal((change?.before as { plan: string }).plan, "standard");
    assert.equal((change?.after as { plan: string }).plan, "enterprise");
    assert.equal(change?.requestId, h.platform.requestId);
    assert.equal(change?.sourceIp, undefined, "the platform context carries no client ip");
  });

  it("orders newest first even when commands land in the same millisecond", async () => {
    const h = harness();
    await activeTenant(h);
    const { featureFlag, audit } = h.container.services;

    for (const key of ["flag-a", "flag-b", "flag-c"]) {
      await featureFlag.create(h.admin, { key, name: key });
    }
    const created = audit.query(h.tenantId, { action: "feature-flag.create" });
    assert.deepEqual(
      created.items.map((each) => each.resourceId),
      ["flag-c", "flag-b", "flag-a"],
    );
  });

  it("keeps one tenant's log out of another's", async () => {
    const h = harness();
    await activeTenant(h);
    await h.container.services.tenant.provision(
      { ...h.platform, tenantId: "southwind" as never },
      { key: "southwind", name: "Southwind Ltd" },
    );

    assert.equal(h.container.services.audit.query("southwind" as never, {}).total, 1);
    assert.equal(
      h.container.services.audit
        .query(h.tenantId, {})
        .items.every((each) => String(each.tenantId) === "northwind"),
      true,
    );
  });
});
