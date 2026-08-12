import {
  ConflictError,
  NotFoundError,
  envelope,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InventoryEvents } from "../domain/events.js";
import {
  Bin,
  Warehouse,
  Zone,
  normalizeCode,
  type BinType,
  type ZoneType,
} from "../domain/warehouse.js";
import type {
  BinRepository,
  EventOutbox,
  WarehouseRepository,
  ZoneRepository,
} from "./ports.js";

export interface CreateWarehouseCommand {
  code: string;
  name: string;
  addressLine1?: string;
  city?: string;
  country?: string;
  timezone?: string;
}

export interface AddZoneCommand {
  warehouseId: Ulid;
  code: string;
  name: string;
  zoneType: ZoneType;
}

export interface AddBinCommand {
  warehouseId: Ulid;
  zoneId: Ulid;
  code: string;
  binType: BinType;
  maxUnits?: number;
  pickSequence?: number;
}

export interface WarehouseTopology {
  warehouse: Warehouse;
  zones: { zone: Zone; bins: Bin[] }[];
}

export class WarehouseService {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly zones: ZoneRepository,
    private readonly bins: BinRepository,
    private readonly outbox: EventOutbox,
  ) {}

  async createWarehouse(ctx: TenantContext, cmd: CreateWarehouseCommand): Promise<Warehouse> {
    const code = normalizeCode(cmd.code, "warehouse code");
    const existing = await this.warehouses.findByCode(ctx.tenantId, code);
    if (existing) {
      throw new ConflictError(`Warehouse code ${code} already exists`);
    }
    const warehouse = Warehouse.create(ctx.tenantId, cmd);
    await this.warehouses.save(warehouse);
    await this.outbox.publish(warehouse.pullEvents());
    return warehouse;
  }

  async getWarehouse(ctx: TenantContext, id: Ulid): Promise<Warehouse> {
    const warehouse = await this.warehouses.findById(ctx.tenantId, id);
    if (!warehouse) throw new NotFoundError("Warehouse", id);
    return warehouse;
  }

  async listWarehouses(ctx: TenantContext): Promise<Warehouse[]> {
    return this.warehouses.list(ctx.tenantId);
  }

  async renameWarehouse(ctx: TenantContext, id: Ulid, name: string): Promise<Warehouse> {
    const warehouse = await this.getWarehouse(ctx, id);
    warehouse.rename(name);
    await this.warehouses.save(warehouse);
    return warehouse;
  }

  async setWarehouseStatus(
    ctx: TenantContext,
    id: Ulid,
    action: "activate" | "deactivate",
  ): Promise<Warehouse> {
    const warehouse = await this.getWarehouse(ctx, id);
    if (action === "activate") warehouse.activate();
    else warehouse.deactivate();
    await this.warehouses.save(warehouse);
    await this.outbox.publish(warehouse.pullEvents());
    return warehouse;
  }

  async addZone(ctx: TenantContext, cmd: AddZoneCommand): Promise<Zone> {
    const warehouse = await this.getWarehouse(ctx, cmd.warehouseId);
    const code = normalizeCode(cmd.code, "zone code");
    const existing = await this.zones.findByCode(ctx.tenantId, warehouse.id, code);
    if (existing) {
      throw new ConflictError(`Zone code ${code} already exists in warehouse ${warehouse.code}`);
    }
    const zone = Zone.create(ctx.tenantId, {
      warehouseId: warehouse.id,
      code,
      name: cmd.name,
      zoneType: cmd.zoneType,
    });
    await this.zones.save(zone);
    await this.outbox.publish([
      envelope({
        eventType: InventoryEvents.ZoneAdded,
        aggregateType: "Zone",
        aggregateId: zone.id,
        tenantId: ctx.tenantId,
        payload: { warehouseId: warehouse.id, code: zone.code, zoneType: zone.zoneType },
      }),
    ]);
    return zone;
  }

  async addBin(ctx: TenantContext, cmd: AddBinCommand): Promise<Bin> {
    const warehouse = await this.getWarehouse(ctx, cmd.warehouseId);
    const zone = await this.zones.findById(ctx.tenantId, cmd.zoneId);
    if (!zone || zone.warehouseId !== warehouse.id) {
      throw new NotFoundError("Zone", cmd.zoneId);
    }
    const code = normalizeCode(cmd.code, "bin code");
    const existing = await this.bins.findByCode(ctx.tenantId, warehouse.id, code);
    if (existing) {
      throw new ConflictError(`Bin code ${code} already exists in warehouse ${warehouse.code}`);
    }
    const bin = Bin.create(ctx.tenantId, {
      warehouseId: warehouse.id,
      zoneId: zone.id,
      code,
      binType: cmd.binType,
      maxUnits: cmd.maxUnits,
      pickSequence: cmd.pickSequence,
    });
    await this.bins.save(bin);
    await this.outbox.publish([
      envelope({
        eventType: InventoryEvents.BinAdded,
        aggregateType: "Bin",
        aggregateId: bin.id,
        tenantId: ctx.tenantId,
        payload: { warehouseId: warehouse.id, zoneId: zone.id, code: bin.code },
      }),
    ]);
    return bin;
  }

  async getBin(ctx: TenantContext, binId: Ulid): Promise<Bin> {
    const bin = await this.bins.findById(ctx.tenantId, binId);
    if (!bin) throw new NotFoundError("Bin", binId);
    return bin;
  }

  async blockBin(ctx: TenantContext, binId: Ulid, reason: string): Promise<Bin> {
    const bin = await this.getBin(ctx, binId);
    bin.block(reason);
    await this.bins.save(bin);
    await this.outbox.publish([
      envelope({
        eventType: InventoryEvents.BinBlocked,
        aggregateType: "Bin",
        aggregateId: bin.id,
        tenantId: ctx.tenantId,
        payload: { warehouseId: bin.warehouseId, code: bin.code, reason },
      }),
    ]);
    return bin;
  }

  async unblockBin(ctx: TenantContext, binId: Ulid): Promise<Bin> {
    const bin = await this.getBin(ctx, binId);
    bin.unblock();
    await this.bins.save(bin);
    await this.outbox.publish([
      envelope({
        eventType: InventoryEvents.BinUnblocked,
        aggregateType: "Bin",
        aggregateId: bin.id,
        tenantId: ctx.tenantId,
        payload: { warehouseId: bin.warehouseId, code: bin.code },
      }),
    ]);
    return bin;
  }

  async getTopology(ctx: TenantContext, warehouseId: Ulid): Promise<WarehouseTopology> {
    const warehouse = await this.getWarehouse(ctx, warehouseId);
    const zones = await this.zones.listByWarehouse(ctx.tenantId, warehouse.id);
    const result: WarehouseTopology = { warehouse, zones: [] };
    for (const zone of zones) {
      const bins = await this.bins.listByZone(ctx.tenantId, zone.id);
      bins.sort((a, b) => a.pickSequence - b.pickSequence || a.code.localeCompare(b.code));
      result.zones.push({ zone, bins });
    }
    return result;
  }
}
