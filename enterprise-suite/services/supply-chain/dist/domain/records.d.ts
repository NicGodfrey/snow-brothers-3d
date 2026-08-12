import { type IsoDateTime, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate, type LocationCode } from "./types.js";
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
export declare function makeInventoryRecord(tenantId: TenantId, input: {
    sku: string;
    location: LocationCode;
    onHandQty: number;
}): InventoryRecord;
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
export declare function makeScheduledReceipt(tenantId: TenantId, input: {
    sku: string;
    location: LocationCode;
    dueDate: string;
    qty: number;
    sourceType: ReceiptSourceType;
    sourceRef: string;
}): ScheduledReceipt;
//# sourceMappingURL=records.d.ts.map