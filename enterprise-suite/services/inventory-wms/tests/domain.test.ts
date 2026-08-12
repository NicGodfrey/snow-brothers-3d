import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError, newId, nowIso, tenantId } from "@enterprise-suite/shared-kernel";
import {
  Lot,
  SerialUnit,
  StockBalance,
  newTransaction,
  type StockKey,
} from "../src/index.js";

const TENANT = tenantId("t-domain");

function key(overrides: Partial<StockKey> = {}): StockKey {
  return {
    warehouseId: newId("wh"),
    binId: newId("bin"),
    sku: "SKU-1",
    lotId: null,
    ...overrides,
  };
}

test("StockBalance maintains onHand/reserved/available invariants", () => {
  const balance = StockBalance.open(TENANT, key(), "EA");
  balance.receive(10);
  balance.reserve(4);
  assert.equal(balance.available, 6);

  // Issuing only touches the available portion.
  balance.issue(6);
  assert.equal(balance.onHand, 4);
  assert.equal(balance.reserved, 4);
  assert.throws(() => balance.issue(1), (e: DomainError) => e.code === "INSUFFICIENT_STOCK");

  // Consuming reserved shrinks both counters.
  balance.consumeReserved(3);
  assert.equal(balance.onHand, 1);
  assert.equal(balance.reserved, 1);

  balance.releaseReservation(1);
  assert.equal(balance.available, 1);
  assert.throws(
    () => balance.releaseReservation(1),
    (e: DomainError) => e.code === "RESERVATION_UNDERFLOW",
  );
});

test("StockBalance rejects fractional and non-positive movement quantities", () => {
  const balance = StockBalance.open(TENANT, key(), "EA");
  assert.throws(() => balance.receive(0), (e: DomainError) => e.code === "INVALID_QUANTITY");
  assert.throws(() => balance.receive(-5), (e: DomainError) => e.code === "INVALID_QUANTITY");
  assert.throws(() => balance.receive(2.5), (e: DomainError) => e.code === "INVALID_QUANTITY");
});

test("StockBalance adjustTo respects the reserved floor and returns the delta", () => {
  const balance = StockBalance.open(TENANT, key(), "EA");
  balance.receive(10);
  balance.reserve(6);
  assert.equal(balance.adjustTo(8), -2);
  assert.throws(
    () => balance.adjustTo(5),
    (e: DomainError) => e.code === "ADJUSTMENT_BELOW_RESERVED",
  );
  assert.equal(balance.adjustBy(2), 2);
  assert.equal(balance.onHand, 10);
});

test("UOM mismatches are rejected at the balance", () => {
  const balance = StockBalance.open(TENANT, key(), "EA");
  assert.throws(() => balance.assertUomMatches("KG"), (e: DomainError) => e.code === "UOM_MISMATCH");
  balance.assertUomMatches("ea"); // case-insensitive
});

test("newTransaction validates shape per type", () => {
  const base = {
    tenantId: TENANT,
    warehouseId: newId("wh"),
    sku: "SKU-1",
    uom: "EA",
    actorId: "u1" as never,
  };
  const bin1 = newId("bin");
  const bin2 = newId("bin");

  // RECEIPT must have only toBin.
  assert.throws(
    () => newTransaction({ ...base, txnType: "RECEIPT", quantity: 5, fromBinId: bin1 }),
    (e: DomainError) => e.code === "INVALID_TRANSACTION",
  );
  // TRANSFER bins must differ.
  assert.throws(
    () =>
      newTransaction({ ...base, txnType: "TRANSFER", quantity: 5, fromBinId: bin1, toBinId: bin1 }),
    (e: DomainError) => e.code === "INVALID_TRANSACTION",
  );
  // ADJUSTMENT requires reason and non-zero signed qty.
  assert.throws(
    () => newTransaction({ ...base, txnType: "ADJUSTMENT", quantity: 0, toBinId: bin1 }),
    (e: DomainError) => e.code === "INVALID_QUANTITY",
  );
  assert.throws(
    () => newTransaction({ ...base, txnType: "ADJUSTMENT", quantity: -2, toBinId: bin1 }),
    (e: DomainError) => e.code === "INVALID_TRANSACTION",
  );
  const adjustment = newTransaction({
    ...base,
    txnType: "ADJUSTMENT",
    quantity: -2,
    toBinId: bin1,
    reasonCode: "DAMAGE",
  });
  assert.equal(adjustment.quantity, -2);
  // Records are frozen.
  assert.throws(() => {
    (adjustment as { quantity: number }).quantity = 99;
  });
  const transfer = newTransaction({
    ...base,
    txnType: "TRANSFER",
    quantity: 5,
    fromBinId: bin1,
    toBinId: bin2,
  });
  assert.equal(transfer.txnType, "TRANSFER");
});

test("Lot status machine and expiry checks", () => {
  const lot = Lot.create(TENANT, {
    sku: "SKU-1",
    lotCode: "L-1",
    expiresAt: new Date(Date.now() - 1000).toISOString() as never,
  });
  assert.equal(lot.status, "AVAILABLE");
  assert.equal(lot.isExpiredAt(nowIso()), true);
  assert.equal(lot.isUsableAt(nowIso()), false);
  lot.quarantine();
  lot.release();
  lot.markExpired();
  // EXPIRED -> QUARANTINE is illegal.
  assert.throws(() => lot.quarantine(), (e: DomainError) => e.status === 409);
  lot.markConsumed();
  assert.throws(() => lot.release(), (e: DomainError) => e.status === 409);
});

test("Lot rejects expiry before manufacture", () => {
  assert.throws(
    () =>
      Lot.create(TENANT, {
        sku: "SKU-1",
        lotCode: "L-BAD",
        manufacturedAt: "2026-06-01T00:00:00.000Z" as never,
        expiresAt: "2026-01-01T00:00:00.000Z" as never,
      }),
    (e: DomainError) => e.code === "INVALID_LOT_DATES",
  );
});

test("SerialUnit status machine covers the full unit lifecycle", () => {
  const warehouseId = newId("wh");
  const binId = newId("bin");
  const serial = SerialUnit.register(TENANT, {
    sku: "SKU-1",
    serialNumber: "SN-1",
    warehouseId,
    binId,
  });
  serial.reserve();
  serial.unreserve();
  serial.reserve();
  serial.ship();
  assert.equal(serial.status, "SHIPPED");
  assert.equal(serial.binId, null);
  // Shipped units cannot be re-reserved.
  assert.throws(() => serial.reserve(), (e: DomainError) => e.status === 409);
  serial.returnToStock(warehouseId, binId);
  assert.equal(serial.status, "IN_STOCK");
  assert.equal(serial.binId, binId);
  serial.scrap();
  assert.throws(() => serial.reserve(), (e: DomainError) => e.status === 409);
});
