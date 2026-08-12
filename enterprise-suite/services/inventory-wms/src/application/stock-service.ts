import {
  ConflictError,
  DomainError,
  NotFoundError,
  envelope,
  nowIso,
  type EventEnvelope,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InventoryEvents, type StockMovementPayload } from "../domain/events.js";
import {
  newTransaction,
  type AdjustmentReason,
  type InventoryTransactionRecord,
  type StockRef,
} from "../domain/inventory-transaction.js";
import { Lot, SerialUnit } from "../domain/lot.js";
import { normalizeUom } from "../domain/quantity.js";
import { StockBalance, type StockKey } from "../domain/stock-balance.js";
import { PutawayTask } from "../domain/tasks.js";
import type { Bin, Warehouse } from "../domain/warehouse.js";
import { invalid } from "./validation.js";
import type {
  BinRepository,
  EventOutbox,
  InventoryTransactionRepository,
  LotRepository,
  PutawayTaskRepository,
  SerialRepository,
  StockBalanceFilter,
  StockBalanceRepository,
  TransactionFilter,
  WarehouseRepository,
} from "./ports.js";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface LotInput {
  lotCode: string;
  manufacturedAt?: IsoDateTime;
  expiresAt?: IsoDateTime;
  supplierRef?: string;
}

export interface ReceiveStockCommand {
  warehouseId: Ulid;
  binId: Ulid;
  sku: string;
  quantity: number;
  uom?: string;
  lot?: LotInput;
  /** Serial numbers to register; when present, length must equal quantity. */
  serialNumbers?: string[];
  ref?: StockRef;
  note?: string;
  /** When set, a PENDING putaway task from the receiving bin is created. */
  putaway?: { suggestedBinId: Ulid };
}

export interface IssueStockCommand {
  warehouseId: Ulid;
  binId: Ulid;
  sku: string;
  lotId?: Ulid | null;
  quantity: number;
  ref?: StockRef;
  note?: string;
}

export interface TransferStockCommand {
  warehouseId: Ulid;
  fromBinId: Ulid;
  toBinId: Ulid;
  sku: string;
  lotId?: Ulid | null;
  quantity: number;
  ref?: StockRef;
  note?: string;
}

export interface AdjustStockCommand {
  warehouseId: Ulid;
  binId: Ulid;
  sku: string;
  lotId?: Ulid | null;
  /** Exactly one of newOnHand / deltaQty must be provided. */
  newOnHand?: number;
  deltaQty?: number;
  reasonCode: AdjustmentReason;
  ref?: StockRef;
  note?: string;
  /** Adjustments are allowed on blocked bins (corrections after blocking). */
  allowBlockedBin?: boolean;
}

export interface ReceiveStockResult {
  balance: StockBalance;
  transaction: InventoryTransactionRecord;
  lot: Lot | null;
  serials: SerialUnit[];
  putawayTask: PutawayTask | null;
}

export interface MovementResult {
  transaction: InventoryTransactionRecord;
}

