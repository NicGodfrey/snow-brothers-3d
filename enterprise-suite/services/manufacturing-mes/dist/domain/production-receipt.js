import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid } from "./ids.js";
export class ProductionReceipt extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static post(tenantId, input) {
        if (!(input.qtyGood > 0)) {
            throw new DomainError("Receipt quantity must be positive", "RECEIPT_INVALID_QTY");
        }
        if (!input.warehouseCode.trim()) {
            throw new DomainError("warehouseCode is required", "RECEIPT_INVALID_WAREHOUSE");
        }
        const receipt = new ProductionReceipt(tenantId, {
            workOrderId: input.workOrderId,
            sku: input.sku.trim().toUpperCase(),
            qtyGood: input.qtyGood,
            uom: input.uom,
            warehouseCode: input.warehouseCode.trim().toUpperCase(),
            lotNumber: input.lotNumber?.trim() || null,
            postedBy: input.postedBy,
            note: input.note?.trim() || null,
        });
        const payload = {
            productionReceiptId: receipt.id,
            workOrderId: input.workOrderId,
            sku: receipt.props.sku,
            qtyGood: input.qtyGood,
            uom: input.uom,
            warehouseCode: receipt.props.warehouseCode,
            lotNumber: receipt.props.lotNumber,
        };
        receipt.raise(envelope({
            eventType: MesEvents.ProductionReceiptPosted,
            aggregateType: "ProductionReceipt",
            aggregateId: asUlid(receipt.id),
            tenantId,
            payload,
        }));
        return receipt;
    }
    get workOrderRef() {
        return this.props.workOrderId;
    }
    get qtyGood() {
        return this.props.qtyGood;
    }
}
//# sourceMappingURL=production-receipt.js.map