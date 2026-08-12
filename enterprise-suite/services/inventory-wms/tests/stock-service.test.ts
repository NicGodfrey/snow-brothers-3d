import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { InventoryEvents } from "../src/index.js";
import { SKU_WIDGET, buildFixture, seedLottedStock, seedStock } from "./fixtures.js";

test("receiveStock opens a balance, writes a RECEIPT ledger row and emits StockReceived", async () => {
  const fixture = await buildFixture();
  const result = await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.receivingBin.id,
    sku: SKU_WIDGET,
    quantity: 50,
    ref: { type: "PURCHASE_ORDER", id: "PO-1001" },
  });
  assert.equal(result.balance.onHand, 50);
  assert.equal(result.balance.reserved, 0);
  assert.equal(result.balance.available, 50);
  assert.equal(result.transaction.txnType, "RECEIPT");
  assert.equal(result.transaction.toBinId, fixture.receivingBin.id);
  assert.equal(result.transaction.ref?.id, "PO-1001");

  const ledger = await fixture.module.stockService.listTransactions(fixture.ctx, {
    refType: "PURCHASE_ORDER",
    refId: "PO-1001",
  });
  assert.equal(ledger.length, 1);
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.StockReceived).length, 1);
});

test("receiving twice accumulates on the same balance row", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 15);
  const balances = await fixture.module.stockService.listBalances(fixture.ctx, {
    sku: SKU_WIDGET,
  });
  assert.equal(balances.length, 1);
  assert.equal(balances[0]!.onHand, 25);
});

test("receiveStock with lot creates the lot and keys the balance by lot", async () => {
  const fixture = await buildFixture();
  await seedLottedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 30, "LOT-A", 90);
  await seedLottedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 20, "LOT-B", 30);
  const lots = await fixture.module.stockService.listLots(fixture.ctx, SKU_WIDGET);
  assert.equal(lots.length, 2);
  const balances = await fixture.module.stockService.listBalances(fixture.ctx, {
    sku: SKU_WIDGET,
  });
  assert.equal(balances.length, 2); // one per lot
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.LotCreated).length, 2);
});

test("receiveStock registers serial numbers; count mismatch and duplicates rejected", async () => {
  const fixture = await buildFixture();
  const result = await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.storageBinA.id,
    sku: "LAPTOP-1",
    quantity: 2,
    serialNumbers: ["SN-001", "SN-002"],
  });
  assert.equal(result.serials.length, 2);
  assert.equal(result.serials[0]!.status, "IN_STOCK");

  await assert.rejects(
    fixture.module.stockService.receiveStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.storageBinA.id,
      sku: "LAPTOP-1",
      quantity: 2,
      serialNumbers: ["SN-003"],
    }),
    (err: DomainError) => err.code === "VALIDATION",
  );
  await assert.rejects(
    fixture.module.stockService.receiveStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.storageBinA.id,
      sku: "LAPTOP-1",
      quantity: 1,
      serialNumbers: ["SN-001"],
    }),
    (err: DomainError) => err.code === "CONFLICT",
  );
});

test("receiveStock into blocked bin or over capacity is rejected", async () => {
  const fixture = await buildFixture();
  await fixture.module.warehouseService.blockBin(fixture.ctx, fixture.storageBinA.id, "damaged");
  await assert.rejects(
    seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5),
    (err: DomainError) => err.code === "BIN_BLOCKED",
  );

  const smallBin = await fixture.module.warehouseService.addBin(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    zoneId: fixture.storageZone.id,
    code: "SMALL-01",
    binType: "SHELF",
    maxUnits: 10,
  });
  await seedStock(fixture, smallBin.id, SKU_WIDGET, 8);
  await assert.rejects(
    seedStock(fixture, smallBin.id, SKU_WIDGET, 3),
    (err: DomainError) => err.code === "CONFLICT" && /capacity/.test(err.message),
  );
});

test("issueStock decrements and refuses to issue more than available", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await fixture.module.stockService.issueStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.storageBinA.id,
    sku: SKU_WIDGET,
    quantity: 4,
  });
  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.onHand, 6);
  await assert.rejects(
    fixture.module.stockService.issueStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.storageBinA.id,
      sku: SKU_WIDGET,
      quantity: 7,
    }),
    (err: DomainError) => err.code === "INSUFFICIENT_STOCK",
  );
});

test("issueStock on a bin with no balance returns NO_BALANCE", async () => {
  const fixture = await buildFixture();
  await assert.rejects(
    fixture.module.stockService.issueStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.storageBinA.id,
      sku: "GHOST-SKU",
      quantity: 1,
    }),
    (err: DomainError) => err.code === "NO_BALANCE",
  );
});

