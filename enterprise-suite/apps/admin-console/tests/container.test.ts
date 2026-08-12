import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContainer } from "../src/infrastructure/container.js";
import { SequentialSecretGenerator } from "../src/infrastructure/crypto.js";
import { FixedClock } from "../src/infrastructure/memory-repositories.js";
import { RecordingWebhookSender } from "../src/infrastructure/webhook-sender.js";
import { seedDemoData, SEED_TENANT_KEY } from "../src/infrastructure/seed.js";
import { activeTenant, harness } from "./support.js";

/**
 * The composition root: what gets wired to what, and the one behaviour that
 * only exists at this level — domain events becoming webhook deliveries.
 */

describe("outbox to webhook bridge", () => {
  it("queues a delivery for a matching subscription without the command knowing", async () => {
    const h = harness();
    await activeTenant(h);
    await h.container.services.webhook.register(h.admin, {
      name: "Ops",
      url: "https://hooks.northwind.example/events",
      eventFilters: ["admin.user.*"],
    });

    // The user service has no reference to the webhook service.
    await h.container.services.user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });

    const report = await h.container.services.webhook.drain();
    assert.equal(report.delivered, 1);
    assert.equal(h.sender.sent[0]?.headers["x-webhook-event"], "admin.user.invited");
  });

  it("can be switched off, leaving the outbox to another consumer", async () => {
    const h = harness({ bridgeEventsToWebhooks: false });
    await activeTenant(h);
    await h.container.services.webhook.register(h.admin, {
      name: "Ops",
      url: "https://hooks.northwind.example/events",
      eventFilters: ["admin.user.*"],
    });
    await h.container.services.user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });

    assert.equal((await h.container.services.webhook.drain()).attempted, 0);
    assert.equal(
      h.container.outbox.ofType(h.tenantId, "admin.user.invited").length,
      1,
      "the event is still recorded for whoever consumes the outbox",
    );
  });

  it("stops bridging after dispose", async () => {
    const h = harness();
    await activeTenant(h);
    await h.container.services.webhook.register(h.admin, {
      name: "Ops",
      url: "https://hooks.northwind.example/events",
      eventFilters: ["admin.user.*"],
    });

    h.container.dispose();
    await h.container.services.user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });
    assert.equal((await h.container.services.webhook.drain()).attempted, 0);
  });
});

describe("demo seed", () => {
  it("produces a tenant that is immediately usable", async () => {
    const clock = new FixedClock("2026-03-01T09:00:00.000Z");
    const container = createContainer({
      clock,
      sender: new RecordingWebhookSender(clock),
      secrets: new SequentialSecretGenerator(),
    });
    const seeded = await seedDemoData(container);
    const tenantId = seeded.tenantId;

    assert.equal(seeded.tenantKey, SEED_TENANT_KEY);
    assert.equal(container.services.tenant.require(SEED_TENANT_KEY).status, "active");

    const users = container.services.user.list(tenantId);
    assert.deepEqual(
      users.map((user) => `${user.email}:${user.status}`).sort(),
      [
        "ada@northwind.example:active",
        "mei@northwind.example:invited",
        "raj@northwind.example:active",
      ],
    );
    assert.equal(
      Object.keys(seeded.inviteTokens).length,
      3,
      "every minted invitation token is returned to the caller once",
    );

    const roles = container.services.role.list(tenantId);
    assert.equal(roles.filter((role) => !role.isSystem).length, 1);

    const sets = container.services.referenceData.list(tenantId);
    assert.equal(sets.length, 2);
    assert.ok(sets.every((set) => set.status === "published"));
    assert.equal(container.services.referenceData.tree(tenantId, "site-hierarchy").length, 2);

    const flags = container.services.featureFlag.list(tenantId);
    assert.deepEqual(
      flags.map((flag) => flag.key),
      ["invoice-pdf-template", "mrp-parallel-run", "new-order-workspace"],
    );

    assert.equal(container.services.webhook.list(tenantId).length, 1);
    assert.ok(container.services.audit.query(tenantId, {}).total > 10);
    container.dispose();
  });

  it("is deterministic given a fixed clock and sequential secrets", async () => {
    const run = async () => {
      const clock = new FixedClock("2026-03-01T09:00:00.000Z");
      const container = createContainer({
        clock,
        sender: new RecordingWebhookSender(clock),
        secrets: new SequentialSecretGenerator(),
      });
      const seeded = await seedDemoData(container);
      container.dispose();
      return Object.values(seeded.inviteTokens).sort();
    };

    assert.deepEqual(await run(), await run());
  });
});
