import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntegrationEventTypes } from "../src/domain/events.js";
import {
  IdempotencyInProgressError,
  IdempotencyKeyReuseError,
} from "../src/domain/idempotency.js";
import { harness, otherTenantCtx } from "./helpers.js";

const request = { orderId: "SO-77", lines: [{ sku: "A", qty: 2 }] };
const scope = "POST /orders";

describe("idempotency keys", () => {
  it("runs the operation once and replays the stored response", async () => {
    const h = harness();
    let executions = 0;
    const operation = async () => {
      executions++;
      return { status: 201, body: { orderId: "SO-77", id: "order_1" } };
    };

    const first = await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-1", scope, request },
      operation,
    );
    const second = await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-1", scope, request },
      operation,
    );

    assert.equal(executions, 1);
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.response, first.response);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.IdempotencyReplayServed).length, 1);
  });

  it("rejects the same key with a different request body", async () => {
    const h = harness();
    await h.hub.services.idempotency.execute(h.ctx, { key: "key-1", scope, request }, async () => ({
      status: 201,
      body: { ok: true },
    }));

    await assert.rejects(
      () =>
        h.hub.services.idempotency.execute(
          h.ctx,
          { key: "key-1", scope, request: { orderId: "SO-78" } },
          async () => ({ status: 201, body: { ok: true } }),
        ),
      IdempotencyKeyReuseError,
    );
    assert.equal(h.recorder.ofType(IntegrationEventTypes.IdempotencyConflictDetected).length, 1);
  });

  it("is insensitive to key order in the request body", async () => {
    const h = harness();
    await h.hub.services.idempotency.execute(h.ctx, { key: "key-1", scope, request }, async () => ({
      status: 201,
      body: { ok: true },
    }));
    const replay = await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-1", scope, request: { lines: [{ qty: 2, sku: "A" }], orderId: "SO-77" } },
      async () => ({ status: 201, body: { ok: true } }),
    );
    assert.equal(replay.replayed, true);
  });

  it("signals 409 while the original request is still running", async () => {
    const h = harness();
    await h.hub.services.idempotency.begin(h.ctx, { key: "key-1", scope, request });
    await assert.rejects(
      () => h.hub.services.idempotency.begin(h.ctx, { key: "key-1", scope, request }),
      IdempotencyInProgressError,
    );
  });

  it("releases the key when the operation fails so a retry can proceed", async () => {
    const h = harness();
    await assert.rejects(
      () =>
        h.hub.services.idempotency.execute(h.ctx, { key: "key-1", scope, request }, async () => {
          throw new Error("inventory service down");
        }),
      /inventory service down/,
    );

    const record = await h.hub.services.idempotency.get(h.ctx, scope, "key-1");
    assert.equal(record.status, "failed");

    const retried = await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-1", scope, request },
      async () => ({ status: 201, body: { ok: true } }),
    );
    assert.equal(retried.replayed, false);
    assert.equal(retried.response.status, 201);
  });

  it("separates keys by scope and by tenant", async () => {
    const h = harness();
    const run = async (ctx = h.ctx, keyScope = scope) =>
      h.hub.services.idempotency.execute(ctx, { key: "key-1", scope: keyScope, request }, async () => ({
        status: 201,
        body: { scope: keyScope },
      }));

    assert.equal((await run()).replayed, false);
    assert.equal((await run(h.ctx, "POST /shipments")).replayed, false);
    assert.equal((await run(otherTenantCtx())).replayed, false);
    assert.equal((await run()).replayed, true);
  });

  it("re-opens an expired key for a fresh attempt", async () => {
    const h = harness();
    await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-1", scope, request, ttlMs: 60_000 },
      async () => ({ status: 201, body: { attempt: 1 } }),
    );

    h.clock.advance(61_000);
    const after = await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-1", scope, request, ttlMs: 60_000 },
      async () => ({ status: 201, body: { attempt: 2 } }),
    );

    assert.equal(after.replayed, false);
    assert.deepEqual(after.response.body, { attempt: 2 });
  });

  it("purges expired records", async () => {
    const h = harness();
    await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-1", scope, request, ttlMs: 1_000 },
      async () => ({ status: 200, body: {} }),
    );
    await h.hub.services.idempotency.execute(
      h.ctx,
      { key: "key-2", scope, request: { other: true }, ttlMs: 3_600_000 },
      async () => ({ status: 200, body: {} }),
    );

    h.clock.advance(2_000);
    assert.equal(await h.hub.services.idempotency.purgeExpired(h.ctx), 1);
    assert.equal((await h.hub.services.idempotency.list(h.ctx)).length, 1);
  });

  it("counts every request that touched a key", async () => {
    const h = harness();
    const call = () =>
      h.hub.services.idempotency.execute(h.ctx, { key: "key-1", scope, request }, async () => ({
        status: 201,
        body: {},
      }));
    await call();
    await call();
    await call();

    const record = await h.hub.services.idempotency.get(h.ctx, scope, "key-1");
    assert.equal(record.requestCount, 3);
    assert.equal(record.replayCount, 2);
  });
});
