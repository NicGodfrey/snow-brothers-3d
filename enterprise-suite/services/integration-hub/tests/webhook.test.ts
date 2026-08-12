import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError, DomainError, NotFoundError } from "@enterprise-suite/shared-kernel";
import { IntegrationEventTypes } from "../src/domain/events.js";
import { DEFAULT_SECRET_GRACE_MS } from "../src/domain/webhook.js";
import { SIGNATURE_HEADER, verifySignature } from "../src/domain/signature.js";
import { epochSeconds } from "../src/domain/time.js";
import { activeWebhook, harness, ncrOpened, orderPlaced, otherTenantCtx } from "./helpers.js";

describe("webhook subscriptions", () => {
  it("registers an endpoint and hands back the secret exactly once", async () => {
    const h = harness();
    const { subscription, secret } = await h.hub.services.webhooks.create(h.ctx, {
      name: "partner-erp",
      endpointUrl: "https://partner.example.com/hooks",
      eventPatterns: ["quality.**", "sales.order.*"],
      headers: { "x-partner-key": "abc123" },
    });

    assert.equal(subscription.status, "active");
    assert.ok(secret.startsWith("whsec_"));
    assert.equal(subscription.maxAttempts, 8);
    assert.equal(subscription.timeoutMs, 10_000);

    const view = subscription.toPublicJSON();
    assert.equal(view["secret"], undefined);
    assert.equal(view["secretHint"], `${secret.slice(0, 10)}...`);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.WebhookSubscriptionCreated).length, 1);
  });

  it("rejects unusable endpoints and reserved headers", async () => {
    const h = harness();
    const create = (overrides: Record<string, unknown>) =>
      h.hub.services.webhooks.create(h.ctx, {
        name: `wh-${Math.random()}`,
        endpointUrl: "https://partner.example.com/hooks",
        eventPatterns: ["quality.**"],
        ...overrides,
      });

    await assert.rejects(() => create({ endpointUrl: "ftp://partner.example.com" }), DomainError);
    await assert.rejects(
      () => create({ endpointUrl: "https://user:pass@partner.example.com/hooks" }),
      /must not embed credentials/,
    );
    await assert.rejects(
      () => create({ endpointUrl: "https://partner.example.com/hooks#frag" }),
      /fragment/,
    );
    await assert.rejects(() => create({ headers: { "user-agent": "spoofed" } }), /cannot be overridden/);
    await assert.rejects(() => create({ headers: { "x-bad header": "v" } }), /invalid characters/);
    await assert.rejects(() => create({ headers: { "x-inject": "a\r\nb" } }), /invalid value/);
    await assert.rejects(() => create({ eventPatterns: [] }), /at least one event pattern/);
    await assert.rejects(() => create({ timeoutMs: 50 }), /timeoutMs/);
  });

  it("keeps names unique per tenant but not across tenants", async () => {
    const h = harness();
    await activeWebhook(h, { name: "partner-erp" });
    await assert.rejects(() => activeWebhook(h, { name: "partner-erp" }), ConflictError);

    const other = otherTenantCtx();
    const created = await h.hub.services.webhooks.create(other, {
      name: "partner-erp",
      endpointUrl: "https://other.example.com/hooks",
      eventPatterns: ["quality.**"],
    });
    assert.equal(created.subscription.name, "partner-erp");
    assert.equal((await h.hub.services.webhooks.list(h.ctx)).length, 1);
    assert.equal((await h.hub.services.webhooks.list(other)).length, 1);
  });

  it("matches events by pattern, including wildcards", async () => {
    const h = harness();
    const quality = await activeWebhook(h, { name: "quality-feed", patterns: ["quality.**"] });
    const orders = await activeWebhook(h, {
      name: "order-feed",
      patterns: ["sales.order.placed", "sales.order.cancelled"],
    });
    await activeWebhook(h, { name: "everything", patterns: ["**"] });

    const forNcr = await h.hub.services.webhooks.list(h.ctx, { eventType: "quality.ncr.opened" });
    assert.deepEqual(new Set(forNcr.map((s) => s.name)), new Set(["quality-feed", "everything"]));

    const forOrder = await h.hub.services.webhooks.list(h.ctx, { eventType: "sales.order.placed" });
    assert.deepEqual(new Set(forOrder.map((s) => s.name)), new Set(["order-feed", "everything"]));

    const forShipment = await h.hub.services.webhooks.list(h.ctx, { eventType: "logistics.shipment.booked" });
    assert.deepEqual(
      forShipment.map((s) => s.name),
      ["everything"],
    );
    assert.notEqual(String(quality.id), String(orders.id));
  });

  it("pauses, resumes, disables and re-enables", async () => {
    const h = harness();
    const { id } = await activeWebhook(h);
    const service = h.hub.services.webhooks;

    assert.equal((await service.pause(h.ctx, id)).status, "paused");
    await assert.rejects(() => service.enable(h.ctx, id), ConflictError);
    assert.equal((await service.resume(h.ctx, id)).status, "active");
    await assert.rejects(() => service.resume(h.ctx, id), ConflictError);

    const disabled = await service.disable(h.ctx, id, "partner offboarded");
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.disabledReason, "partner offboarded");
    await assert.rejects(() => service.pause(h.ctx, id), ConflictError);

    assert.equal((await service.enable(h.ctx, id)).status, "active");
    assert.deepEqual(h.recorder.types().filter((t) => t.startsWith("integration.webhook.subscription-")), [
      "integration.webhook.subscription-created",
      "integration.webhook.subscription-paused",
      "integration.webhook.subscription-resumed",
      "integration.webhook.subscription-disabled",
      "integration.webhook.subscription-updated",
    ]);
  });

  it("only deletes disabled subscriptions", async () => {
    const h = harness();
    const { id } = await activeWebhook(h);
    await assert.rejects(() => h.hub.services.webhooks.delete(h.ctx, id), ConflictError);

    await h.hub.services.webhooks.disable(h.ctx, id, "retired");
    await h.hub.services.webhooks.delete(h.ctx, id);
    await assert.rejects(() => h.hub.services.webhooks.get(h.ctx, id), NotFoundError);
  });

  it("accepts both secrets during the rotation grace window", async () => {
    const h = harness();
    const { id, secret: original } = await activeWebhook(h);
    const { secret: rotated } = await h.hub.services.webhooks.rotateSecret(h.ctx, id);
    assert.notEqual(rotated, original);

    const inGrace = await h.hub.services.webhooks.get(h.ctx, id);
    assert.deepEqual(inGrace.verificationSecrets(h.clock.now()), [rotated, original]);

    h.clock.advance(DEFAULT_SECRET_GRACE_MS + 1);
    assert.deepEqual(inGrace.verificationSecrets(h.clock.now()), [rotated]);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.WebhookSecretRotated).length, 1);
  });

  it("refuses to rotate onto the same or a too-short secret", async () => {
    const h = harness();
    const { id, secret } = await activeWebhook(h);
    await assert.rejects(
      () => h.hub.services.webhooks.rotateSecret(h.ctx, id, { secret }),
      ConflictError,
    );
    await assert.rejects(
      () => h.hub.services.webhooks.rotateSecret(h.ctx, id, { secret: "short" }),
      DomainError,
    );
  });

  it("hides other tenants' subscriptions", async () => {
    const h = harness();
    const { id } = await activeWebhook(h);
    await assert.rejects(() => h.hub.services.webhooks.get(otherTenantCtx(), id), NotFoundError);
  });
});

