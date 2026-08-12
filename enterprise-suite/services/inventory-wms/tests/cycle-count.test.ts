import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { InventoryEvents } from "../src/index.js";
import { SKU_GADGET, SKU_WIDGET, buildFixture, seedStock } from "./fixtures.js";

test("full cycle count: snapshot, count, review, complete posts variance adjustments", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 50);
  await seedStock(fixture, fixture.storageBinB.id, SKU_GADGET, 30);

  const order = await fixture.module.cycleCountService.createOrder(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    lines: [
      { binId: fixture.storageBinA.id, sku: SKU_WIDGET },
      { binId: fixture.storageBinB.id, sku: SKU_GADGET },
    ],
  });
  assert.equal(order.status, "DRAFT");

  const started = await fixture.module.cycleCountService.startOrder(fixture.ctx, order.id);
  assert.equal(started.status, "IN_PROGRESS");
  assert.deepEqual(
    started.lines.map((l) => l.expectedQty),
    [50, 30],
  );

  // Count line 1 short by 2, line 2 exact.
  await fixture.module.cycleCountService.recordCount(
    fixture.ctx,
    order.id,
    started.lines[0]!.lineId,
    48,
  );
  const afterSecondCount = await fixture.module.cycleCountService.recordCount(
    fixture.ctx,
    order.id,
    started.lines[1]!.lineId,
    30,
  );
  assert.equal(afterSecondCount.status, "REVIEW");
  assert.equal(afterSecondCount.lines[0]!.varianceQty, -2);
  assert.equal(afterSecondCount.lines[1]!.varianceQty, 0);

  const { order: completed, adjustedLines } = await fixture.module.cycleCountService.completeOrder(
    fixture.ctx,
    order.id,
  );
  assert.equal(completed.status, "COMPLETED");
  assert.equal(adjustedLines.length, 1);

  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.onHand, 48);

  const adjustments = await fixture.module.stockService.listTransactions(fixture.ctx, {
    txnType: "COUNT_ADJUSTMENT",
  });
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0]!.quantity, -2);
  assert.equal(adjustments[0]!.ref?.type, "CYCLE_COUNT");
  assert.equal(adjustments[0]!.ref?.id, String(order.id));
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.CycleCountCompleted).length, 1);
});

test("counting a line that does not exist 404s; counting before start conflicts", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5);
  const order = await fixture.module.cycleCountService.createOrder(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    lines: [{ binId: fixture.storageBinA.id, sku: SKU_WIDGET }],
  });
  await assert.rejects(
    fixture.module.cycleCountService.recordCount(
      fixture.ctx,
      order.id,
      order.lines[0]!.lineId,
      5,
    ),
    (err: DomainError) => err.status === 409,
  );
  await fixture.module.cycleCountService.startOrder(fixture.ctx, order.id);
  await assert.rejects(
    fixture.module.cycleCountService.recordCount(fixture.ctx, order.id, "nope" as never, 5),
    (err: DomainError) => err.status === 404,
  );
});

test("complete requires all lines counted; recount clears lines back to IN_PROGRESS", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await seedStock(fixture, fixture.storageBinB.id, SKU_GADGET, 10);
  const order = await fixture.module.cycleCountService.createOrder(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    lines: [
      { binId: fixture.storageBinA.id, sku: SKU_WIDGET },
      { binId: fixture.storageBinB.id, sku: SKU_GADGET },
    ],
  });
  await fixture.module.cycleCountService.startOrder(fixture.ctx, order.id);
  await fixture.module.cycleCountService.recordCount(
    fixture.ctx,
    order.id,
    order.lines[0]!.lineId,
    9,
  );
  // Not all lines counted -> completing is an illegal transition from IN_PROGRESS.
  await assert.rejects(
    fixture.module.cycleCountService.completeOrder(fixture.ctx, order.id),
    (err: DomainError) => err.status === 409,
  );
  await fixture.module.cycleCountService.recordCount(
    fixture.ctx,
    order.id,
    order.lines[1]!.lineId,
    10,
  );
  // Now in REVIEW; send line 0 back for recount.
  const recounted = await fixture.module.cycleCountService.requestRecount(fixture.ctx, order.id, [
    order.lines[0]!.lineId,
  ]);
  assert.equal(recounted.status, "IN_PROGRESS");
  assert.equal(recounted.lines[0]!.countedQty, null);
  await fixture.module.cycleCountService.recordCount(
    fixture.ctx,
    order.id,
    order.lines[0]!.lineId,
    10,
  );
  const { order: completed } = await fixture.module.cycleCountService.completeOrder(
    fixture.ctx,
    order.id,
  );
  assert.equal(completed.status, "COMPLETED");
  // No variance -> no adjustment rows.
  const adjustments = await fixture.module.stockService.listTransactions(fixture.ctx, {
    txnType: "COUNT_ADJUSTMENT",
  });
  assert.equal(adjustments.length, 0);
});

test("variance is posted as a delta so movements after the snapshot survive", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 20);
  const order = await fixture.module.cycleCountService.createOrder(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    lines: [{ binId: fixture.storageBinA.id, sku: SKU_WIDGET }],
  });
  await fixture.module.cycleCountService.startOrder(fixture.ctx, order.id); // expected = 20
  // Concurrent receipt of 5 after the snapshot.
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5);
  // Counter finds 19 of the original 20 (one damaged): variance -1.
  await fixture.module.cycleCountService.recordCount(
    fixture.ctx,
    order.id,
    order.lines[0]!.lineId,
    19,
  );
  await fixture.module.cycleCountService.completeOrder(fixture.ctx, order.id);
  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  // 20 + 5 - 1 = 24 (an absolute write of 19 would have destroyed the receipt)
  assert.equal(availability.onHand, 24);
});

test("createOrderForBins builds lines from non-empty balances", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await seedStock(fixture, fixture.storageBinA.id, SKU_GADGET, 5);
  const order = await fixture.module.cycleCountService.createOrderForBins(
    fixture.ctx,
    fixture.warehouse.id,
    [fixture.storageBinA.id, fixture.storageBinB.id],
  );
  assert.equal(order.lines.length, 2);
  // Empty bins contribute nothing.
  await assert.rejects(
    fixture.module.cycleCountService.createOrderForBins(fixture.ctx, fixture.warehouse.id, [
      fixture.storageBinB.id,
    ]),
    (err: DomainError) => err.code === "VALIDATION",
  );
});

test("cancelled order is terminal", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  const order = await fixture.module.cycleCountService.createOrder(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    lines: [{ binId: fixture.storageBinA.id, sku: SKU_WIDGET }],
  });
  await fixture.module.cycleCountService.cancelOrder(fixture.ctx, order.id, "wrong bins");
  await assert.rejects(
    fixture.module.cycleCountService.startOrder(fixture.ctx, order.id),
    (err: DomainError) => err.status === 409,
  );
});
