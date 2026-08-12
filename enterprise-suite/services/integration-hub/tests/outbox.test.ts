import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError } from "@enterprise-suite/shared-kernel";
import { IntegrationEventTypes } from "../src/domain/events.js";
import { harness, ncrOpened, orderPlaced, otherTenantCtx } from "./helpers.js";

const worker = { name: "relay-test", leaseMs: 30_000 };

describe("outbox ingestion", () => {
  it("enqueues an event and emits an ingestion event", async () => {
    const h = harness();
    const event = ncrOpened(h.ctx);

    const { message, duplicate } = await h.hub.services.outbox.enqueue(h.ctx, {
      source: "quality-qms",
      event,
    });

    assert.equal(duplicate, false);
    assert.equal(message.status, "pending");
    assert.equal(message.attempts, 0);
    assert.equal(message.eventType, "quality.ncr.opened");
    assert.equal(message.partitionKey, String(event.aggregateId));
    assert.deepEqual(h.recorder.types(), [IntegrationEventTypes.OutboxMessageEnqueued]);
  });

  it("is idempotent per (source, eventId) so a re-drain cannot double-publish", async () => {
    const h = harness();
    const event = ncrOpened(h.ctx);

    const first = await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event });
    const second = await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event });

    assert.equal(second.duplicate, true);
    assert.equal(second.message.id, first.message.id);
    assert.equal((await h.hub.services.outbox.list(h.ctx)).length, 1);
  });

  it("treats the same event from a different source as distinct", async () => {
    const h = harness();
    const event = ncrOpened(h.ctx);
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event });
    const other = await h.hub.services.outbox.enqueue(h.ctx, { source: "srm-core", event });
    assert.equal(other.duplicate, false);
    assert.equal((await h.hub.services.outbox.list(h.ctx)).length, 2);
  });

  it("rejects an event belonging to another tenant", async () => {
    const h = harness();
    const foreign = ncrOpened(otherTenantCtx());
    await assert.rejects(
      () => h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: foreign }),
      /event.tenantId must match/,
    );
  });

  it("counts a batch as enqueued plus duplicates", async () => {
    const h = harness();
    const events = [ncrOpened(h.ctx, "NCR-1"), ncrOpened(h.ctx, "NCR-2"), ncrOpened(h.ctx, "NCR-1")];
    // Same NCR number produces distinct event ids, so all three are new.
    const result = await h.hub.services.outbox.enqueueBatch(h.ctx, { source: "quality-qms", events });
    assert.equal(result.enqueued, 3);

    const again = await h.hub.services.outbox.enqueueBatch(h.ctx, { source: "quality-qms", events });
    assert.equal(again.enqueued, 0);
    assert.equal(again.duplicates, 3);
  });
});

describe("outbox claiming and leases", () => {
  it("claims due messages and marks them in-flight", async () => {
    const h = harness();
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });

    const claimed = await h.hub.services.outbox.claim(worker, 10);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]!.status, "in-flight");
    assert.equal(claimed[0]!.lease?.owner, "relay-test");

    // A second worker sees nothing while the lease is live.
    assert.deepEqual(await h.hub.services.outbox.claim({ name: "relay-2", leaseMs: 1_000 }, 10), []);
  });

  it("keeps one in-flight message per partition so aggregate order holds", async () => {
    const h = harness();
    const first = ncrOpened(h.ctx, "NCR-1");
    const second = { ...ncrOpened(h.ctx, "NCR-1") };
    // Same aggregate => same partition key.
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: first });
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: second });

    const claimed = await h.hub.services.outbox.claim(worker, 10);
    assert.equal(claimed.length, 1, "the second message waits for the first");
    assert.equal(claimed[0]!.eventId, String(first.eventId));

    await h.hub.services.outbox.markPublished(worker, claimed[0]!);
    const next = await h.hub.services.outbox.claim(worker, 10);
    assert.equal(next.length, 1);
    assert.equal(next[0]!.eventId, String(second.eventId));
  });

  it("claims across partitions in parallel", async () => {
    const h = harness();
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx, "NCR-1") });
    await h.hub.services.outbox.enqueue(h.ctx, { source: "sales-erp", event: orderPlaced(h.ctx) });
    assert.equal((await h.hub.services.outbox.claim(worker, 10)).length, 2);
  });

  it("reclaims a message whose lease expired", async () => {
    const h = harness();
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    const [claimed] = await h.hub.services.outbox.claim({ name: "crashed", leaseMs: 5_000 }, 10);
    assert.ok(claimed);

    h.clock.advance(6_000);
    const reclaimed = await h.hub.services.outbox.claim(worker, 10);
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0]!.lease?.owner, "relay-test");
    assert.match(reclaimed[0]!.lastFailure?.message ?? "", /lease expired/);
  });

  it("refuses acknowledgement from a worker that does not hold the lease", async () => {
    const h = harness();
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    const [claimed] = await h.hub.services.outbox.claim(worker, 10);
    assert.throws(
      () => claimed!.markPublished("someone-else", h.clock.now()),
      ConflictError,
    );
  });

  it("releases a lease without consuming an attempt", async () => {
    const h = harness();
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
    const [claimed] = await h.hub.services.outbox.claim(worker, 10);
    await h.hub.services.outbox.release(worker, claimed!);

    assert.equal(claimed!.status, "pending");
    assert.equal(claimed!.attempts, 0);
    assert.equal((await h.hub.services.outbox.claim(worker, 10)).length, 1);
  });
});

