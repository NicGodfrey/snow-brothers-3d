import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntegrationEventTypes } from "../src/domain/events.js";
import { harness, otherTenantCtx } from "./helpers.js";

const partnerOrder = {
  source: "partner-edi",
  messageKey: "PO-88213",
  eventType: "partner.order.received",
  payload: { orderId: "PO-88213", lines: [{ sku: "BRKT-100", qty: 40 }] },
};

describe("inbox de-duplication", () => {
  it("records a new message and emits a received event", async () => {
    const h = harness();
    const { message, duplicate } = await h.hub.services.inbox.receive(h.ctx, partnerOrder);

    assert.equal(duplicate, false);
    assert.equal(message.status, "received");
    assert.equal(message.attempts, 0);
    assert.ok(message.checksum.length === 64);
    assert.deepEqual(h.recorder.types(), [IntegrationEventTypes.InboxMessageReceived]);
  });

  it("absorbs an identical redelivery without re-running anything", async () => {
    const h = harness();
    h.hub.services.inbox.onEvent("partner.**", () => ({ ok: true }));

    const first = await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    await h.hub.services.inbox.process(h.ctx, first.message.id);

    const second = await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    assert.equal(second.duplicate, true);
    assert.equal(second.message.id, first.message.id);
    assert.equal(second.message.duplicateCount, 1);
    assert.equal(second.message.attempts, 1, "handler ran exactly once");
    assert.equal(h.recorder.ofType(IntegrationEventTypes.InboxDuplicateIgnored).length, 1);
  });

  it("rejects a reused key that carries different content", async () => {
    const h = harness();
    await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    await assert.rejects(
      () =>
        h.hub.services.inbox.receive(h.ctx, {
          ...partnerOrder,
          payload: { orderId: "PO-88213", lines: [{ sku: "BRKT-100", qty: 999 }] },
        }),
      /already received with a different payload/,
    );
  });

  it("ignores key-order differences when comparing payloads", async () => {
    const h = harness();
    await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    const again = await h.hub.services.inbox.receive(h.ctx, {
      ...partnerOrder,
      payload: { lines: [{ qty: 40, sku: "BRKT-100" }], orderId: "PO-88213" },
    });
    assert.equal(again.duplicate, true);
  });

  it("keeps keys separate per source and per tenant", async () => {
    const h = harness();
    await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    const otherSource = await h.hub.services.inbox.receive(h.ctx, {
      ...partnerOrder,
      source: "partner-api",
    });
    const otherTenant = await h.hub.services.inbox.receive(otherTenantCtx(), partnerOrder);

    assert.equal(otherSource.duplicate, false);
    assert.equal(otherTenant.duplicate, false);
    assert.equal((await h.hub.services.inbox.list(h.ctx)).length, 2);
  });
});

describe("inbox processing", () => {
  it("runs the handler matching the event type and stores its result", async () => {
    const h = harness();
    const seen: string[] = [];
    h.hub.services.inbox
      .onEvent("carrier.**", () => {
        seen.push("carrier");
        return { ignored: true };
      })
      .onEvent("partner.order.**", (input) => {
        seen.push(input.eventType);
        return { importedAs: "SO-5000" };
      });

    const { message } = await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    const processed = await h.hub.services.inbox.process(h.ctx, message.id);

    assert.deepEqual(seen, ["partner.order.received"]);
    assert.equal(processed.status, "processed");
    assert.deepEqual(processed.result, { importedAs: "SO-5000" });
    assert.equal(h.recorder.ofType(IntegrationEventTypes.InboxMessageProcessed).length, 1);
  });

  it("retries with backoff and gives up as 'failed'", async () => {
    const h = harness();
    let calls = 0;
    h.hub.services.inbox.onEvent("partner.**", () => {
      calls++;
      throw new Error("downstream ERP timeout");
    });

    const { message } = await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    await h.hub.services.inbox.process(h.ctx, message.id);
    assert.equal(message.status, "received", "scheduled for retry");
    assert.equal(message.availableAt, "2026-08-12T09:00:01.000Z");

    // Not due yet.
    assert.equal((await h.hub.services.inbox.processDue()).picked, 0);

    h.clock.advance(1_000);
    await h.hub.services.inbox.processDue();
    h.clock.advance(4_000);
    const summary = await h.hub.services.inbox.processDue();

    assert.equal(calls, 3);
    assert.equal(summary.failed, 1);
    assert.equal(message.status, "failed");
    assert.match(message.lastFailure?.message ?? "", /downstream ERP timeout/);
  });

  it("fails a message whose event type has no handler", async () => {
    const h = harness();
    const { message } = await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    await h.hub.services.inbox.process(h.ctx, message.id);
    assert.match(message.lastFailure?.message ?? "", /no inbox handler registered/);
  });

  it("replays a failed message after the handler is fixed", async () => {
    const h = harness();
    let broken = true;
    h.hub.services.inbox.onEvent("partner.**", () => {
      if (broken) throw new Error("mapping bug");
      return { ok: true };
    });

    const { message } = await h.hub.services.inbox.receive(h.ctx, { ...partnerOrder, maxAttempts: 1 });
    await h.hub.services.inbox.process(h.ctx, message.id);
    assert.equal(message.status, "failed");

    broken = false;
    await h.hub.services.inbox.replay(h.ctx, message.id);
    await h.hub.services.inbox.process(h.ctx, message.id);
    assert.equal(message.status, "processed");
  });

  it("discards a message and refuses to discard a processed one", async () => {
    const h = harness();
    h.hub.services.inbox.onEvent("partner.**", () => ({ ok: true }));
    const { message } = await h.hub.services.inbox.receive(h.ctx, partnerOrder);

    await h.hub.services.inbox.discard(h.ctx, message.id, "duplicate of PO-88212");
    assert.equal(message.status, "discarded");
    assert.equal(h.recorder.ofType(IntegrationEventTypes.InboxMessageDiscarded).length, 1);

    await h.hub.services.inbox.replay(h.ctx, message.id);
    await h.hub.services.inbox.process(h.ctx, message.id);
    assert.equal(message.status, "processed");
    await assert.rejects(
      () => h.hub.services.inbox.discard(h.ctx, message.id, "too late"),
      /Processed messages cannot be discarded/,
    );
  });

  it("reports counts by status", async () => {
    const h = harness();
    h.hub.services.inbox.onEvent("partner.order.**", () => ({ ok: true }));
    const first = await h.hub.services.inbox.receive(h.ctx, partnerOrder);
    await h.hub.services.inbox.process(h.ctx, first.message.id);
    await h.hub.services.inbox.receive(h.ctx, { ...partnerOrder, messageKey: "PO-88214" });

    assert.deepEqual(await h.hub.services.inbox.stats(h.ctx), { processed: 1, received: 1 });
  });
});
