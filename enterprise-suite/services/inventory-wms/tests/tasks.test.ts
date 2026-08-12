import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError, userId } from "@enterprise-suite/shared-kernel";
import { InventoryEvents } from "../src/index.js";
import { SKU_WIDGET, buildFixture, seedStock } from "./fixtures.js";

const OPERATOR = userId("operator-7");

test("receipt with putaway creates a PENDING task; completing it moves the stock", async () => {
  const fixture = await buildFixture();
  const receipt = await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.receivingBin.id,
    sku: SKU_WIDGET,
    quantity: 40,
    ref: { type: "PURCHASE_ORDER", id: "PO-77" },
    putaway: { suggestedBinId: fixture.storageBinA.id },
  });
  const task = receipt.putawayTask;
  assert.ok(task);
  assert.equal(task.status, "PENDING");
  assert.equal(task.fromBinId, fixture.receivingBin.id);
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.PutawayTaskCreated).length, 1);

  await fixture.module.taskService.assignPutaway(fixture.ctx, task.id, OPERATOR);
  await fixture.module.taskService.startPutaway(fixture.ctx, task.id);
  const completed = await fixture.module.taskService.completePutaway(fixture.ctx, task.id);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.targetBinId, fixture.storageBinA.id);

  const balances = await fixture.module.stockService.listBalances(fixture.ctx, {
    sku: SKU_WIDGET,
    nonEmptyOnly: true,
  });
  assert.equal(balances.length, 1);
  assert.equal(balances[0]!.binId, fixture.storageBinA.id);
  assert.equal(balances[0]!.onHand, 40);

  // The physical move is on the ledger, referencing the task.
  const transfers = await fixture.module.stockService.listTransactions(fixture.ctx, {
    txnType: "TRANSFER",
    refType: "PUTAWAY_TASK",
    refId: String(task.id),
  });
  assert.equal(transfers.length, 1);
});

test("putaway completion can divert to a different bin than suggested", async () => {
  const fixture = await buildFixture();
  const receipt = await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.receivingBin.id,
    sku: SKU_WIDGET,
    quantity: 10,
    putaway: { suggestedBinId: fixture.storageBinA.id },
  });
  const task = receipt.putawayTask!;
  await fixture.module.taskService.assignPutaway(fixture.ctx, task.id, OPERATOR);
  await fixture.module.taskService.startPutaway(fixture.ctx, task.id);
  const completed = await fixture.module.taskService.completePutaway(fixture.ctx, task.id, {
    actualBinId: fixture.storageBinB.id,
  });
  assert.equal(completed.targetBinId, fixture.storageBinB.id);
  const balances = await fixture.module.stockService.listBalances(fixture.ctx, {
    sku: SKU_WIDGET,
    nonEmptyOnly: true,
  });
  assert.equal(balances[0]!.binId, fixture.storageBinB.id);
});

test("putaway status machine rejects skipping steps and double completion", async () => {
  const fixture = await buildFixture();
  const receipt = await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.receivingBin.id,
    sku: SKU_WIDGET,
    quantity: 5,
    putaway: { suggestedBinId: fixture.storageBinA.id },
  });
  const task = receipt.putawayTask!;
  // PENDING -> complete is illegal (must be IN_PROGRESS).
  await assert.rejects(
    fixture.module.taskService.completePutaway(fixture.ctx, task.id),
    (err: DomainError) => err.status === 409,
  );
  // PENDING -> IN_PROGRESS skips ASSIGNED.
  await assert.rejects(
    fixture.module.taskService.startPutaway(fixture.ctx, task.id),
    (err: DomainError) => err.status === 409,
  );
  await fixture.module.taskService.assignPutaway(fixture.ctx, task.id, OPERATOR);
  await fixture.module.taskService.startPutaway(fixture.ctx, task.id);
  await fixture.module.taskService.completePutaway(fixture.ctx, task.id);
  await assert.rejects(
    fixture.module.taskService.completePutaway(fixture.ctx, task.id),
    (err: DomainError) => err.status === 409,
  );
});

