import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eventMatches, isValidEventFilter } from "../src/domain/events.js";
import { ValidationError } from "../src/domain/errors.js";
import {
  CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_RETRY_POLICY,
  WebhookDelivery,
  WebhookSubscription,
} from "../src/domain/webhook.js";
import { HmacSigner, isFreshSignature, verifySignature } from "../src/infrastructure/crypto.js";
import { activeTenant, harness, rejects } from "./support.js";

const tenant = "northwind" as never;
const at = (iso: string) => iso as never;

async function registered(h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) {
  return h.container.services.webhook.register(h.admin, {
    name: "Ops event bridge",
    url: "https://hooks.northwind.example/events",
    eventFilters: ["admin.user.*"],
    ...overrides,
  } as never);
}

describe("event filters", () => {
  it("matches exact types, namespace wildcards and the catch-all", () => {
    assert.equal(eventMatches("admin.user.invited", "admin.user.invited"), true);
    assert.equal(eventMatches("admin.user.*", "admin.user.invited"), true);
    assert.equal(eventMatches("admin.user.*", "admin.tenant.activated"), false);
    assert.equal(eventMatches("*", "admin.tenant.activated"), true);
    assert.equal(eventMatches("admin.user.*", "admin.user"), false, "the prefix must be followed by a segment");
  });

  it("rejects a filter that would silently never fire", () => {
    assert.equal(isValidEventFilter("admin.user.invited"), true);
    assert.equal(isValidEventFilter("admin.tenant.*"), true);
    assert.equal(isValidEventFilter("admin.user.inivted"), false, "a typo is a validation error, not a dead filter");
    assert.equal(isValidEventFilter("admin.unicorn.*"), false);
    assert.equal(
      isValidEventFilter("admin.*"),
      false,
      "matching is prefix-based, so the validator is what keeps filters to known namespaces",
    );
  });
});

describe("webhook subscription", () => {
  it("requires https except on loopback, and a usable secret", () => {
    const base = { name: "Ops", eventFilters: ["admin.user.*"], secret: "0123456789abcdef" };
    assert.throws(() => WebhookSubscription.register(tenant, { ...base, url: "http://evil.example/hook" }), ValidationError);
    assert.throws(() => WebhookSubscription.register(tenant, { ...base, url: "not-a-url" }), ValidationError);
    assert.throws(
      () => WebhookSubscription.register(tenant, { ...base, url: "https://ok.example/h", secret: "short" }),
      ValidationError,
    );

    const loopback = WebhookSubscription.register(tenant, { ...base, url: "http://localhost:9000/hook" });
    assert.equal(loopback.status, "active");
  });

  it("refuses headers the dispatcher owns", () => {
    assert.throws(
      () =>
        WebhookSubscription.register(tenant, {
          name: "Ops",
          url: "https://hooks.example/h",
          secret: "0123456789abcdef",
          eventFilters: ["admin.user.*"],
          headers: { "X-Webhook-Signature": "spoofed" },
        }),
      ValidationError,
    );
  });

  it("only shows interest while it is active", () => {
    const webhook = WebhookSubscription.register(tenant, {
      name: "Ops",
      url: "https://hooks.example/h",
      secret: "0123456789abcdef",
      eventFilters: ["admin.user.*"],
    });

    assert.equal(webhook.isInterestedIn("admin.user.invited"), true);
    assert.equal(webhook.isInterestedIn("admin.tenant.activated"), false);
    webhook.pause("maintenance");
    assert.equal(webhook.isInterestedIn("admin.user.invited"), false, "a paused hook stops queueing work");
    webhook.resume();
    assert.equal(webhook.isInterestedIn("admin.user.invited"), true);
  });

  it("trips its breaker after enough consecutive failures", () => {
    const webhook = WebhookSubscription.register(tenant, {
      name: "Ops",
      url: "https://hooks.example/h",
      secret: "0123456789abcdef",
      eventFilters: ["admin.user.*"],
    });

    for (let i = 1; i < CIRCUIT_BREAKER_THRESHOLD; i += 1) {
      assert.equal(webhook.recordFailure(at("2026-03-01T09:00:00.000Z"), "HTTP 500"), false);
      assert.equal(webhook.status, "active");
    }
    assert.equal(webhook.recordFailure(at("2026-03-01T09:00:00.000Z"), "HTTP 500"), true);
    assert.equal(webhook.status, "paused");

    webhook.resume();
    assert.equal(webhook.consecutiveFailures, 0, "resuming clears the counter");
  });

  it("resets the failure streak on any success", () => {
    const webhook = WebhookSubscription.register(tenant, {
      name: "Ops",
      url: "https://hooks.example/h",
      secret: "0123456789abcdef",
      eventFilters: ["admin.user.*"],
    });
    webhook.recordFailure(at("2026-03-01T09:00:00.000Z"), "HTTP 500");
    webhook.recordFailure(at("2026-03-01T09:00:01.000Z"), "HTTP 500");
    webhook.recordSuccess(at("2026-03-01T09:00:02.000Z"));

    assert.equal(webhook.consecutiveFailures, 0);
    assert.deepEqual(webhook.stats, {
      deliveries: 3,
      failures: 2,
      lastDeliveryAt: "2026-03-01T09:00:02.000Z",
    });
  });

  it("never serialises the secret", () => {
    const webhook = WebhookSubscription.register(tenant, {
      name: "Ops",
      url: "https://hooks.example/h",
      secret: "super-secret-value-0123",
      eventFilters: ["admin.user.*"],
    });
    const json = webhook.toPublicJSON();
    assert.equal(json["secret"], undefined);
    assert.equal(json["secretHint"], "supe…23");
    assert.equal(JSON.stringify(json).includes("super-secret-value"), false);
  });
});

