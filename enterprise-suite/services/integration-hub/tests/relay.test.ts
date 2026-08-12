/**
 * End-to-end tests for the relay loop: outbox -> bus + webhooks + routes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import { IntegrationEventTypes } from "../src/domain/events.js";
import { activeWebhook, harness, ncrOpened, orderPlaced, otherTenantCtx } from "./helpers.js";

describe("relay", () => {
  it("publishes an outbox message on the bus and marks it published", async () => {
    const h = harness();
    const received: EventEnvelope[] = [];
    h.bus.subscribe("quality.**", async (event) => {
      received.push(event);
    });

    const event = ncrOpened(h.ctx);
    const { message } = await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event });
    const summary = await h.hub.services.relay.runOnce();

    assert.equal(summary.claimed, 1);
    assert.equal(summary.published, 1);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.eventId, event.eventId);
    assert.equal((await h.hub.services.outbox.get(h.ctx, message.id)).status, "published");
    assert.equal(h.recorder.ofType(IntegrationEventTypes.OutboxMessagePublished).length, 1);
  });

  it("schedules webhook deliveries for matching subscriptions in the same pass", async () => {
    const h = harness();
    await activeWebhook(h, { name: "quality-feed", patterns: ["quality.**"] });
    await activeWebhook(h, { name: "sales-feed", patterns: ["sales.**"] });

    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    const summary = await h.hub.services.relay.runOnce();

    assert.equal(summary.deliveriesScheduled, 1);
    const [delivery] = await h.hub.services.deliveries.list(h.ctx);
    assert.equal(delivery!.eventType, "quality.ncr.opened");

    await h.hub.services.deliveries.dispatchDue();
    assert.equal((await h.hub.services.deliveries.list(h.ctx))[0]!.status, "delivered");
  });

  it("routes to a webhook that does not subscribe to the pattern itself", async () => {
    const h = harness();
    const { id } = await activeWebhook(h, { name: "partner", patterns: ["partner.**"] });
    await h.hub.services.routing.create(h.ctx, {
      name: "escalate-critical-ncrs",
      eventPatterns: ["quality.ncr.opened"],
      destination: { type: "webhook", subscriptionId: id },
      filter: { all: [{ path: "payload.severity", op: "eq", value: "critical" }] },
    });

    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    assert.equal((await h.hub.services.relay.runOnce()).deliveriesScheduled, 1);

    // A non-critical NCR falls outside the filter, so nothing is scheduled.
    const minor = { ...ncrOpened(h.ctx, "NCR-2"), payload: { severity: "minor" } } as EventEnvelope;
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: minor });
    assert.equal((await h.hub.services.relay.runOnce()).deliveriesScheduled, 0);
  });

  it("does not schedule the same subscription twice when a route overlaps fan-out", async () => {
    const h = harness();
    const { id } = await activeWebhook(h, { name: "quality-feed", patterns: ["quality.**"] });
    await h.hub.services.routing.create(h.ctx, {
      name: "also-quality-feed",
      eventPatterns: ["quality.**"],
      destination: { type: "webhook", subscriptionId: id },
    });

    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    assert.equal((await h.hub.services.relay.runOnce()).deliveriesScheduled, 1);
  });

  it("pushes a transformed payload to an adapter", async () => {
    const h = harness();
    const adapter = await h.hub.services.adapters.register(h.ctx, {
      name: "3pl-api",
      kind: "http",
      config: { endpoint: "https://3pl.example.com/orders", authScheme: "none" },
    });
    await h.hub.services.routing.create(h.ctx, {
      name: "orders-to-3pl",
      eventPatterns: ["sales.order.placed"],
      destination: { type: "adapter", adapterId: adapter.id },
      transform: {
        fields: {
          type: { const: "ORDER_CREATE" },
          reference: { path: "payload.orderId" },
          amount: { path: "payload.total.amount" },
        },
      },
    });

    await h.hub.services.outbox.enqueue(h.ctx, { source: "sales-crm", event: orderPlaced(h.ctx) });
    const summary = await h.hub.services.relay.runOnce();

    assert.equal(summary.adapterDispatches, 1);
    const [batch] = h.hub.drivers.http.batches;
    assert.deepEqual(batch!.messages[0]!.payload, {
      type: "ORDER_CREATE",
      reference: "SO-1001",
      amount: 25_000,
    });
    assert.equal(batch!.messages[0]!.headers?.["x-es-route"], "orders-to-3pl");
    assert.equal((await h.hub.services.adapters.get(h.ctx, adapter.id)).messagesSent, 1);
  });

  it("re-publishes on the bus under a translated topic with causation intact", async () => {
    const h = harness();
    const translated: EventEnvelope[] = [];
    h.bus.subscribe("partner.orders.v2", async (event) => {
      translated.push(event);
    });
    await h.hub.services.routing.create(h.ctx, {
      name: "anti-corruption",
      eventPatterns: ["sales.order.placed"],
      destination: { type: "bus", topic: "partner.orders.v2" },
      transform: { fields: { ref: { path: "payload.orderId" } } },
    });

    const event = orderPlaced(h.ctx);
    await h.hub.services.outbox.enqueue(h.ctx, { source: "sales-crm", event });
    await h.hub.services.relay.runOnce();

    assert.equal(translated.length, 1);
    assert.deepEqual(translated[0]!.payload, { ref: "SO-1001" });
    assert.equal(translated[0]!.causationId, event.eventId);
    assert.equal(translated[0]!.correlationId, event.eventId);
    assert.notEqual(translated[0]!.eventId, event.eventId);
  });

  it("fails the message, not the loop, when a destination is unavailable", async () => {
    const h = harness();
    const adapter = await h.hub.services.adapters.register(h.ctx, {
      name: "3pl-api",
      kind: "http",
      config: { endpoint: "https://3pl.example.com/orders", authScheme: "none" },
    });
    await h.hub.services.routing.create(h.ctx, {
      name: "orders-to-3pl",
      eventPatterns: ["sales.order.placed"],
      destination: { type: "adapter", adapterId: adapter.id },
    });
    h.hub.drivers.http.simulation.failNext = 1;

    await h.hub.services.outbox.enqueue(h.ctx, { source: "sales-crm", event: orderPlaced(h.ctx) });
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });

    const first = await h.hub.services.relay.runOnce();
    assert.equal(first.claimed, 2);
    assert.equal(first.published, 1);
    assert.equal(first.failed, 1);

    const pending = (await h.hub.services.outbox.list(h.ctx, { status: "pending" }))[0]!;
    assert.equal(pending.attempts, 1);
    assert.match(pending.lastFailure!.message, /http adapter unavailable/);

    // The retry succeeds once the driver recovers and the backoff elapses.
    h.clock.advance(60_000);
    const second = await h.hub.services.relay.runOnce();
    assert.equal(second.published, 1);
    assert.equal(second.adapterDispatches, 1);
  });

  it("dead-letters a message once its attempts are spent", async () => {
    const h = harness();
    const adapter = await h.hub.services.adapters.register(h.ctx, {
      name: "3pl-api",
      kind: "http",
      config: { endpoint: "https://3pl.example.com/orders", authScheme: "none" },
    });
    await h.hub.services.routing.create(h.ctx, {
      name: "orders-to-3pl",
      eventPatterns: ["sales.order.placed"],
      destination: { type: "adapter", adapterId: adapter.id },
    });
    h.hub.drivers.http.simulation.unhealthy = true;

    await h.hub.services.outbox.enqueue(h.ctx, {
      source: "sales-crm",
      event: orderPlaced(h.ctx),
      maxAttempts: 2,
    });

    assert.equal((await h.hub.services.relay.runOnce()).failed, 1);
    h.clock.advance(60_000);
    assert.equal((await h.hub.services.relay.runOnce()).deadLettered, 1);
    assert.equal((await h.hub.services.outbox.stats(h.ctx))["dead-lettered"], 1);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.OutboxMessageDeadLettered).length, 1);

    // Replaying after the fix drains the queue.
    h.hub.drivers.http.simulation.unhealthy = false;
    assert.equal(await h.hub.services.outbox.replayDeadLetters(h.ctx), 1);
    assert.equal((await h.hub.services.relay.runUntilIdle()).published, 1);
  });

  it("drains a backlog across rounds and stops when idle", async () => {
    const h = harness();
    await activeWebhook(h, { patterns: ["sales.**"] });
    for (let index = 0; index < 7; index++) {
      await h.hub.services.outbox.enqueue(h.ctx, {
        source: "sales-crm",
        event: orderPlaced(h.ctx, `SO-${index}`),
      });
    }

    const summary = await h.hub.services.relay.runUntilIdle({ limit: 3 });
    assert.equal(summary.claimed, 7);
    assert.equal(summary.published, 7);
    assert.equal(summary.deliveriesScheduled, 7);
    assert.equal((await h.hub.services.relay.runOnce()).claimed, 0);
  });

  it("can be scoped to one tenant or one source", async () => {
    const h = harness();
    const other = otherTenantCtx();
    await h.hub.services.outbox.enqueue(h.ctx, { source: "sales-crm", event: orderPlaced(h.ctx) });
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    await h.hub.services.outbox.enqueue(other, { source: "sales-crm", event: orderPlaced(other) });

    assert.equal((await h.hub.services.relay.runOnce({ source: "quality-qms" })).published, 1);
    assert.equal((await h.hub.services.relay.runOnce({ tenantId: other.tenantId })).published, 1);
    assert.equal((await h.hub.services.outbox.list(h.ctx, { status: "pending" })).length, 1);
  });

  it("ignores a re-ingested event so a producer crash cannot double-publish", async () => {
    const h = harness();
    const event = orderPlaced(h.ctx);
    const first = await h.hub.services.outbox.enqueue(h.ctx, { source: "sales-crm", event });
    const second = await h.hub.services.outbox.enqueue(h.ctx, { source: "sales-crm", event });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(String(second.message.id), String(first.message.id));
    assert.equal((await h.hub.services.relay.runUntilIdle()).published, 1);
  });

  it("carries an event all the way from a producing service to a signed webhook", async () => {
    const h = harness();
    await activeWebhook(h, { name: "partner-erp", patterns: ["quality.ncr.*"] });
    const seen: string[] = [];
    h.bus.subscribe("**", async (event) => {
      seen.push(event.eventType);
    });

    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    await h.hub.services.relay.runUntilIdle();
    await h.hub.services.deliveries.dispatchDue();

    assert.ok(seen.includes("quality.ncr.opened"));
    assert.ok(seen.includes(IntegrationEventTypes.WebhookDeliverySucceeded));
    assert.equal(h.transport.callCount, 1);
    assert.equal(JSON.parse(h.transport.lastRequest()!.body).eventType, "quality.ncr.opened");
    assert.equal((await h.hub.services.deliveries.stats(h.ctx))["delivered"], 1);
  });
});
