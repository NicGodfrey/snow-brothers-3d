import test from "node:test";
import assert from "node:assert/strict";
import { ConflictError, InvalidTransitionError } from "../src/kernel/index.js";
import { RmaEventTypes } from "../src/domain/returns/events.js";
import { makeAccount, makeDraftOrder, makeModule, repCtx, shipOrder } from "./helpers.js";
import type { SalesModule } from "../src/infrastructure/container.js";
import type { TenantContext, Ulid } from "../src/kernel/index.js";

/** Shipped order: 5 units @ 20.00 EUR with 10% discount -> effective 18.00/unit. */
function shippedOrder(module: SalesModule, ctx: TenantContext): { orderId: Ulid; orderLineId: Ulid } {
  const accountId = makeAccount(module, ctx, { creditLimitMinor: null });
  const order = makeDraftOrder(module, ctx, accountId, [["SKU-RET", 5, 2_000, 10]]);
  shipOrder(module, ctx, order);
  return { orderId: order.id, orderLineId: order.lines[0].lineId };
}

test("returns: nothing to return before shipment", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx, { creditLimitMinor: null });
  const order = makeDraftOrder(module, ctx, accountId, [["SKU-A", 1, 100]]);
  assert.throws(
    () =>
      module.returns.request(ctx, {
        orderId: order.id as unknown as string,
        lines: [{ orderLineId: order.lines[0].lineId as unknown as string, qty: 1, reason: "damaged" }],
      }),
    /no shipped goods/,
  );
});

test("returns: happy path request->approve->receive->refund with frozen discounted price", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const { orderId, orderLineId } = shippedOrder(module, ctx);

  const rma = module.returns.request(ctx, {
    orderId: orderId as unknown as string,
    lines: [{ orderLineId: orderLineId as unknown as string, qty: 2, reason: "damaged" }],
    notes: "box crushed in transit",
  });
  assert.equal(rma.rmaNumber, "RMA-00001");
  assert.equal(rma.status, "requested");
  assert.equal(rma.lines[0].unitRefund.amountMinor, 1_800);
  assert.equal(rma.refundTotal.amountMinor, 3_600);

  module.returns.approve(ctx, rma.id);
  module.returns.markReceived(ctx, rma.id);
  const { refund } = module.returns.refund(ctx, rma.id);
  assert.equal(refund.amountMinor, 3_600);
  assert.equal(module.returns.get(ctx, rma.id).status, "refunded");

  const refunded = module.outbox.byType(RmaEventTypes.RmaRefunded);
  assert.equal(refunded.length, 1);
  assert.equal((refunded[0].payload as { refundMinor: number }).refundMinor, 3_600);
});

test("returns: quantity capped at shipped minus already returned", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const { orderId, orderLineId } = shippedOrder(module, ctx);

  assert.throws(
    () =>
      module.returns.request(ctx, {
        orderId: orderId as unknown as string,
        lines: [{ orderLineId: orderLineId as unknown as string, qty: 6, reason: "other" }],
      }),
    /only 5 shipped units remain returnable/,
  );

  module.returns.request(ctx, {
    orderId: orderId as unknown as string,
    lines: [{ orderLineId: orderLineId as unknown as string, qty: 3, reason: "wrong_item" }],
  });
  // 3 already held by the first (active) RMA.
  assert.throws(
    () =>
      module.returns.request(ctx, {
        orderId: orderId as unknown as string,
        lines: [{ orderLineId: orderLineId as unknown as string, qty: 3, reason: "other" }],
      }),
    /only 2 shipped units remain returnable/,
  );
});

test("returns: rejected RMAs release their quantity", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const { orderId, orderLineId } = shippedOrder(module, ctx);

  const first = module.returns.request(ctx, {
    orderId: orderId as unknown as string,
    lines: [{ orderLineId: orderLineId as unknown as string, qty: 5, reason: "no_longer_needed" }],
  });
  module.returns.reject(ctx, first.id, { reason: "outside return window" });

  const second = module.returns.request(ctx, {
    orderId: orderId as unknown as string,
    lines: [{ orderLineId: orderLineId as unknown as string, qty: 5, reason: "damaged" }],
  });
  assert.equal(second.status, "requested");
  assert.equal(module.returns.listByOrder(ctx, orderId).length, 2);
});

test("returns: state machine guards", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const { orderId, orderLineId } = shippedOrder(module, ctx);
  const rma = module.returns.request(ctx, {
    orderId: orderId as unknown as string,
    lines: [{ orderLineId: orderLineId as unknown as string, qty: 1, reason: "damaged" }],
  });

  assert.throws(() => module.returns.refund(ctx, rma.id), InvalidTransitionError);
  assert.throws(() => module.returns.markReceived(ctx, rma.id), InvalidTransitionError);

  module.returns.approve(ctx, rma.id);
  module.returns.markReceived(ctx, rma.id);
  assert.throws(() => module.returns.cancel(ctx, rma.id), InvalidTransitionError);
  assert.throws(() => module.returns.reject(ctx, rma.id, { reason: "already received" }), InvalidTransitionError);

  module.returns.refund(ctx, rma.id);
  assert.throws(() => module.returns.refund(ctx, rma.id), InvalidTransitionError);
});

test("returns: reasons are validated", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const { orderId, orderLineId } = shippedOrder(module, ctx);
  assert.throws(() =>
    module.returns.request(ctx, {
      orderId: orderId as unknown as string,
      lines: [{ orderLineId: orderLineId as unknown as string, qty: 1, reason: "because" }],
    }),
  );
  assert.throws(() => {
    module.returns.request(ctx, { orderId: orderId as unknown as string, lines: [] });
  });
});