test("transferStock moves quantity between bins and writes one TRANSFER row", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.receivingBin.id, SKU_WIDGET, 40);
  const result = await fixture.module.stockService.transferStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    fromBinId: fixture.receivingBin.id,
    toBinId: fixture.storageBinA.id,
    sku: SKU_WIDGET,
    quantity: 25,
  });
  assert.equal(result.transaction.txnType, "TRANSFER");

  const balances = await fixture.module.stockService.listBalances(fixture.ctx, {
    sku: SKU_WIDGET,
    nonEmptyOnly: true,
  });
  const byBin = new Map(balances.map((b) => [b.binId, b.onHand]));
  assert.equal(byBin.get(fixture.receivingBin.id), 15);
  assert.equal(byBin.get(fixture.storageBinA.id), 25);
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.StockTransferred).length, 1);
});

test("transferStock cannot move reserved quantity", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-1",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 8 }],
  });
  await assert.rejects(
    fixture.module.stockService.transferStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      fromBinId: fixture.storageBinA.id,
      toBinId: fixture.storageBinB.id,
      sku: SKU_WIDGET,
      quantity: 5, // only 2 available
    }),
    (err: DomainError) => err.code === "INSUFFICIENT_STOCK",
  );
});

test("adjustStock supports absolute and delta modes with reason codes", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 20);

  const down = await fixture.module.stockService.adjustStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.storageBinA.id,
    sku: SKU_WIDGET,
    newOnHand: 17,
    reasonCode: "DAMAGE",
  });
  assert.equal(down.transaction.quantity, -3);
  assert.equal(down.transaction.txnType, "ADJUSTMENT");

  const up = await fixture.module.stockService.adjustStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.storageBinA.id,
    sku: SKU_WIDGET,
    deltaQty: 5,
    reasonCode: "FOUND",
  });
  assert.equal(up.transaction.quantity, 5);

  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.onHand, 22);

  // Both modes at once is a validation error.
  await assert.rejects(
    fixture.module.stockService.adjustStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.storageBinA.id,
      sku: SKU_WIDGET,
      newOnHand: 1,
      deltaQty: 1,
      reasonCode: "CORRECTION",
    }),
    (err: DomainError) => err.code === "VALIDATION",
  );
});

test("adjustStock cannot go below reserved quantity", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await fixture.module.reservationService.createReservation(fixture.ctx, {
    salesOrderId: "SO-2",
    warehouseId: fixture.warehouse.id,
    lines: [{ sku: SKU_WIDGET, qty: 6 }],
  });
  await assert.rejects(
    fixture.module.stockService.adjustStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.storageBinA.id,
      sku: SKU_WIDGET,
      newOnHand: 4,
      reasonCode: "SHRINKAGE",
    }),
    (err: DomainError) => err.code === "ADJUSTMENT_BELOW_RESERVED",
  );
});

test("getAvailability aggregates across bins and lots", async () => {
  const fixture = await buildFixture();
  await seedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 10);
  await seedLottedStock(fixture, fixture.storageBinB.id, SKU_WIDGET, 5, "LOT-X", 60);
  const availability = await fixture.module.stockService.getAvailability(fixture.ctx, SKU_WIDGET);
  assert.equal(availability.onHand, 15);
  assert.equal(availability.available, 15);
  assert.equal(availability.byBin.length, 2);
});

test("lot quarantine blocks receiving into that lot", async () => {
  const fixture = await buildFixture();
  await seedLottedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5, "LOT-Q", 60);
  const [lot] = await fixture.module.stockService.listLots(fixture.ctx, SKU_WIDGET);
  await fixture.module.stockService.setLotStatus(fixture.ctx, lot!.id, "quarantine");
  await assert.rejects(
    seedLottedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5, "LOT-Q", 60),
    (err: DomainError) => err.code === "LOT_NOT_USABLE",
  );
  // releasing makes it usable again
  await fixture.module.stockService.setLotStatus(fixture.ctx, lot!.id, "release");
  await seedLottedStock(fixture, fixture.storageBinA.id, SKU_WIDGET, 5, "LOT-Q", 60);
});

test("tenants are fully isolated", async () => {
  const fixtureA = await buildFixture("tenant-a");
  const balancesB = await fixtureA.module.stockService.listBalances(
    { ...fixtureA.ctx, tenantId: "tenant-b" as never },
    {},
  );
  assert.equal(balancesB.length, 0);
});
