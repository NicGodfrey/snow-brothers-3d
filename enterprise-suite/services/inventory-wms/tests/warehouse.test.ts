import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError, createTenantContext } from "@enterprise-suite/shared-kernel";
import { InventoryEvents, createInventoryModule } from "../src/index.js";
import { buildFixture } from "./fixtures.js";

test("createWarehouse normalizes the code and emits WarehouseCreated", async () => {
  const module = createInventoryModule();
  const ctx = createTenantContext("t1", "u1", ["inventory.write"]);
  const warehouse = await module.warehouseService.createWarehouse(ctx, {
    code: "wh-east ",
    name: "East DC",
  });
  assert.equal(warehouse.code, "WH-EAST");
  assert.equal(warehouse.status, "ACTIVE");
  assert.equal(module.outbox.eventsOfType(InventoryEvents.WarehouseCreated).length, 1);
});

test("duplicate warehouse code within a tenant is rejected", async () => {
  const module = createInventoryModule();
  const ctx = createTenantContext("t1", "u1");
  await module.warehouseService.createWarehouse(ctx, { code: "WH1", name: "First" });
  await assert.rejects(
    module.warehouseService.createWarehouse(ctx, { code: "wh1", name: "Second" }),
    (err: DomainError) => err.code === "CONFLICT",
  );
});

test("same warehouse code is allowed for different tenants", async () => {
  const module = createInventoryModule();
  const ctxA = createTenantContext("tenant-a", "u1");
  const ctxB = createTenantContext("tenant-b", "u1");
  const a = await module.warehouseService.createWarehouse(ctxA, { code: "WH1", name: "A" });
  const b = await module.warehouseService.createWarehouse(ctxB, { code: "WH1", name: "B" });
  assert.notEqual(a.id, b.id);
  assert.equal((await module.warehouseService.listWarehouses(ctxA)).length, 1);
});

test("invalid codes are rejected", async () => {
  const module = createInventoryModule();
  const ctx = createTenantContext("t1", "u1");
  await assert.rejects(
    module.warehouseService.createWarehouse(ctx, { code: "no spaces!", name: "X" }),
    (err: DomainError) => err.code === "INVALID_CODE",
  );
});

test("zone and bin codes are unique per warehouse", async () => {
  const fixture = await buildFixture();
  await assert.rejects(
    fixture.module.warehouseService.addZone(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      code: "RCV",
      name: "Duplicate zone",
      zoneType: "RECEIVING",
    }),
    (err: DomainError) => err.code === "CONFLICT",
  );
  await assert.rejects(
    fixture.module.warehouseService.addBin(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      zoneId: fixture.storageZone.id,
      code: "A-01-01",
      binType: "SHELF",
    }),
    (err: DomainError) => err.code === "CONFLICT",
  );
});

test("bin cannot be added to a zone of another warehouse", async () => {
  const fixture = await buildFixture();
  const other = await fixture.module.warehouseService.createWarehouse(fixture.ctx, {
    code: "WH2",
    name: "Other",
  });
  await assert.rejects(
    fixture.module.warehouseService.addBin(fixture.ctx, {
      warehouseId: other.id,
      zoneId: fixture.storageZone.id,
      code: "X-01",
      binType: "SHELF",
    }),
    (err: DomainError) => err.code === "NOT_FOUND",
  );
});

test("block/unblock bin lifecycle and events", async () => {
  const fixture = await buildFixture();
  const blocked = await fixture.module.warehouseService.blockBin(
    fixture.ctx,
    fixture.storageBinA.id,
    "spill cleanup",
  );
  assert.equal(blocked.status, "BLOCKED");
  assert.throws(() => blocked.assertUsable(), (err: DomainError) => err.code === "BIN_BLOCKED");
  // double-block conflicts
  await assert.rejects(
    fixture.module.warehouseService.blockBin(fixture.ctx, fixture.storageBinA.id, "again"),
    (err: DomainError) => err.status === 409,
  );
  const unblocked = await fixture.module.warehouseService.unblockBin(
    fixture.ctx,
    fixture.storageBinA.id,
  );
  assert.equal(unblocked.status, "AVAILABLE");
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.BinBlocked).length, 1);
  assert.equal(fixture.module.outbox.eventsOfType(InventoryEvents.BinUnblocked).length, 1);
});

test("warehouse status machine: deactivate blocks operations, reactivate restores", async () => {
  const fixture = await buildFixture();
  await fixture.module.warehouseService.setWarehouseStatus(
    fixture.ctx,
    fixture.warehouse.id,
    "deactivate",
  );
  await assert.rejects(
    fixture.module.stockService.receiveStock(fixture.ctx, {
      warehouseId: fixture.warehouse.id,
      binId: fixture.receivingBin.id,
      sku: "ANY",
      quantity: 1,
    }),
    (err: DomainError) => err.code === "WAREHOUSE_INACTIVE",
  );
  // deactivating twice is an illegal transition
  await assert.rejects(
    fixture.module.warehouseService.setWarehouseStatus(
      fixture.ctx,
      fixture.warehouse.id,
      "deactivate",
    ),
    (err: DomainError) => err.status === 409,
  );
  await fixture.module.warehouseService.setWarehouseStatus(
    fixture.ctx,
    fixture.warehouse.id,
    "activate",
  );
  const result = await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId: fixture.receivingBin.id,
    sku: "ANY",
    quantity: 1,
  });
  assert.equal(result.balance.onHand, 1);
});

test("topology groups bins under zones sorted by pick sequence", async () => {
  const fixture = await buildFixture();
  const topology = await fixture.module.warehouseService.getTopology(
    fixture.ctx,
    fixture.warehouse.id,
  );
  assert.equal(topology.zones.length, 2);
  const storage = topology.zones.find((z) => z.zone.code === "STO");
  assert.ok(storage);
  assert.deepEqual(
    storage.bins.map((b) => b.code),
    ["A-01-01", "A-01-02"],
  );
});
