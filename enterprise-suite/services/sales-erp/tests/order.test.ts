import test from "node:test";
import assert from "node:assert/strict";
import { ConflictError, ForbiddenError } from "../src/kernel/index.js";
import { OrderEventTypes } from "../src/domain/orders/events.js";
import { makeAccount, makeDraftOrder, makeModule, managerCtx, repCtx, seeded } from "./helpers.js";

test("orders: full lifecycle draft->confirmed->allocated->shipped->invoiced->closed", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx, { creditLimitMinor: null });
  const order = makeDraftOrder(module, ctx, accountId, [
    ["SKU-A", 4, 1_000],
    ["SKU-B", 2, 5_000],
  ]);
  const [lineA, lineB] = order.lines;

  module.orders.confirm(ctx, order.id);
  assert.equal(module.orders.get(ctx, order.id).status, "confirmed");
  assert.equal(module.orders.get(ctx, order.id).creditDecision?.decision, "approved");

  // Partial allocation keeps the order confirmed.
  module.orders.allocate(ctx, order.id, {
    allocations: [{ lineId: lineA.lineId as unknown as string, qty: 4 }],
  });
  assert.equal(module.orders.get(ctx, order.id).status, "confirmed");
  module.orders.allocate(ctx, order.id, {
    allocations: [{ lineId: lineB.lineId as unknown as string, qty: 2 }],
  });
  assert.equal(module.orders.get(ctx, order.id).status, "allocated");

  // Partial shipment keeps it allocated; completing ships it.
  module.orders.ship(ctx, order.id, {
    shipments: [{ lineId: lineA.lineId as unknown as string, qty: 4 }],
  });
  assert.equal(module.orders.get(ctx, order.id).status, "allocated");
  module.orders.ship(ctx, order.id, {
    shipments: [{ lineId: lineB.lineId as unknown as string, qty: 2 }],
  });
  assert.equal(module.orders.get(ctx, order.id).status, "shipped");

  module.orders.invoice(ctx, order.id);
  module.orders.close(ctx, order.id);
  assert.equal(module.orders.get(ctx, order.id).status, "closed");

  const types = module.outbox
    .all()
    .filter((e) => e.aggregateId === order.id)
    .map((e) => e.eventType);
  assert.deepEqual(types, [
    OrderEventTypes.OrderCreated,
    OrderEventTypes.OrderConfirmed,
    OrderEventTypes.OrderAllocated,
    OrderEventTypes.OrderShipped, // partial
    OrderEventTypes.OrderShipped, // final
    OrderEventTypes.OrderInvoiced,
    OrderEventTypes.OrderClosed,
  ]);
});

test("orders: quantity guards on allocation and shipment", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx, { creditLimitMinor: null });
  const order = makeDraftOrder(module, ctx, accountId, [["SKU-A", 5, 1_000]]);
  const line = order.lines[0];

  assert.throws(
    () => module.orders.allocate(ctx, order.id, { allocations: [{ lineId: line.lineId as unknown as string, qty: 1 }] }),
    /must be confirmed/,
  );
  module.orders.confirm(ctx, order.id);
  assert.throws(
    () => module.orders.allocate(ctx, order.id, { allocations: [{ lineId: line.lineId as unknown as string, qty: 6 }] }),
    /Cannot allocate/,
  );
  module.orders.allocate(ctx, order.id, {
    allocations: [{ lineId: line.lineId as unknown as string, qty: 5 }],
  });
  assert.throws(
    () => module.orders.ship(ctx, order.id, { shipments: [{ lineId: line.lineId as unknown as string, qty: 6 }] }),
    /Cannot ship/,
  );
});

