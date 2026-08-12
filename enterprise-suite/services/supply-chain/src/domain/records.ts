import {
  DomainError,
  newId,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { isoDate } from "./calendar.js";
import { assertQty, type IsoDate, type LocationCode } from "./types.js";

/**
 * Projection of on-hand stock owned by the Inventory context. The supply
 * chain service keeps a local copy (updated via integration events or the
 * upsert endpoint) so planning never blocks on a remote call.
 */
export interface InventoryRecord {
  readonly tenantId: TenantId;
  readonly sku: string;
  readonly location: LocationCode;
  readonly onHandQty: number;
  readonly asOf: IsoDateTime;
}

export function makeInventoryRecord(
  tenantId: TenantId,
  input: { sku: string; location: LocationCode; onHandQty: number },
): InventoryRecord {
  const sku = input.sku?.trim().toUpperCase();
  if (!sku) throw new DomainError("Inventory SKU is required", "VALIDATION");
  return {
    tenantId,
    sku,
    location: input.location,
    onHandQty: assertQty("onHandQty", input.onHandQty),
    asOf: nowIso(),
  };
}

export type ReceiptSourceType = "PURCHASE_ORDER" | "WORK_ORDER" | "TRANSFER_ORDER";

/**
 * Open inbound supply already committed outside the planning engine: open
 * purchase orders, work orders or inbound transfers. MRP treats these as
 * scheduled receipts; ATP counts them as supply.
 */
export interface ScheduledReceipt {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly sku: string;
  readonly location: LocationCode;
  readonly dueDate: IsoDate;
  readonly qty: number;
  readonly sourceType: ReceiptSourceType;
  readonly sourceRef: string;
  readonly createdAt: IsoDateTime;
}

export function makeScheduledReceipt(
  tenantId: TenantId,
  input: {
    sku: string;
    location: LocationCode;
    dueDate: string;
    qty: number;
    sourceType: ReceiptSourceType;
    sourceRef: string;
  },
): ScheduledReceipt {
  const sku = input.sku?.trim().toUpperCase();
  if (!sku) throw new DomainError("Receipt SKU is required", "VALIDATION");
  const sourceRef = input.sourceRef?.trim();
  if (!sourceRef) throw new DomainError("sourceRef is required", "VALIDATION");
  if (!["PURCHASE_ORDER", "WORK_ORDER", "TRANSFER_ORDER"].includes(input.sourceType)) {
    throw new DomainError(`Invalid receipt sourceType: ${String(input.sourceType)}`, "VALIDATION");
  }
  return {
    id: newId("rcpt"),
    tenantId,
    sku,
    location: input.location,
    dueDate: isoDate(input.dueDate),
    qty: assertQty("qty", input.qty, { allowZero: false }),
    sourceType: input.sourceType,
    sourceRef,
    createdAt: nowIso(),
  };
}
