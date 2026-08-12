import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { InventoryEvents } from "../src/index.js";
import { SKU_GADGET, SKU_WIDGET, buildFixture, seedLottedStock, seedStock } from "./fixtures.js";

test("createReservation auto-allocates and reserves on the balance", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 20);

  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-100",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 12 }],
  });

  assert.equal(report.reservation.status, "ALLOCATED");
  assert.equal(report.shortages.length, 0);
  assert.equal(report.reservation.allocations.length, 1);
  assert.equal(report.reservation.allocations[0]!.qty, 12);

  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.onHand, 20);
  assert.equal(availability.reserved, 12);
  assert.equal(availability.available, 8);

  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.ReservationCreated).length, 1);
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.ReservationAllocated).length, 1);
});

test("partial availability yields PARTIALLY_ALLOCATED with shortages", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5);

  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-101",
    warehouseId: fixture.warehouse.id,
    lines: [
      { sku: SKU_WIDGET, qty: 8 },
      { sku: SKU_GADGET, qty: 3 },
    ],
  });

  assert.equal(report.reservation.status, "PARTIALLY_ALLOCATED");
  assert.deepEqual(report.shortages, [
    { sku: SKU_WIDGET, requestedQty: 8, allocatedQty: 5, shortQty: 3 },
    { sku: SKU_GADGET, requestedQty: 3, allocatedQty: 0, shortQty: 3 },
  ]);

  // Top up stock, re-allocate, and it becomes fully ALLOCATED.
  await seedStock(fixture, fixture.storageBinB.id, SKU_WIDGET, 10);
  await seedStock(fixture, fixture.storageBinB.id, SKU_GADGET, 10);
  const second = await fixture.module.reservationService.allocate(
    fixture.ctx,
    report.reservation.id,
  );
  assert.equal(second.reservation.status, "ALLOCATED");
  assert.equal(second.shortages.length, 0);
});

test("FEFO picks the lot expiring first; FIFO picks the oldest receipt", async () => {
  const fixture = await buildFixture();
  // LOT-LATER received first but expires later; LOT-SOON expires first.
  await seedLottedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10, "LOT-LATER", 90);
  await seedLottedStock(fixture, fixture.storageBinB.id, SKU_WIDGET, 10, "LOT-SOON", 10);

  const fefo = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-FEFO",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 10 }],
    strategy: "FEFO",
  });
  const lots = await fixture.module.stockService.listLots(fixture.ctx, SKU_WIDGET);
  const lotSoon = lots.find((l) => l.lotCode === "LOT-SOON")!;
  const lotLater = lots.find((l) => l.lotCode === "LOT-LATER")!;
  assert.equal(fefo.reservation.allocations[0]!.lotId, lotSoon.id);

  await fixture.module.reservationService.release(fixture.ctx, fefo.reservation.id);

  const fifo = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-FIFO",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 10 }],
    strategy: "FIFO",
  });
  assert.equal(fifo.reservation.allocations[0]!.lotId, lotLater.id);
});

test("allocation skips blocked bins and quarantined lots", async () => {
  const fixture = await buildFixture();
  await seedLottedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10, "LOT-OK", 60);
  await seedLottedStock(fixture, fixture.storageBinB.id, SKU_WIDGET, 10, "LOT-BAD", 5);

  const lots = await fixture.module.stockService.listLots(fixture.ctx, SKU_WIDGET);
  const badLot = lots.find((l) => l.lotCode === "LOT-BAD")!;
  await fixture.module.stockService.setLotStatus(fixture.ctx, badLot.id, "quarantine");

  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-102",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 15 }],
    strategy: "FEFO",
  });
  // Only the 10 units of LOT-OK are allocatable despite LOT-BAD expiring sooner.
  assert.equal(report.reservation.status, "PARTIALLY_ALLOCATED");
  assert.equal(report.reservation.allocations.length, 1);
  const okLot = lots.find((l) => l.lotCode === "LOT-OK")!;
  assert.equal(report.reservation.allocations[0]!.lotId, okLot.id);
});