test("orders: cancellation allowed until shipped, requires a reason", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx, { creditLimitMinor: null });

  const cancellable = makeDraftOrder(module, ctx, accountId, [["SKU-A", 1, 100]]);
  module.orders.confirm(ctx, cancellable.id);
  module.orders.cancel(ctx, cancellable.id, { reason: "customer withdrew" });
  const cancelled = module.orders.get(ctx, cancellable.id);
  assert.equal(cancelled.status, "cancelled");
  const event = module.outbox.byType(OrderEventTypes.OrderCancelled)[0];
  assert.equal((event.payload as { previousStatus: string }).previousStatus, "confirmed");

  const shipped = makeDraftOrder(module, ctx, accountId, [["SKU-B", 1, 100]]);
  module.orders.confirm(ctx, shipped.id);
  const lineId = shipped.lines[0].lineId as unknown as string;
  module.orders.allocate(ctx, shipped.id, { allocations: [{ lineId, qty: 1 }] });
  module.orders.ship(ctx, shipped.id, { shipments: [{ lineId, qty: 1 }] });
  assert.throws(() => module.orders.cancel(ctx, shipped.id, { reason: "too late" }), /cannot be cancelled/);
});

test("orders: credit review flow requires override plus manager role", () => {
  const { module } = makeModule();
  const rep = repCtx();
  const manager = managerCtx();
  const accountId = makeAccount(module, rep, { creditLimitMinor: 100_000 });
  // 9 x 100.00 net 90000 + 19% tax = 107100 -> above limit, within 110% tolerance.
  const order = makeDraftOrder(module, rep, accountId, [["SKU-A", 9, 10_000]]);

  assert.throws(() => module.orders.confirm(rep, order.id), /requires credit review/);
  assert.throws(() => module.orders.confirm(rep, order.id, { overrideCreditReview: true }), ForbiddenError);

  module.orders.confirm(manager, order.id, { overrideCreditReview: true });
  const confirmed = module.orders.get(rep, order.id);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.creditDecision?.decision, "review_required");
});

test("orders: declined credit blocks confirmation outright", () => {
  const { module } = makeModule();
  const manager = managerCtx();
  const accountId = makeAccount(module, manager, { creditLimitMinor: 100_000 });
  // 238000 projected >> 110% of the limit.
  const order = makeDraftOrder(module, manager, accountId, [["SKU-A", 20, 10_000]]);
  assert.throws(() => module.orders.confirm(manager, order.id, { overrideCreditReview: true }), ConflictError);
  assert.equal(module.orders.get(manager, order.id).status, "draft");
});

test("orders: exposure from open orders tightens later credit checks", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx, { creditLimitMinor: 250_000 });

  const first = makeDraftOrder(module, ctx, accountId, [["SKU-A", 10, 10_000]]); // 119000 gross
  module.orders.confirm(ctx, first.id);

  const second = makeDraftOrder(module, ctx, accountId, [["SKU-B", 10, 10_000]]); // +119000 -> 238000 < 250000
  module.orders.confirm(ctx, second.id);

  const third = makeDraftOrder(module, ctx, accountId, [["SKU-C", 10, 10_000]]); // 357000 > 275000
  assert.throws(() => module.orders.confirm(ctx, third.id), ConflictError);
});

test("orders: from-quote requires an accepted quote", () => {
  const { module, refs } = seeded();
  assert.throws(
    () => module.orders.createFromQuote(refs.ctx, { quoteId: refs.quoteId as unknown as string }),
    /accepted quote/,
  );
});

test("orders: line edits only in draft", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx, { creditLimitMinor: null });
  const order = makeDraftOrder(module, ctx, accountId, [["SKU-A", 1, 100]]);
  module.orders.confirm(ctx, order.id);
  assert.throws(
    () =>
      module.orders.addLine(ctx, order.id, {
        sku: "SKU-B",
        qty: 1,
        unitPriceMinor: 100,
        description: "x",
        taxCategory: "standard",
      }),
    ConflictError,
  );
  assert.throws(
    () => module.orders.removeLine(ctx, order.id, order.lines[0].lineId),
    ConflictError,
  );
});
