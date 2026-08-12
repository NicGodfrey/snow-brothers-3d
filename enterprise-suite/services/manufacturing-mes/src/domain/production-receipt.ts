import {
  AggregateRoot,
  DomainError,
  envelope,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MesEvents, type ProductionReceiptPostedPayload } from "./events.js";
import { asUlid, type UnitOfMeasure, type WorkOrderId } from "./ids.js";

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

export class ProductionReceipt extends AggregateRoot<ProductionReceiptProps> {
  private constructor(tenantId: TenantId, props: ProductionReceiptProps) {
    super(tenantId, props);
  }

  static post(
    tenantId: TenantId,
    input: {
      workOrderId: WorkOrderId;
      sku: string;
      qtyGood: number;
      uom: UnitOfMeasure;
      warehouseCode: string;
      lotNumber?: string;
      postedBy: string;
      note?: string;
    },
  ): ProductionReceipt {
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
    const payload: ProductionReceiptPostedPayload = {
      productionReceiptId: receipt.id,
      workOrderId: input.workOrderId,
      sku: receipt.props.sku,
      qtyGood: input.qtyGood,
      uom: input.uom,
      warehouseCode: receipt.props.warehouseCode,
      lotNumber: receipt.props.lotNumber,
    };
    receipt.raise(
      envelope({
        eventType: MesEvents.ProductionReceiptPosted,
        aggregateType: "ProductionReceipt",
        aggregateId: asUlid(receipt.id),
        tenantId,
        payload,
      }),
    );
    return receipt;
  }

  get workOrderRef(): WorkOrderId {
    return this.props.workOrderId;
  }

  get qtyGood(): number {
    return this.props.qtyGood;
  }
}