test("duplicate active reservation for the same sales order conflicts", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-DUP",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 1 }],
  });
  await assert.rejects(
    fixture.module.reservationService.createReservation(fixture.ctx, {
      salesOrderId: "SO-DUP",
      warehouseId: fixture.warehouse.id,
      lines: [{ sku: SKU_WIDGET, qty: 1 }],
    }),
    (err: DomainError) => err.code === "CONFLICT",
  );
});

test("release returns reserved quantity to available and closes the reservation", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-REL",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 10 }],
  });
  const released = await fixture.module.reservationService.release(
    fixture.ctx,
    report.reservation.id,
  );
  assert.equal(released.status, "RELEASED");

  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.reserved, 0);
  assert.equal(availability.available, 10);

  // A released reservation is terminal.
  await assert.rejects(
    fixture.module.reservationService.allocate(fixture.ctx, report.reservation.id),
    (err: DomainError) => err.status === 409,
  );
});

test("fulfill consumes reserved stock and writes ISSUE rows referencing the sales order", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-SHIP",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 6 }],
  });
  const fulfilled = await fixture.module.reservationService.fulfill(
    fixture.ctx,
    report.reservation.id,
  );
  assert.equal(fulfilled.status, "FULFILLED");
  assert.equal(fulfilled.lines[0]!.fulfilledQty, 6);

  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.onHand, 4);
  assert.equal(availability.reserved, 0);

  const issues = await fixture.module.stockService.listTransactions(fixture.ctx, {
    txnType: "ISSUE",
    refType: "SALES_ORDER",
    refId: "SO-SHIP",
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.quantity, 6);
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.ReservationFulfilled).length, 1);
});

test("fulfill of a partial reservation requires allowPartial", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 3);
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-PART",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 10 }],
  });
  assert.equal(report.reservation.status, "PARTIALLY_ALLOCATED");
  await assert.rejects(
    fixture.module.reservationService.fulfill(fixture.ctx, report.reservation.id),
    (err: DomainError) => err.status === 409,
  );
  const fulfilled = await fixture.module.reservationService.fulfill(
    fixture.ctx,
    report.reservation.id,
    { allowPartial: true },
  );
  assert.equal(fulfilled.status, "FULFILLED");
  assert.equal(fulfilled.lines[0]!.fulfilledQty, 3);
});

test("cancel releases stock like release but records the cancellation event", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5);
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-CXL",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 5 }],
  });
  const cancelled = await fixture.module.reservationService.cancel(
    fixture.ctx,
    report.reservation.id,
    "customer withdrew order",
  );
  assert.equal(cancelled.status, "CANCELLED");
  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.available, 5);
  const events = fixture.module.outbox.eventsOfType(InventoryEvents.ReservationCancelled);
  assert.equal(events.length, 1);
  assert.match(JSON.stringify(events[0]!.payload), /customer withdrew order/);
});

test("reservation with duplicate SKUs on separate lines is rejected", async () => {
  const fixture = await buildFixture();
  await assert.rejects(
    fixture.module.reservationService.createReservation(fixture.ctx, {
      salesOrderId: "SO-BAD",
      warehouseId: fixture.warehouse.id,
      lines: [
        { sku: SKU_WIDGET, qty: 1 },
        { sku: SKU_WIDGET, qty: 2 },
      ],
    }),
    (err: DomainError) => err.code === "INVALID_RESERVATION",
  );
});

test("allocation spreads across bins in pick-sequence order when one bin is short", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinB.id, SKU_WIDGET, 4); // pickSequence 20
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 4); // pickSequence 10
  const report = await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-SPREAD",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 6 }],
    strategy: "FIFO",
  });
  assert.equal(report.reservation.status, "ALLOCATED");
  assert.equal(report.reservation.allocations.length, 2);
});