test("cancelling a putaway leaves stock in the receiving bin", async () => {
  const fixture = await buildFixture();
  const receipt = await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.receivingBin.id,
    sku: SKU_WIDGET,
    quantity: 8,
    putaway: { suggestedBinId: fixture.storageBinA.id },
  });
  const cancelled = await fixture.module.taskService.cancelPutaway(
    fixture.ctx,
    receipt.putawayTask!.id,
  );
  assert.equal(cancelled.status, "CANCELLED");
  const balances = await fixture.module.stockService.listBalances(fixture.ctx, {
    sku: SKU_WIDGET,
    nonEmptyOnly: true,
  });
  assert.equal(balances[0]!.binId, fixture.receivingBin.id);
});

test("generatePickTasks creates one task per allocation and is idempotent", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 4);
  await seedStock(fixture, fixture.storageBinB.id, SKU_WIDGET, 4);
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-PICK",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 6 }],
  });
  assert.equal(report.reservation.allocations.length, 2);

  const tasks = await fixture.module.taskService.generatePickTasks(
    fixture.ctx,
    report.reservation.id,
  );
  assert.equal(tasks.length, 2);
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.PickTaskCreated).length, 2);

  const again = await fixture.module.taskService.generatePickTasks(
    fixture.ctx,
    report.reservation.id,
  );
  assert.equal(again.length, 0);
});

test("pick task lifecycle: assign, start, complete full and short picks", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-PICK2",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 10 }],
  });
  const [task] = await fixture.module.taskService.generatePickTasks(
    fixture.ctx,
    report.reservation.id,
  );
  assert.ok(task);

  await fixture.module.taskService.assignPick(fixture.ctx, task.id, OPERATOR);
  await fixture.module.taskService.startPick(fixture.ctx, task.id);
  const done = await fixture.module.taskService.completePick(fixture.ctx, task.id, 10);
  assert.equal(done.status, "PICKED");
  assert.equal(done.pickedQty, 10);

  // Over-picking is invalid.
  await assert.rejects(
    fixture.module.taskService.completePick(fixture.ctx, task.id, 11),
    (err: DomainError) => err.code === "INVALID_QUANTITY" || err.status === 409,
  );
});

test("short pick lands in SHORT_PICKED", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5);
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-SHORT",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 5 }],
  });
  const [task] = await fixture.module.taskService.generatePickTasks(
    fixture.ctx,
    report.reservation.id,
  );
  await fixture.module.taskService.assignPick(fixture.ctx, task!.id, OPERATOR);
  await fixture.module.taskService.startPick(fixture.ctx, task!.id);
  const short = await fixture.module.taskService.completePick(fixture.ctx, task!.id, 3);
  assert.equal(short.status, "SHORT_PICKED");
  assert.equal(short.pickedQty, 3);
});

test("pick tasks cannot be generated for an unallocated reservation", async () => {
  const fixture = await buildFixture();
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-EMPTY",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: "NO-STOCK-SKU", qty: 5 }],
  });
  assert.equal(report.reservation.status, "OPEN");
  await assert.rejects(
    fixture.module.taskService.generatePickTasks(fixture.ctx, report.reservation.id),
    (err: DomainError) => err.status === 409,
  );
});

test("task list filters by status, assignee and openOnly", async () => {
  const fixture = await buildFixture();
  for (let i = 0; i < 3; i++) {
    await fixture.module.stockService.receiveStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.receivingBin.id,
      sku: `SKU-${i}`,
      quantity: 5,
      putaway: { suggestedBinId: fixture.storageBinA.id },
    });
  }
  const all = await fixture.module.taskService.listPutaways(fixture.ctx, {});
  assert.equal(all.length, 3);
  await fixture.module.taskService.assignPutaway(fixture.ctx, all[0]!.id, OPERATOR);
  await fixture.module.taskService.cancelPutaway(fixture.ctx, all[1]!.id);

  const assigned = await fixture.module.taskService.listPutaways(fixture.ctx, {
    status: "ASSIGNED",
  });
  assert.equal(assigned.length, 1);
  const open = await fixture.module.taskService.listPutaways(fixture.ctx, { openOnly: true });
  assert.equal(open.length, 2);
  const mine = await fixture.module.taskService.listPutaways(fixture.ctx, {
    assignedTo: String(OPERATOR),
  });
  assert.equal(mine.length, 1);
});
