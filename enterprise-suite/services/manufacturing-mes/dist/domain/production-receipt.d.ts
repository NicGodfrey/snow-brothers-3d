import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
import { type UnitOfMeasure, type WorkOrderId } from "./ids.js";
/**
 * A posted, immutable document recording finished goods received from a
 * work order into a warehouse. Inventory-wms adds the stock; finance-erp
 * uses it for WIP relief.
 */
export interface ProductionReceiptProps {
    readonly workOrderId: WorkOrderId;
    readonly sku: string;
    readonly qtyGood: number;
    readonly uom: UnitOfMeasure;
    readonly warehouseCode: string;
    readonly lotNumber: string | null;
    readonly postedBy: string;
    readonly note: string | null;
}
export declare class ProductionReceipt extends AggregateRoot<ProductionReceiptProps> {
    private constructor();
    static post(tenantId: TenantId, input: {
        workOrderId: WorkOrderId;
        sku: string;
        qtyGood: number;
        uom: UnitOfMeasure;
        warehouseCode: string;
        lotNumber?: string;
        postedBy: string;
        note?: string;
    }): ProductionReceipt;
    get workOrderRef(): WorkOrderId;
    get qtyGood(): number;
}
//# sourceMappingURL=production-receipt.d.ts.map