describe("delivery retry schedule", () => {
  it("backs off exponentially and caps at the ceiling", () => {
    const delivery = new WebhookDelivery(
      tenant,
      "wh_1" as never,
      "evt_1" as never,
      "admin.user.invited",
      { email: "ada@northwind.example" },
      at("2026-03-01T09:00:00.000Z"),
      { maxAttempts: 6, initialBackoffMs: 30_000, backoffFactor: 3, maxBackoffMs: 600_000 },
    );

    const waits: number[] = [];
    let now = Date.parse("2026-03-01T09:00:00.000Z");
    for (let i = 0; i < 5; i += 1) {
      delivery.fail(new Date(now).toISOString() as never, "HTTP 500", 500, 12);
      waits.push(Date.parse(delivery.nextAttemptAt) - now);
      now = Date.parse(delivery.nextAttemptAt);
    }

    assert.deepEqual(waits, [30_000, 90_000, 270_000, 600_000, 600_000]);
    assert.equal(delivery.status, "pending");

    delivery.fail(new Date(now).toISOString() as never, "HTTP 500", 500, 12);
    assert.equal(delivery.status, "dead", "the delivery stops after maxAttempts");
    assert.equal(delivery.attemptCount, 6);
  });

  it("is only due once its scheduled instant has passed", () => {
    const delivery = new WebhookDelivery(
      tenant,
      "wh_1" as never,
      "evt_1" as never,
      "admin.user.invited",
      {},
      at("2026-03-01T09:00:00.000Z"),
      DEFAULT_RETRY_POLICY,
    );

    assert.equal(delivery.isDue(at("2026-03-01T09:00:00.000Z")), true);
    delivery.fail(at("2026-03-01T09:00:00.000Z"), "HTTP 500", 500, 5);
    assert.equal(delivery.isDue(at("2026-03-01T09:00:10.000Z")), false);
    assert.equal(delivery.isDue(at("2026-03-01T09:00:30.000Z")), true);

    delivery.succeed(at("2026-03-01T09:00:30.000Z"), 200, 8);
    assert.equal(delivery.isDue(at("2026-03-01T10:00:00.000Z")), false, "a delivered payload is never re-sent");
  });
});