describe("outbox failure handling", () => {
  it("backs off exponentially and dead-letters when the budget is spent", async () => {
    const h = harness();
    await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });

    // Attempt 1 fails: retry in 1s (TEST_RETRY initial delay).
    let [message] = await h.hub.services.outbox.claim(worker, 10);
    await h.hub.services.outbox.markFailed(worker, message!, "bus unavailable");
    assert.equal(message!.status, "pending");
    assert.equal(message!.availableAt, "2026-08-12T09:00:01.000Z");
    assert.deepEqual(await h.hub.services.outbox.claim(worker, 10), [], "still backing off");

    // Attempt 2 fails: retry in 4s (multiplier 4).
    h.clock.advance(1_000);
    [message] = await h.hub.services.outbox.claim(worker, 10);
    await h.hub.services.outbox.markFailed(worker, message!, "bus unavailable");
    assert.equal(message!.availableAt, "2026-08-12T09:00:05.000Z");

    // Attempt 3 exhausts maxAttempts = 3.
    h.clock.advance(4_000);
    [message] = await h.hub.services.outbox.claim(worker, 10);
    await h.hub.services.outbox.markFailed(worker, message!, "bus unavailable");

    assert.equal(message!.status, "dead-lettered");
    assert.equal(message!.attempts, 3);
    assert.match(message!.deadLetterReason ?? "", /retry budget exhausted/);
    assert.ok(h.recorder.ofType(IntegrationEventTypes.OutboxMessageDeadLettered).length === 1);
  });

  it("replays a dead letter with a fresh attempt budget", async () => {
    const h = harness();
    const { message } = await h.hub.services.outbox.enqueue(h.ctx, {
      source: "quality-qms",
      event: ncrOpened(h.ctx),
    });
    await h.hub.services.outbox.deadLetter(h.ctx, message.id, "poison payload");
    assert.equal(message.status, "dead-lettered");

    const replayed = await h.hub.services.outbox.replay(h.ctx, message.id);
    assert.equal(replayed.status, "pending");
    assert.equal(replayed.replayCount, 1);
    assert.equal(replayed.maxAttempts, replayed.attempts + 3);
    assert.equal((await h.hub.services.outbox.claim(worker, 10)).length, 1);
  });

  it("bulk-replays every dead letter of a source", async () => {
    const h = harness();
    for (const number of ["NCR-1", "NCR-2"]) {
      const { message } = await h.hub.services.outbox.enqueue(h.ctx, {
        source: "quality-qms",
        event: ncrOpened(h.ctx, number),
      });
      await h.hub.services.outbox.deadLetter(h.ctx, message.id, "endpoint gone");
    }
    const { message: other } = await h.hub.services.outbox.enqueue(h.ctx, {
      source: "sales-erp",
      event: orderPlaced(h.ctx),
    });
    await h.hub.services.outbox.deadLetter(h.ctx, other.id, "endpoint gone");

    assert.equal(await h.hub.services.outbox.replayDeadLetters(h.ctx, { source: "quality-qms" }), 2);
    assert.deepEqual(await h.hub.services.outbox.stats(h.ctx), { pending: 2, "dead-lettered": 1 });
  });

  it("scopes reads to the calling tenant", async () => {
    const h = harness();
    const { message } = await h.hub.services.outbox.enqueue(h.ctx, {
      source: "quality-qms",
      event: ncrOpened(h.ctx),
    });
    await assert.rejects(
      () => h.hub.services.outbox.get(otherTenantCtx(), message.id),
      /OutboxMessage not found/,
    );
  });
});
