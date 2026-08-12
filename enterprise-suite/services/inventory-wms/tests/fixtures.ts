import { createTenantContext, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { createInventoryModule, type InventoryModule } from "../src/index.js";
import type { Bin, Warehouse, Zone } from "../src/index.js";

export const SKU_WIDGET = "WIDGET-100";
export const SKU_GADGET = "GADGET-200";

export interface Fixture {
  module: InventoryModule;
  ctx: TenantContext;
  warehouse: Warehouse;
  receivingZone: Zone;
  storageZone: Zone;
  receivingBin: Bin;
  storageBinA: Bin;
  storageBinB: Bin;
}

/** Standard topology: one warehouse, receiving + storage zones, three bins. */
export async function buildFixture(tenant = "tenant-a"): Promise<Fixture> {
  const module = createInventoryModule();
  const ctx = createTenantContext(tenant, "user-1", ["inventory.write"]);

  const warehouse = await module.warehouseService.createWarehouse(ctx, {
    code: "WH1",
    name: "Central DC",
    city: "Rotterdam",
    country: "NL",
  });
  const receivingZone = await module.warehouseService.addZone(ctx, {
    warehouseId: warehouse.id,
    code: "RCV",
    name: "Receiving dock",
    zoneType: "RECEIVING",
  });
  const storageZone = await module.warehouseService.addZone(ctx, {
    warehouseId: warehouse.id,
    code: "STO",
    name: "Bulk storage",
    zoneType: "STORAGE",
  });
  const receivingBin = await module.warehouseService.addBin(ctx, {
    warehouseId: warehouse.id,
    zoneId: receivingZone.id,
    code: "RCV-01",
    binType: "STAGING",
    pickSequence: 0,
  });
  const storageBinA = await module.warehouseService.addBin(ctx, {
    warehouseId: warehouse.id,
    zoneId: storageZone.id,
    code: "A-01-01",
    binType: "SHELF",
    pickSequence: 10,
  });
  const storageBinB = await module.warehouseService.addBin(ctx, {
    warehouseId: warehouse.id,
    zoneId: storageZone.id,
    code: "A-01-02",
    binType: "SHELF",
    pickSequence: 20,
  });

  return {
    module,
    ctx,
    warehouse,
    receivingZone,
    storageZone,
    receivingBin,
    storageBinA,
    storageBinB,
  };
}

/** Receive un-lotted stock straight into a bin. */
export async function seedStock(
  fixture: Fixture,
  binId: Ulid,
  sku: string,
  quantity: number,
): Promise<void> {
  await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId,
    sku,
    quantity,
  });
}

/** Receive lotted stock with an expiry date offset (in days from now). */
export async function seedLottedStock(
  fixture: Fixture,
  binId: Ulid,
  sku: string,
  quantity: number,
  lotCode: string,
  expiresInDays: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  await fixture.module.stockService.receiveStock(fixture.ctx, {
    warehouseId: fixture.warehouse.id,
    binId,
    sku,
    quantity,
    lot: { lotCode, expiresAt: expiresAt as never },
  });
}