describe("webhook delivery", () => {
  it("fans an event out to every matching active subscription", async () => {
    const h = harness();
    await activeWebhook(h, { name: "quality-feed", patterns: ["quality.**"] });
    await activeWebhook(h, { name: "everything", patterns: ["**"] });
    const paused = await activeWebhook(h, { name: "paused-feed", patterns: ["quality.**"] });
    await h.hub.services.webhooks.pause(h.ctx, paused.id);
    await activeWebhook(h, { name: "sales-only", patterns: ["sales.**"] });

    const scheduled = await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    assert.equal(scheduled.length, 2);
    assert.ok(scheduled.every((d) => d.status === "pending"));
    assert.equal(h.recorder.ofType(IntegrationEventTypes.WebhookDeliveryScheduled).length, 2);
  });

  it("signs the body so the receiver can verify it", async () => {
    const h = harness();
    const { secret } = await activeWebhook(h, { patterns: ["quality.**"] });
    const event = ncrOpened(h.ctx);
    await h.hub.services.deliveries.scheduleForEvent(event);
    await h.hub.services.deliveries.dispatchDue();

    const request = h.transport.lastRequest()!;
    const header = request.headers[SIGNATURE_HEADER]!;
    const nowSeconds = epochSeconds(h.clock.now());

    assert.equal(verifySignature(header, request.body, [secret], { nowSeconds }).valid, true);
    assert.equal(verifySignature(header, `${request.body} `, [secret], { nowSeconds }).reason, "mismatch");
    assert.equal(verifySignature(header, request.body, ["whsec_other"], { nowSeconds }).reason, "mismatch");
    assert.equal(
      verifySignature(header, request.body, [secret], { nowSeconds: nowSeconds + 3_600 }).reason,
      "expired",
    );

    assert.equal(request.headers["x-es-event-type"], "quality.ncr.opened");
    assert.equal(request.headers["x-es-attempt"], "1");
    assert.equal(request.headers["x-es-tenant-id"], String(h.ctx.tenantId));
    assert.equal(JSON.parse(request.body).data.ncrNumber, "NCR-2026-000001");
  });

  it("signs with the new secret once rotated", async () => {
    const h = harness();
    const { id } = await activeWebhook(h, { patterns: ["quality.**"] });
    const { secret: rotated } = await h.hub.services.webhooks.rotateSecret(h.ctx, id);

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    await h.hub.services.deliveries.dispatchDue();

    const request = h.transport.lastRequest()!;
    const result = verifySignature(request.headers[SIGNATURE_HEADER]!, request.body, [rotated], {
      nowSeconds: epochSeconds(h.clock.now()),
    });
    assert.equal(result.valid, true);
    assert.equal(result.matchedSecretIndex, 0);
  });

  it("marks a 2xx as delivered and records the attempt", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"] });
    h.transport.enqueue({ status: 202, body: "accepted" });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    const summary = await h.hub.services.deliveries.dispatchDue();

    assert.deepEqual(summary, { attempted: 1, delivered: 1, retrying: 0, deadLettered: 0 });
    const [delivery] = await h.hub.services.deliveries.list(h.ctx);
    assert.equal(delivery!.status, "delivered");
    assert.equal(delivery!.attemptCount, 1);
    assert.equal(delivery!.lastAttempt?.statusCode, 202);
    assert.equal(delivery!.lastAttempt?.responseSnippet, "accepted");
    assert.equal(h.recorder.ofType(IntegrationEventTypes.WebhookDeliverySucceeded).length, 1);
  });

  it("retries 5xx with backoff and succeeds on a later attempt", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"], maxAttempts: 3 });
    h.transport.enqueue({ status: 503 }, { networkError: "ECONNRESET" }, { status: 200 });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));

    assert.equal((await h.hub.services.deliveries.dispatchDue()).retrying, 1);
    // Still backing off: 1s after the first failure.
    assert.equal((await h.hub.services.deliveries.dispatchDue()).attempted, 0);

    h.clock.advance(1_000);
    assert.equal((await h.hub.services.deliveries.dispatchDue()).retrying, 1);

    // Second backoff is 4x the first.
    h.clock.advance(1_000);
    assert.equal((await h.hub.services.deliveries.dispatchDue()).attempted, 0);
    h.clock.advance(3_000);
    assert.equal((await h.hub.services.deliveries.dispatchDue()).delivered, 1);

    const [delivery] = await h.hub.services.deliveries.list(h.ctx);
    assert.equal(delivery!.status, "delivered");
    assert.deepEqual(
      delivery!.attempts.map((a) => a.outcome),
      ["http-error", "network-error", "success"],
    );
    assert.equal(h.transport.callCount, 3);
  });

  it("dead-letters a 4xx immediately without burning the retry budget", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"], maxAttempts: 5 });
    h.transport.always({ status: 422, body: "unknown schema version" });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    const summary = await h.hub.services.deliveries.dispatchDue();

    assert.equal(summary.deadLettered, 1);
    const [delivery] = await h.hub.services.deliveries.list(h.ctx);
    assert.equal(delivery!.status, "dead-lettered");
    assert.equal(delivery!.attemptCount, 1);
    assert.match(delivery!.failureReason!, /permanent failure/);
    assert.equal(h.transport.callCount, 1);
  });

  it("dead-letters once the retry budget is exhausted", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"], maxAttempts: 3 });
    h.transport.always({ timeout: true });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    await h.hub.services.deliveries.dispatchDue();
    h.clock.advance(1_000);
    await h.hub.services.deliveries.dispatchDue();
    h.clock.advance(4_000);
    const last = await h.hub.services.deliveries.dispatchDue();

    assert.equal(last.deadLettered, 1);
    const [delivery] = await h.hub.services.deliveries.list(h.ctx);
    assert.equal(delivery!.attemptCount, 3);
    assert.match(delivery!.failureReason!, /retry budget exhausted after 3 attempts/);
    assert.ok(delivery!.attempts.every((a) => a.outcome === "timeout"));
    assert.equal(h.recorder.ofType(IntegrationEventTypes.WebhookDeliveryDeadLettered).length, 1);
  });

  it("honours Retry-After when it exceeds the computed backoff", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"], maxAttempts: 4 });
    h.transport.enqueue({ status: 429, headers: { "retry-after": "30" } });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    await h.hub.services.deliveries.dispatchDue();

    const [delivery] = await h.hub.services.deliveries.list(h.ctx);
    assert.equal(delivery!.status, "pending");
    assert.equal(delivery!.availableAt, "2026-08-12T09:00:30.000Z");

    h.clock.advance(29_000);
    assert.equal((await h.hub.services.deliveries.dispatchDue()).attempted, 0);
    h.clock.advance(1_000);
    assert.equal((await h.hub.services.deliveries.dispatchDue()).delivered, 1);
  });

  it("trips the circuit breaker after consecutive dead letters", async () => {
    const h = harness();
    const { subscription } = await h.hub.services.webhooks.create(h.ctx, {
      name: "flaky-partner",
      endpointUrl: "https://flaky.example.com/hooks",
      eventPatterns: ["quality.**"],
      maxAttempts: 1,
      autoDisableThreshold: 2,
    });
    h.transport.always({ status: 500 });

    for (const ncr of ["NCR-1", "NCR-2"]) {
      await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx, ncr));
      await h.hub.services.deliveries.dispatchDue();
    }

    const disabled = await h.hub.services.webhooks.get(h.ctx, subscription.id);
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.consecutiveFailures, 2);
    assert.equal(disabled.totalFailures, 2);
    assert.match(disabled.disabledReason!, /auto-disabled after 2 consecutive/);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.WebhookSubscriptionAutoDisabled).length, 1);

    // Queued work for a disabled endpoint is cancelled rather than retried.
    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx, "NCR-3"));
    const after = await h.hub.services.deliveries.dispatchDue();
    assert.equal(after.attempted, 0);
  });

  it("resets the failure streak on a success", async () => {
    const h = harness();
    const { id } = await activeWebhook(h, { patterns: ["quality.**"], maxAttempts: 1 });
    h.transport.enqueue({ status: 500 }, { status: 200 });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx, "NCR-1"));
    await h.hub.services.deliveries.dispatchDue();
    assert.equal((await h.hub.services.webhooks.get(h.ctx, id)).consecutiveFailures, 1);

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx, "NCR-2"));
    await h.hub.services.deliveries.dispatchDue();

    const subscription = await h.hub.services.webhooks.get(h.ctx, id);
    assert.equal(subscription.consecutiveFailures, 0);
    assert.equal(subscription.totalDeliveries, 2);
    assert.equal(subscription.lastSuccessAt, h.clock.now());
  });

  it("holds a paused endpoint's queue instead of dropping it", async () => {
    const h = harness();
    const { id } = await activeWebhook(h, { patterns: ["quality.**"] });
    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    await h.hub.services.webhooks.pause(h.ctx, id);

    assert.equal((await h.hub.services.deliveries.dispatchDue()).attempted, 0);
    assert.equal((await h.hub.services.deliveries.list(h.ctx))[0]!.status, "pending");

    await h.hub.services.webhooks.resume(h.ctx, id);
    assert.equal((await h.hub.services.deliveries.dispatchDue()).delivered, 1);
  });

  it("snapshots the endpoint so later edits do not rewrite queued deliveries", async () => {
    const h = harness();
    const { id } = await activeWebhook(h, {
      patterns: ["quality.**"],
      endpoint: "https://old.example.com/hooks",
    });
    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    await h.hub.services.webhooks.update(h.ctx, id, { endpointUrl: "https://new.example.com/hooks" });

    await h.hub.services.deliveries.dispatchDue();
    assert.equal(h.transport.lastRequest()!.url, "https://old.example.com/hooks");

    await h.hub.services.deliveries.scheduleForEvent(orderPlaced(h.ctx));
    await h.hub.services.webhooks.update(h.ctx, id, { eventPatterns: ["**"] });
    await h.hub.services.deliveries.scheduleForEvent(orderPlaced(h.ctx, "SO-2"));
    await h.hub.services.deliveries.dispatchDue();
    assert.equal(h.transport.lastRequest()!.url, "https://new.example.com/hooks");
  });

  it("requeues dead letters with a fresh budget", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"], maxAttempts: 1 });
    h.transport.enqueue({ status: 500 });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    await h.hub.services.deliveries.dispatchDue();
    assert.equal((await h.hub.services.deliveries.stats(h.ctx))["dead-lettered"], 1);

    assert.equal(await h.hub.services.deliveries.retryDeadLetters(h.ctx), 1);
    assert.equal((await h.hub.services.deliveries.dispatchDue()).delivered, 1);
    assert.equal((await h.hub.services.deliveries.stats(h.ctx))["delivered"], 1);
  });

  it("cancels a pending delivery and refuses to cancel a delivered one", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"] });
    const [pending] = await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    const cancelled = await h.hub.services.deliveries.cancel(h.ctx, pending!.id, "duplicate event");
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await h.hub.services.deliveries.dispatchDue()).attempted, 0);

    const [second] = await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx, "NCR-9"));
    await h.hub.services.deliveries.dispatchDue();
    await assert.rejects(
      () => h.hub.services.deliveries.cancel(h.ctx, second!.id, "too late"),
      ConflictError,
    );
  });

  it("sends a ping without needing a real event", async () => {
    const h = harness();
    const { id } = await activeWebhook(h);
    const { delivery, outcome } = await h.hub.services.deliveries.ping(h.ctx, id);

    assert.equal(outcome, "delivered");
    assert.equal(delivery.eventType, "integration.webhook.ping");
    assert.equal(JSON.parse(h.transport.lastRequest()!.body).data.subscription, "partner-erp");

    await h.hub.services.webhooks.disable(h.ctx, id, "offboarded");
    await assert.rejects(() => h.hub.services.deliveries.ping(h.ctx, id), ConflictError);
  });

  it("keeps deliveries scoped to their tenant", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["quality.**"] });
    const other = otherTenantCtx();
    await h.hub.services.webhooks.create(other, {
      name: "other-feed",
      endpointUrl: "https://other.example.com/hooks",
      eventPatterns: ["quality.**"],
    });

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(h.ctx));
    assert.equal((await h.hub.services.deliveries.list(h.ctx)).length, 1);
    assert.equal((await h.hub.services.deliveries.list(other)).length, 0);

    await h.hub.services.deliveries.scheduleForEvent(ncrOpened(other));
    assert.equal((await h.hub.services.deliveries.list(other)).length, 1);
    assert.equal(
      (await h.hub.services.deliveries.dispatchDue(50, { tenantId: other.tenantId })).attempted,
      1,
    );
    assert.equal((await h.hub.services.deliveries.list(h.ctx))[0]!.status, "pending");
  });
});
