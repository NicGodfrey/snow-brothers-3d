import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type {
  BinRepository,
  CycleCountFilter,
  CycleCountRepository,
  InventoryTransactionRepository,
  LotRepository,
  PickTaskFilter,
  PickTaskRepository,
  PutawayTaskFilter,
  PutawayTaskRepository,
  ReservationFilter,
  ReservationRepository,
  SerialRepository,
  StockBalanceFilter,
  StockBalanceRepository,
  TransactionFilter,
  WarehouseRepository,
  ZoneRepository,
} from "../../application/ports.js";
import type { CycleCountOrder } from "../../domain/cycle-count.js";
import type { InventoryTransactionRecord } from "../../domain/inventory-transaction.js";
import type { Lot, SerialUnit } from "../../domain/lot.js";
import { ACTIVE_RESERVATION_STATUSES, type Reservation } from "../../domain/reservation.js";
import { stockKeyString, type StockBalance, type StockKey } from "../../domain/stock-balance.js";
import type { PickTask, PutawayTask } from "../../domain/tasks.js";
import type { Bin, Warehouse, Zone } from "../../domain/warehouse.js";

/**
 * In-memory adapters. Every store is keyed by tenant first so cross-tenant
 * reads are structurally impossible, mirroring the row-level tenant scoping
 * the SQL schema enforces.
 */
class TenantStore<T extends { id: Ulid; tenantId: TenantId }> {
  private readonly byTenant = new Map<TenantId, Map<string, T>>();

  save(item: T): void {
    let store = this.byTenant.get(item.tenantId);
    if (!store) {
      store = new Map();
      this.byTenant.set(item.tenantId, store);
    }
    store.set(String(item.id), item);
  }

  find(tenantId: TenantId, id: Ulid): T | null {
    return this.byTenant.get(tenantId)?.get(String(id)) ?? null;
  }