export interface ItemAvailability {
  sku: string;
  warehouseId: Ulid | null;
  uom: string | null;
  onHand: number;
  reserved: number;
  available: number;
  byBin: {
    binId: Ulid;
    lotId: Ulid | null;
    onHand: number;
    reserved: number;
    available: number;
  }[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StockService {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly bins: BinRepository,
    private readonly lots: LotRepository,
    private readonly serials: SerialRepository,
    private readonly balances: StockBalanceRepository,
    private readonly ledger: InventoryTransactionRepository,
    private readonly putawayTasks: PutawayTaskRepository,
    private readonly outbox: EventOutbox,
  ) {}

  // -- receipts -------------------------------------------------------------

  async receiveStock(ctx: TenantContext, cmd: ReceiveStockCommand): Promise<ReceiveStockResult> {
    const { warehouse, bin } = await this.resolveOperationalBin(ctx, cmd.warehouseId, cmd.binId);
    const uom = normalizeUom(cmd.uom);

    const lot = cmd.lot ? await this.upsertLot(ctx, cmd.sku, cmd.lot) : null;
    const key: StockKey = {
      warehouseId: warehouse.id,
      binId: bin.id,
      sku: cmd.sku.trim(),
      lotId: lot?.id ?? null,
    };
    const balance = await this.getOrOpenBalance(ctx, key, uom);
    balance.assertUomMatches(uom);
    this.assertBinCapacity(bin, balance, cmd.quantity);
    balance.receive(cmd.quantity);

    const serials = await this.registerSerials(ctx, cmd, warehouse, bin, lot);

    const transaction = newTransaction({
      tenantId: ctx.tenantId,
      txnType: "RECEIPT",
      warehouseId: warehouse.id,
      sku: key.sku,
      lotId: key.lotId,
      uom,
      quantity: cmd.quantity,
      toBinId: bin.id,
      ref: cmd.ref ?? null,
      note: cmd.note,
      actorId: ctx.userId,
    });

    let putawayTask: PutawayTask | null = null;
    const events: EventEnvelope[] = [];
    if (cmd.putaway) {
      const target = await this.bins.findById(ctx.tenantId, cmd.putaway.suggestedBinId);
      if (!target || target.warehouseId !== warehouse.id) {
        throw new NotFoundError("Bin", cmd.putaway.suggestedBinId);
      }
      target.assertUsable();
      putawayTask = PutawayTask.create(ctx.tenantId, {
        warehouseId: warehouse.id,
        sku: key.sku,
        lotId: key.lotId,
        uom,
        quantity: cmd.quantity,
        fromBinId: bin.id,
        suggestedBinId: target.id,
        sourceRef: cmd.ref ?? null,
      });
      events.push(...putawayTask.pullEvents());
    }

    await this.balances.save(balance);
    await this.ledger.append(transaction);
    if (lot) await this.lots.save(lot);
    for (const serial of serials) await this.serials.save(serial);
    if (putawayTask) await this.putawayTasks.save(putawayTask);

    events.unshift(this.movementEvent(InventoryEvents.StockReceived, transaction));
    await this.outbox.publish(events);

    return { balance, transaction, lot, serials, putawayTask };
  }

  // -- issues ---------------------------------------------------------------

  async issueStock(ctx: TenantContext, cmd: IssueStockCommand): Promise<MovementResult> {
    const { warehouse, bin } = await this.resolveOperationalBin(ctx, cmd.warehouseId, cmd.binId);
    const balance = await this.requireBalance(ctx, {
      warehouseId: warehouse.id,
      binId: bin.id,
      sku: cmd.sku.trim(),
      lotId: cmd.lotId ?? null,
    });
    balance.issue(cmd.quantity);

    const transaction = newTransaction({
      tenantId: ctx.tenantId,
      txnType: "ISSUE",
      warehouseId: warehouse.id,
      sku: balance.sku,
      lotId: balance.lotId,
      uom: balance.uom,
      quantity: cmd.quantity,
      fromBinId: bin.id,
      ref: cmd.ref ?? null,
      note: cmd.note,
      actorId: ctx.userId,
    });

    await this.balances.save(balance);
    await this.ledger.append(transaction);
    await this.outbox.publish([this.movementEvent(InventoryEvents.StockIssued, transaction)]);
    return { transaction };
  }

  // -- transfers ------------------------------------------------------------

  async transferStock(ctx: TenantContext, cmd: TransferStockCommand): Promise<MovementResult> {
    if (cmd.fromBinId === cmd.toBinId) {
      invalid("fromBinId and toBinId must differ");
    }
    const { warehouse, bin: fromBin } = await this.resolveOperationalBin(
      ctx,
      cmd.warehouseId,
      cmd.fromBinId,
    );
    const toBin = await this.bins.findById(ctx.tenantId, cmd.toBinId);
    if (!toBin || toBin.warehouseId !== warehouse.id) {
      throw new NotFoundError("Bin", cmd.toBinId);
    }
    toBin.assertUsable();

    const sku = cmd.sku.trim();
    const lotId = cmd.lotId ?? null;
    const source = await this.requireBalance(ctx, {
      warehouseId: warehouse.id,
      binId: fromBin.id,
      sku,
      lotId,
    });
    const destination = await this.getOrOpenBalance(
      ctx,
      { warehouseId: warehouse.id, binId: toBin.id, sku, lotId },
      source.uom,
    );
    destination.assertUomMatches(source.uom);
    this.assertBinCapacity(toBin, destination, cmd.quantity);

    source.issue(cmd.quantity);
    destination.receive(cmd.quantity);

    const transaction = newTransaction({
      tenantId: ctx.tenantId,
      txnType: "TRANSFER",
      warehouseId: warehouse.id,
      sku,
      lotId,
      uom: source.uom,
      quantity: cmd.quantity,
      fromBinId: fromBin.id,
      toBinId: toBin.id,
      ref: cmd.ref ?? null,
      note: cmd.note,
      actorId: ctx.userId,
    });

    await this.balances.save(source);
    await this.balances.save(destination);
    await this.ledger.append(transaction);
    await this.outbox.publish([this.movementEvent(InventoryEvents.StockTransferred, transaction)]);
    return { transaction };
  }

  // -- adjustments ----------------------------------------------------------

  async adjustStock(ctx: TenantContext, cmd: AdjustStockCommand): Promise<MovementResult> {
    if ((cmd.newOnHand === undefined) === (cmd.deltaQty === undefined)) {
      invalid("Provide exactly one of newOnHand or deltaQty");
    }
    const warehouse = await this.requireWarehouse(ctx, cmd.warehouseId);
    warehouse.assertOperational();
    const bin = await this.bins.findById(ctx.tenantId, cmd.binId);
    if (!bin || bin.warehouseId !== warehouse.id) {
      throw new NotFoundError("Bin", cmd.binId);
    }
    if (!cmd.allowBlockedBin) {
      bin.assertUsable();
    }

    const key: StockKey = {
      warehouseId: warehouse.id,
      binId: bin.id,
      sku: cmd.sku.trim(),
      lotId: cmd.lotId ?? null,
    };
    // Positive corrections on a previously unknown SKU/bin combination are
    // legitimate ("FOUND" stock); open a zero balance in that case.
    let balance = await this.balances.findByKey(ctx.tenantId, key);
    if (!balance) {
      balance = StockBalance.open(ctx.tenantId, key, normalizeUom(undefined));
    }

    const delta =
      cmd.newOnHand !== undefined ? balance.adjustTo(cmd.newOnHand) : balance.adjustBy(cmd.deltaQty!);
    if (delta === 0) {
      throw new ConflictError(
        `Adjustment for ${key.sku} in bin ${bin.code} is a no-op (on-hand already ${balance.onHand})`,
      );
    }

    const transaction = newTransaction({
      tenantId: ctx.tenantId,
      txnType: cmd.reasonCode === "CYCLE_COUNT" ? "COUNT_ADJUSTMENT" : "ADJUSTMENT",
      warehouseId: warehouse.id,
      sku: key.sku,
      lotId: key.lotId,
      uom: balance.uom,
      quantity: delta,
      toBinId: bin.id,
      reasonCode: cmd.reasonCode,
      ref: cmd.ref ?? null,
      note: cmd.note,
      actorId: ctx.userId,
    });

    await this.balances.save(balance);
    await this.ledger.append(transaction);
    await this.outbox.publish([this.movementEvent(InventoryEvents.StockAdjusted, transaction)]);
    return { transaction };
  }

  // -- queries ----------------------------------------------------------------

  async listBalances(ctx: TenantContext, filter?: StockBalanceFilter): Promise<StockBalance[]> {
    return this.balances.list(ctx.tenantId, filter);
  }

  async getAvailability(
    ctx: TenantContext,
    sku: string,
    warehouseId?: Ulid,
  ): Promise<ItemAvailability> {
    const balances = await this.balances.list(ctx.tenantId, {
      sku: sku.trim(),
      warehouseId,
      nonEmptyOnly: true,
    });
    const result: ItemAvailability = {
      sku: sku.trim(),
      warehouseId: warehouseId ?? null,
      uom: balances[0]?.uom ?? null,
      onHand: 0,
      reserved: 0,
      available: 0,
      byBin: [],
    };
    for (const balance of balances) {
      result.onHand += balance.onHand;
      result.reserved += balance.reserved;
      result.available += balance.available;
      result.byBin.push({
        binId: balance.binId,
        lotId: balance.lotId,
        onHand: balance.onHand,
        reserved: balance.reserved,
        available: balance.available,
      });
    }
    return result;
  }

  async listTransactions(
    ctx: TenantContext,
    filter?: TransactionFilter,
  ): Promise<InventoryTransactionRecord[]> {
    return this.ledger.list(ctx.tenantId, filter);
  }

  async listLots(ctx: TenantContext, sku: string): Promise<Lot[]> {
    return this.lots.listBySku(ctx.tenantId, sku.trim());
  }

  async setLotStatus(
    ctx: TenantContext,
    lotId: Ulid,
    action: "quarantine" | "release" | "expire",
  ): Promise<Lot> {
    const lot = await this.lots.findById(ctx.tenantId, lotId);
    if (!lot) throw new NotFoundError("Lot", lotId);
    if (action === "quarantine") lot.quarantine();
    else if (action === "release") lot.release();
    else lot.markExpired();
    await this.lots.save(lot);
    await this.outbox.publish([
      envelope({
        eventType: InventoryEvents.LotStatusChanged,
        aggregateType: "Lot",
        aggregateId: lot.id,
        tenantId: ctx.tenantId,
        payload: { sku: lot.sku, lotCode: lot.lotCode, status: lot.status },
      }),
    ]);
    return lot;
  }

  async listSerials(ctx: TenantContext, sku: string): Promise<SerialUnit[]> {
    return this.serials.listBySku(ctx.tenantId, sku.trim());
  }

  // -- internals shared with other services ----------------------------------

  async requireWarehouse(ctx: TenantContext, warehouseId: Ulid): Promise<Warehouse> {
    const warehouse = await this.warehouses.findById(ctx.tenantId, warehouseId);
    if (!warehouse) throw new NotFoundError("Warehouse", warehouseId);
    return warehouse;
  }

  async resolveOperationalBin(
    ctx: TenantContext,
    warehouseId: Ulid,
    binId: Ulid,
  ): Promise<{ warehouse: Warehouse; bin: Bin }> {
    const warehouse = await this.requireWarehouse(ctx, warehouseId);
    warehouse.assertOperational();
    const bin = await this.bins.findById(ctx.tenantId, binId);
    if (!bin || bin.warehouseId !== warehouse.id) {
      throw new NotFoundError("Bin", binId);
    }
    bin.assertUsable();
    return { warehouse, bin };
  }

  async requireBalance(ctx: TenantContext, key: StockKey): Promise<StockBalance> {
    const balance = await this.balances.findByKey(ctx.tenantId, key);
    if (!balance) {
      throw new DomainError(
        `No stock balance for ${key.sku} in bin ${key.binId}${key.lotId ? ` (lot ${key.lotId})` : ""}`,
        "NO_BALANCE",
        404,
      );
    }
    return balance;
  }

  private async getOrOpenBalance(
    ctx: TenantContext,
    key: StockKey,
    uom: string,
  ): Promise<StockBalance> {
    const existing = await this.balances.findByKey(ctx.tenantId, key);
    return existing ?? StockBalance.open(ctx.tenantId, key, uom);
  }

  private assertBinCapacity(bin: Bin, balance: StockBalance, incomingQty: number): void {
    const maxUnits = bin.maxUnits;
    if (maxUnits !== undefined && maxUnits > 0 && balance.onHand + incomingQty > maxUnits) {
      throw new ConflictError(
        `Bin ${bin.code} capacity exceeded: max ${maxUnits}, would hold ${balance.onHand + incomingQty}`,
      );
    }
  }

  private async upsertLot(ctx: TenantContext, sku: string, input: LotInput): Promise<Lot> {
    const trimmedSku = sku.trim();
    const existing = await this.lots.findByCode(ctx.tenantId, trimmedSku, input.lotCode.trim());
    if (existing) {
      existing.assertUsable(nowIso());
      return existing;
    }
    const lot = Lot.create(ctx.tenantId, {
      sku: trimmedSku,
      lotCode: input.lotCode,
      manufacturedAt: input.manufacturedAt,
      expiresAt: input.expiresAt,
      supplierRef: input.supplierRef,
    });
    lot.assertUsable(nowIso());
    await this.outbox.publish([
      envelope({
        eventType: InventoryEvents.LotCreated,
        aggregateType: "Lot",
        aggregateId: lot.id,
        tenantId: ctx.tenantId,
        payload: { sku: lot.sku, lotCode: lot.lotCode, expiresAt: lot.expiresAt ?? null },
      }),
    ]);
    return lot;
  }

  private async registerSerials(
    ctx: TenantContext,
    cmd: ReceiveStockCommand,
    warehouse: Warehouse,
    bin: Bin,
    lot: Lot | null,
  ): Promise<SerialUnit[]> {
    if (!cmd.serialNumbers || cmd.serialNumbers.length === 0) return [];
    if (cmd.serialNumbers.length !== cmd.quantity) {
      invalid(
        `serialNumbers length (${cmd.serialNumbers.length}) must equal quantity (${cmd.quantity})`,
      );
    }
    const unique = new Set(cmd.serialNumbers.map((s) => s.trim()));
    if (unique.size !== cmd.serialNumbers.length) {
      invalid("serialNumbers must be unique");
    }
    const sku = cmd.sku.trim();
    const serials: SerialUnit[] = [];
    for (const serialNumber of cmd.serialNumbers) {
      const existing = await this.serials.findBySerialNumber(ctx.tenantId, sku, serialNumber.trim());
      if (existing) {
        throw new ConflictError(`Serial ${serialNumber} already registered for ${sku}`);
      }
      serials.push(
        SerialUnit.register(ctx.tenantId, {
          sku,
          serialNumber,
          warehouseId: warehouse.id,
          binId: bin.id,
          lotId: lot?.id ?? null,
        }),
      );
    }
    return serials;
  }

  private movementEvent(
    eventType: string,
    transaction: InventoryTransactionRecord,
  ): EventEnvelope<StockMovementPayload> {
    return envelope<StockMovementPayload>({
      eventType,
      aggregateType: "InventoryTransaction",
      aggregateId: transaction.id,
      tenantId: transaction.tenantId,
      payload: {
        transactionId: transaction.id,
        warehouseId: transaction.warehouseId,
        sku: transaction.sku,
        lotId: transaction.lotId,
        uom: transaction.uom,
        quantity: transaction.quantity,
        fromBinId: transaction.fromBinId,
        toBinId: transaction.toBinId,
        refType: transaction.ref?.type ?? null,
        refId: transaction.ref?.id ?? null,
        reasonCode: transaction.reasonCode,
      },
    });
  }
}
