import type { EventEnvelope, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { CycleCountOrder, CycleCountStatus } from "../domain/cycle-count.js";
import type {
  InventoryTransactionRecord,
  InventoryTransactionType,
  StockRefType,
} from "../domain/inventory-transaction.js";
import type { Lot, SerialUnit } from "../domain/lot.js";
import type { Reservation, ReservationStatus } from "../domain/reservation.js";
import type { StockBalance, StockKey } from "../domain/stock-balance.js";
import type { PickStatus, PickTask, PutawayStatus, PutawayTask } from "../domain/tasks.js";
import type { Bin, Warehouse, Zone } from "../domain/warehouse.js";

/**
 * Persistence ports. All methods are async so the in-memory implementations
 * can be swapped for Postgres without touching the application layer.
 */

export interface WarehouseRepository {
  save(warehouse: Warehouse): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<Warehouse | null>;
  findByCode(tenantId: TenantId, code: string): Promise<Warehouse | null>;
  list(tenantId: TenantId): Promise<Warehouse[]>;
}

export interface ZoneRepository {
  save(zone: Zone): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<Zone | null>;
  findByCode(tenantId: TenantId, warehouseId: Ulid, code: string): Promise<Zone | null>;
  listByWarehouse(tenantId: TenantId, warehouseId: Ulid): Promise<Zone[]>;
}

export interface BinRepository {
  save(bin: Bin): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<Bin | null>;
  findByCode(tenantId: TenantId, warehouseId: Ulid, code: string): Promise<Bin | null>;
  listByZone(tenantId: TenantId, zoneId: Ulid): Promise<Bin[]>;
  listByWarehouse(tenantId: TenantId, warehouseId: Ulid): Promise<Bin[]>;
}

export interface LotRepository {
  save(lot: Lot): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<Lot | null>;
  findByCode(tenantId: TenantId, sku: string, lotCode: string): Promise<Lot | null>;
  listBySku(tenantId: TenantId, sku: string): Promise<Lot[]>;
}

export interface SerialRepository {
  save(serial: SerialUnit): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<SerialUnit | null>;
  findBySerialNumber(
    tenantId: TenantId,
    sku: string,
    serialNumber: string,
  ): Promise<SerialUnit | null>;
  listBySku(tenantId: TenantId, sku: string): Promise<SerialUnit[]>;
  listByBin(tenantId: TenantId, binId: Ulid): Promise<SerialUnit[]>;
}

export interface StockBalanceFilter {
  warehouseId?: Ulid;
  binId?: Ulid;
  sku?: string;
  lotId?: Ulid | null;
  /** Only balances with onHand or reserved > 0. */
  nonEmptyOnly?: boolean;
}

export interface StockBalanceRepository {
  save(balance: StockBalance): Promise<void>;
  findByKey(tenantId: TenantId, key: StockKey): Promise<StockBalance | null>;
  list(tenantId: TenantId, filter?: StockBalanceFilter): Promise<StockBalance[]>;
}

export interface TransactionFilter {
  warehouseId?: Ulid;
  sku?: string;
  txnType?: InventoryTransactionType;
  refType?: StockRefType;
  refId?: string;
  binId?: Ulid;
}

export interface InventoryTransactionRepository {
  append(record: InventoryTransactionRecord): Promise<void>;
  list(tenantId: TenantId, filter?: TransactionFilter): Promise<InventoryTransactionRecord[]>;
}

export interface ReservationFilter {
  warehouseId?: Ulid;
  salesOrderId?: string;
  status?: ReservationStatus;
  activeOnly?: boolean;
}

export interface ReservationRepository {
  save(reservation: Reservation): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<Reservation | null>;
  list(tenantId: TenantId, filter?: ReservationFilter): Promise<Reservation[]>;
}

export interface CycleCountFilter {
  warehouseId?: Ulid;
  status?: CycleCountStatus;
}

export interface CycleCountRepository {
  save(order: CycleCountOrder): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<CycleCountOrder | null>;
  list(tenantId: TenantId, filter?: CycleCountFilter): Promise<CycleCountOrder[]>;
}

export interface PutawayTaskFilter {
  warehouseId?: Ulid;
  status?: PutawayStatus;
  assignedTo?: string;
  openOnly?: boolean;
}

export interface PutawayTaskRepository {
  save(task: PutawayTask): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<PutawayTask | null>;
  list(tenantId: TenantId, filter?: PutawayTaskFilter): Promise<PutawayTask[]>;
}

export interface PickTaskFilter {
  warehouseId?: Ulid;
  reservationId?: Ulid;
  status?: PickStatus;
  assignedTo?: string;
  openOnly?: boolean;
}

export interface PickTaskRepository {
  save(task: PickTask): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<PickTask | null>;
  findByAllocationId(tenantId: TenantId, allocationId: Ulid): Promise<PickTask | null>;
  list(tenantId: TenantId, filter?: PickTaskFilter): Promise<PickTask[]>;
}

/**
 * Transactional outbox port. Application services publish the envelopes pulled
 * from aggregates after all repository writes for the use case have succeeded.
 */
export interface EventOutbox {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}