  all(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export class MemoryWarehouseRepository implements WarehouseRepository {
  private readonly store = new TenantStore<Warehouse>();

  async save(warehouse: Warehouse): Promise<void> {
    this.store.save(warehouse);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<Warehouse | null> {
    return this.store.find(tenantId, id);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<Warehouse | null> {
    return this.store.all(tenantId).find((w) => w.code === code) ?? null;
  }

  async list(tenantId: TenantId): Promise<Warehouse[]> {
    return this.store.all(tenantId).sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class MemoryZoneRepository implements ZoneRepository {
  private readonly store = new TenantStore<Zone>();

  async save(zone: Zone): Promise<void> {
    this.store.save(zone);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<Zone | null> {
    return this.store.find(tenantId, id);
  }

  async findByCode(tenantId: TenantId, warehouseId: Ulid, code: string): Promise<Zone | null> {
    return (
      this.store
        .all(tenantId)
        .find((z) => z.warehouseId === warehouseId && z.code === code) ?? null
    );
  }

  async listByWarehouse(tenantId: TenantId, warehouseId: Ulid): Promise<Zone[]> {
    return this.store
      .all(tenantId)
      .filter((z) => z.warehouseId === warehouseId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class MemoryBinRepository implements BinRepository {
  private readonly store = new TenantStore<Bin>();

  async save(bin: Bin): Promise<void> {
    this.store.save(bin);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<Bin | null> {
    return this.store.find(tenantId, id);
  }

  async findByCode(tenantId: TenantId, warehouseId: Ulid, code: string): Promise<Bin | null> {
    return (
      this.store
        .all(tenantId)
        .find((b) => b.warehouseId === warehouseId && b.code === code) ?? null
    );
  }

  async listByZone(tenantId: TenantId, zoneId: Ulid): Promise<Bin[]> {
    return this.store.all(tenantId).filter((b) => b.zoneId === zoneId);
  }

  async listByWarehouse(tenantId: TenantId, warehouseId: Ulid): Promise<Bin[]> {
    return this.store.all(tenantId).filter((b) => b.warehouseId === warehouseId);
  }
}

// ---------------------------------------------------------------------------
// Lots & serials
// ---------------------------------------------------------------------------

export class MemoryLotRepository implements LotRepository {
  private readonly store = new TenantStore<Lot>();

  async save(lot: Lot): Promise<void> {
    this.store.save(lot);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<Lot | null> {
    return this.store.find(tenantId, id);
  }

  async findByCode(tenantId: TenantId, sku: string, lotCode: string): Promise<Lot | null> {
    return (
      this.store.all(tenantId).find((l) => l.sku === sku && l.lotCode === lotCode) ?? null
    );
  }

  async listBySku(tenantId: TenantId, sku: string): Promise<Lot[]> {
    return this.store
      .all(tenantId)
      .filter((l) => l.sku === sku)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }
}

export class MemorySerialRepository implements SerialRepository {
  private readonly store = new TenantStore<SerialUnit>();

  async save(serial: SerialUnit): Promise<void> {
    this.store.save(serial);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<SerialUnit | null> {
    return this.store.find(tenantId, id);
  }

  async findBySerialNumber(
    tenantId: TenantId,
    sku: string,
    serialNumber: string,
  ): Promise<SerialUnit | null> {
    return (
      this.store
        .all(tenantId)
        .find((s) => s.sku === sku && s.serialNumber === serialNumber) ?? null
    );
  }

  async listBySku(tenantId: TenantId, sku: string): Promise<SerialUnit[]> {
    return this.store.all(tenantId).filter((s) => s.sku === sku);
  }

  async listByBin(tenantId: TenantId, binId: Ulid): Promise<SerialUnit[]> {
    return this.store.all(tenantId).filter((s) => s.binId === binId);
  }
}

// ---------------------------------------------------------------------------
// Stock balances & ledger
// ---------------------------------------------------------------------------

export class MemoryStockBalanceRepository implements StockBalanceRepository {
  private readonly store = new TenantStore<StockBalance>();
  private readonly byKey = new Map<string, StockBalance>();

  async save(balance: StockBalance): Promise<void> {
    this.store.save(balance);
    this.byKey.set(stockKeyString(balance.tenantId, balance.key), balance);
  }

  async findByKey(tenantId: TenantId, key: StockKey): Promise<StockBalance | null> {
    return this.byKey.get(stockKeyString(tenantId, key)) ?? null;
  }

  async list(tenantId: TenantId, filter: StockBalanceFilter = {}): Promise<StockBalance[]> {
    return this.store
      .all(tenantId)
      .filter((b) => {
        if (filter.warehouseId && b.warehouseId !== filter.warehouseId) return false;
        if (filter.binId && b.binId !== filter.binId) return false;
        if (filter.sku && b.sku !== filter.sku) return false;
        if (filter.lotId !== undefined && b.lotId !== filter.lotId) return false;
        if (filter.nonEmptyOnly && b.isEmpty) return false;
        return true;
      })
      .sort((a, b) => a.sku.localeCompare(b.sku) || String(a.id).localeCompare(String(b.id)));
  }
}

export class MemoryInventoryTransactionRepository implements InventoryTransactionRepository {
  private readonly byTenant = new Map<TenantId, InventoryTransactionRecord[]>();

  async append(record: InventoryTransactionRecord): Promise<void> {
    const list = this.byTenant.get(record.tenantId) ?? [];
    list.push(record);
    this.byTenant.set(record.tenantId, list);
  }

  async list(
    tenantId: TenantId,
    filter: TransactionFilter = {},
  ): Promise<InventoryTransactionRecord[]> {
    return (this.byTenant.get(tenantId) ?? []).filter((t) => {
      if (filter.warehouseId && t.warehouseId !== filter.warehouseId) return false;
      if (filter.sku && t.sku !== filter.sku) return false;
      if (filter.txnType && t.txnType !== filter.txnType) return false;
      if (filter.refType && t.ref?.type !== filter.refType) return false;
      if (filter.refId && t.ref?.id !== filter.refId) return false;
      if (filter.binId && t.fromBinId !== filter.binId && t.toBinId !== filter.binId) return false;
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// Reservations, cycle counts, tasks
// ---------------------------------------------------------------------------

export class MemoryReservationRepository implements ReservationRepository {
  private readonly store = new TenantStore<Reservation>();

  async save(reservation: Reservation): Promise<void> {
    this.store.save(reservation);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<Reservation | null> {
    return this.store.find(tenantId, id);
  }

  async list(tenantId: TenantId, filter: ReservationFilter = {}): Promise<Reservation[]> {
    return this.store
      .all(tenantId)
      .filter((r) => {
        if (filter.warehouseId && r.warehouseId !== filter.warehouseId) return false;
        if (filter.salesOrderId && r.salesOrderId !== filter.salesOrderId) return false;
        if (filter.status && r.status !== filter.status) return false;
        if (filter.activeOnly && !ACTIVE_RESERVATION_STATUSES.includes(r.status)) return false;
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class MemoryCycleCountRepository implements CycleCountRepository {
  private readonly store = new TenantStore<CycleCountOrder>();

  async save(order: CycleCountOrder): Promise<void> {
    this.store.save(order);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<CycleCountOrder | null> {
    return this.store.find(tenantId, id);
  }

  async list(tenantId: TenantId, filter: CycleCountFilter = {}): Promise<CycleCountOrder[]> {
    return this.store
      .all(tenantId)
      .filter((o) => {
        if (filter.warehouseId && o.warehouseId !== filter.warehouseId) return false;
        if (filter.status && o.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class MemoryPutawayTaskRepository implements PutawayTaskRepository {
  private readonly store = new TenantStore<PutawayTask>();

  async save(task: PutawayTask): Promise<void> {
    this.store.save(task);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<PutawayTask | null> {
    return this.store.find(tenantId, id);
  }

  async list(tenantId: TenantId, filter: PutawayTaskFilter = {}): Promise<PutawayTask[]> {
    return this.store
      .all(tenantId)
      .filter((t) => {
        if (filter.warehouseId && t.warehouseId !== filter.warehouseId) return false;
        if (filter.status && t.status !== filter.status) return false;
        if (filter.assignedTo && String(t.assignedTo) !== filter.assignedTo) return false;
        if (filter.openOnly && !t.isOpen) return false;
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class MemoryPickTaskRepository implements PickTaskRepository {
  private readonly store = new TenantStore<PickTask>();

  async save(task: PickTask): Promise<void> {
    this.store.save(task);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<PickTask | null> {
    return this.store.find(tenantId, id);
  }

  async findByAllocationId(tenantId: TenantId, allocationId: Ulid): Promise<PickTask | null> {
    return this.store.all(tenantId).find((t) => t.allocationId === allocationId) ?? null;
  }

  async list(tenantId: TenantId, filter: PickTaskFilter = {}): Promise<PickTask[]> {
    return this.store
      .all(tenantId)
      .filter((t) => {
        if (filter.warehouseId && t.warehouseId !== filter.warehouseId) return false;
        if (filter.reservationId && t.reservationId !== filter.reservationId) return false;
        if (filter.status && t.status !== filter.status) return false;
        if (filter.assignedTo && String(t.assignedTo) !== filter.assignedTo) return false;
        if (filter.openOnly && !t.isOpen) return false;
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
