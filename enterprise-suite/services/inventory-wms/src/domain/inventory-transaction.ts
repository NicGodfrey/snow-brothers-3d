import {
  DomainError,
  newId,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { assertAdjustmentDelta, assertPositiveQuantity, normalizeUom } from "./quantity.js";

/**
 * The inventory transaction ledger is append-only: every physical stock change
 * writes exactly one record. Balances can always be rebuilt by replaying it.
 */
export const TRANSACTION_TYPES = [
  "RECEIPT",
  "ISSUE",
  "TRANSFER",
  "ADJUSTMENT",
  "COUNT_ADJUSTMENT",
] as const;
export type InventoryTransactionType = (typeof TRANSACTION_TYPES)[number];

export const STOCK_REF_TYPES = [
  "PURCHASE_ORDER",
  "SALES_ORDER",
  "CYCLE_COUNT",
  "PUTAWAY_TASK",
  "PICK_TASK",
  "RETURN",
  "MANUAL",
] as const;
export type StockRefType = (typeof STOCK_REF_TYPES)[number];

export interface StockRef {
  readonly type: StockRefType;
  readonly id: string;
}

export const ADJUSTMENT_REASONS = [
  "DAMAGE",
  "SHRINKAGE",
  "FOUND",
  "CORRECTION",
  "EXPIRY",
  "CYCLE_COUNT",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface InventoryTransactionRecord {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly txnType: InventoryTransactionType;
  readonly warehouseId: Ulid;
  readonly sku: string;
  readonly lotId: Ulid | null;
  readonly uom: string;
  /**
   * RECEIPT/ISSUE/TRANSFER: positive quantity moved.
   * ADJUSTMENT/COUNT_ADJUSTMENT: signed delta applied to on-hand.
   */
  readonly quantity: number;
  readonly fromBinId: Ulid | null;
  readonly toBinId: Ulid | null;
  readonly reasonCode: AdjustmentReason | null;
  readonly ref: StockRef | null;
  readonly note: string | null;
  readonly actorId: UserId;
  readonly occurredAt: IsoDateTime;
}

export interface NewTransactionInput {
  tenantId: TenantId;
  txnType: InventoryTransactionType;
  warehouseId: Ulid;
  sku: string;
  lotId?: Ulid | null;
  uom: string;
  quantity: number;
  fromBinId?: Ulid | null;
  toBinId?: Ulid | null;
  reasonCode?: AdjustmentReason | null;
  ref?: StockRef | null;
  note?: string | null;
  actorId: UserId;
}

/**
 * Factory with per-type shape validation, so a malformed ledger row can never
 * be constructed (e.g. a RECEIPT without a destination bin).
 */
export function newTransaction(input: NewTransactionInput): InventoryTransactionRecord {
  const uom = normalizeUom(input.uom);
  switch (input.txnType) {
    case "RECEIPT":
      assertPositiveQuantity(input.quantity);
      if (!input.toBinId) {
        throw new DomainError("RECEIPT requires toBinId", "INVALID_TRANSACTION", 400);
      }
      if (input.fromBinId) {
        throw new DomainError("RECEIPT must not have fromBinId", "INVALID_TRANSACTION", 400);
      }
      break;
    case "ISSUE":
      assertPositiveQuantity(input.quantity);
      if (!input.fromBinId) {
        throw new DomainError("ISSUE requires fromBinId", "INVALID_TRANSACTION", 400);
      }
      if (input.toBinId) {
        throw new DomainError("ISSUE must not have toBinId", "INVALID_TRANSACTION", 400);
      }
      break;
    case "TRANSFER":
      assertPositiveQuantity(input.quantity);
      if (!input.fromBinId || !input.toBinId) {
        throw new DomainError(
          "TRANSFER requires fromBinId and toBinId",
          "INVALID_TRANSACTION",
          400,
        );
      }
      if (input.fromBinId === input.toBinId) {
        throw new DomainError(
          "TRANSFER source and destination bins must differ",
          "INVALID_TRANSACTION",
          400,
        );
      }
      break;
    case "ADJUSTMENT":
    case "COUNT_ADJUSTMENT":
      assertAdjustmentDelta(input.quantity, "quantity");
      if (!input.toBinId && !input.fromBinId) {
        throw new DomainError(
          "ADJUSTMENT requires the affected bin (toBinId)",
          "INVALID_TRANSACTION",
          400,
        );
      }
      if (!input.reasonCode) {
        throw new DomainError("ADJUSTMENT requires a reasonCode", "INVALID_TRANSACTION", 400);
      }
      break;
  }

  return Object.freeze({
    id: newId("itx"),
    tenantId: input.tenantId,
    txnType: input.txnType,
    warehouseId: input.warehouseId,
    sku: input.sku,
    lotId: input.lotId ?? null,
    uom,
    quantity: input.quantity,
    fromBinId: input.fromBinId ?? null,
    toBinId: input.toBinId ?? null,
    reasonCode: input.reasonCode ?? null,
    ref: input.ref ?? null,
    note: input.note?.trim() || null,
    actorId: input.actorId,
    occurredAt: nowIso(),
  });
}