describe("webhook service", () => {
  it("signs the payload so a receiver can verify it", async () => {
    const h = harness();
    await activeTenant(h);
    const { secret } = await registered(h);

    await h.container.services.user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });
    const report = await h.container.services.webhook.drain();

    assert.equal(report.delivered, 1);
    const sent = h.sender.sent.at(-1)!;
    const signature = sent.headers["x-webhook-signature"]!;
    const timestamp = sent.headers["x-webhook-timestamp"]!;

    assert.ok(signature.startsWith("sha256="));
    assert.equal(verifySignature(new HmacSigner(), secret, timestamp, sent.body, signature), true);
    assert.equal(
      verifySignature(new HmacSigner(), "wrong-secret-0123", timestamp, sent.body, signature),
      false,
    );
    assert.equal(
      verifySignature(new HmacSigner(), secret, timestamp, `${sent.body} `, signature),
      false,
      "the body is inside the signed material",
    );
    assert.equal(isFreshSignature(timestamp, h.clock.nowMs()), true);
    assert.equal(isFreshSignature(timestamp, h.clock.nowMs() + 600_000), false);
  });

  it("delivers only to subscriptions whose filters match", async () => {
    const h = harness();
    await activeTenant(h);
    await registered(h, { name: "Users only", eventFilters: ["admin.user.*"] });
    await registered(h, {
      name: "Flags only",
      url: "https://hooks.northwind.example/flags",
      eventFilters: ["admin.feature-flag.toggled"],
    });

    await h.container.services.user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });
    await h.container.services.webhook.drain();

    assert.deepEqual(
      h.sender.sent.map((call) => call.url),
      ["https://hooks.northwind.example/events"],
    );
  });

  it("does not feed its own events back into the queue", async () => {
    const h = harness();
    await activeTenant(h);
    await registered(h, { eventFilters: ["*"] });

    await h.container.services.webhook.drain();
    assert.deepEqual(
      h.sender.sent.map((call) => call.headers["x-webhook-event"]),
      [],
      "registering a webhook must not deliver admin.webhook.registered to itself",
    );
  });

  it("retries a failing endpoint on schedule and dead-letters it in the end", async () => {
    const h = harness();
    await activeTenant(h);
    h.sender.respondWith("https://hooks.northwind.example", { statusCode: 500, durationMs: 9 });
    await registered(h, { retryPolicy: { maxAttempts: 3, initialBackoffMs: 60_000, backoffFactor: 2 } });

    await h.container.services.user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });

    const first = await h.container.services.webhook.drain();
    assert.deepEqual({ attempted: first.attempted, failed: first.failed }, { attempted: 1, failed: 1 });

    const tooSoon = await h.container.services.webhook.drain();
    assert.equal(tooSoon.attempted, 0, "the retry is not due yet");

    h.clock.advance(60_000);
    await h.container.services.webhook.drain();
    h.clock.advance(120_000);
    const last = await h.container.services.webhook.drain();

    assert.equal(last.dead, 1);
    assert.equal(h.sender.sent.length, 3, "exactly maxAttempts requests were made");
    assert.equal(h.container.services.webhook.deadLetters(h.tenantId).length, 1);
  });

  it("pauses a subscription once the breaker trips, and stops sending", async () => {
    const h = harness();
    await activeTenant(h);
    h.sender.respondWith("https://hooks.northwind.example", { statusCode: 503, durationMs: 4 });
    const { webhook } = await registered(h, {
      eventFilters: ["admin.user.*"],
      retryPolicy: { maxAttempts: 10, initialBackoffMs: 1_000, backoffFactor: 1 },
    });

    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD + 2; i += 1) {
      await h.container.services.user.invite(h.admin, {
        email: `user${i}@northwind.example`,
        displayName: `User ${i}`,
        roles: ["tenant-operator"],
      });
      await h.container.services.webhook.drain();
      h.clock.advance(2_000);
    }

    const after = h.container.services.webhook.require(h.tenantId, String(webhook.id));
    assert.equal(after.status, "paused");
    assert.match(String(after.toJSON()["pausedReason"]), /circuit breaker/);

    const sentBefore = h.sender.sent.length;
    await h.container.services.webhook.drain();
    assert.equal(h.sender.sent.length, sentBefore, "a paused subscription makes no further requests");
  });

  it("rotates a secret without exposing the old one", async () => {
    const h = harness();
    await activeTenant(h);
    const { webhook, secret } = await registered(h);

    const rotated = await h.container.services.webhook.rotateSecret(h.admin, String(webhook.id));
    assert.notEqual(rotated.secret, secret);

    const entry = h.container.services.audit
      .query(h.tenantId, { action: "webhook.rotate-secret" })
      .items[0];
    assert.equal(JSON.stringify(entry).includes(rotated.secret), false, "the audit log holds no secret");
  });

  it("sends a test delivery without disturbing the subscription's statistics", async () => {
    const h = harness();
    await activeTenant(h);
    const { webhook } = await registered(h);

    const result = await h.container.services.webhook.test(h.admin, String(webhook.id));
    assert.equal(result.delivered, true);
    assert.equal(h.sender.sent.at(-1)?.headers["x-webhook-event"], "admin.webhook.test");
    assert.deepEqual(
      h.container.services.webhook.require(h.tenantId, String(webhook.id)).stats,
      { deliveries: 0, failures: 0, lastDeliveryAt: undefined },
    );
  });

  it("fails a queued delivery whose subscription was paused in the meantime", async () => {
    const h = harness();
    await activeTenant(h);
    const { webhook } = await registered(h);

    await h.container.services.user.invite(h.admin, {
      email: "ada@northwind.example",
      displayName: "Ada",
      roles: ["tenant-admin"],
    });
    await h.container.services.webhook.pause(h.admin, String(webhook.id), "maintenance");

    const report = await h.container.services.webhook.drain();
    assert.equal(report.attempted, 1);
    assert.equal(report.delivered, 0);
    assert.equal(h.sender.sent.length, 0);
  });

  it("keeps deliveries inside the tenant that produced them", async () => {
    const h = harness();
    await activeTenant(h);
    await registered(h);

    const other = "southwind";
    await h.container.services.tenant.provision(
      { ...h.platform, tenantId: other as never },
      { key: other, name: "Southwind Ltd", plan: "trial" },
    );
    assert.deepEqual(h.container.services.webhook.list(other as never), []);

    const { webhook } = await registered(h, { url: "https://hooks.northwind.example/second" });
    const error = await rejects(() =>
      h.container.services.webhook.pause(
        { ...h.admin, tenantId: other as never },
        String(webhook.id),
        "cross tenant",
      ),
    );
    assert.match(error.message, /not found/i);
  });
});
