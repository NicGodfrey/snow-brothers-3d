import { NotFoundError, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { positiveQuantity, quantity, yearOf, type IsoDate, type Quantity } from "../domain/common.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import type { PurchaseOrder } from "../domain/purchase-order.js";
import {
  GoodsReceipt,
  type ReceiptLine,
  type ReceiptLineInput,
  type ReturnToVendorRecord,
} from "../domain/receipt.js";
import type { PurchaseOrderService } from "./purchase-order-service.js";
import {
  commit,
  type Clock,
  type DocumentNumberGenerator,
  type EventOutbox,
  type PurchaseOrderRepository,
  type ReceiptRepository,
} from "./ports.js";

/**
 * What a caller sends: the unit of measure, item code and description are
 * copied off the purchase order line when omitted, so a receiving clerk only
 * has to key a line number and a quantity.
 */
export type ReceiptLineRequest = Omit<ReceiptLineInput, "uom"> & { uom?: string };

export interface DraftReceiptInput {
  purchaseOrderId: Ulid;
  receivedBy: Ulid;
  receiptDate?: IsoDate;
  deliveryNoteReference?: string;
  carrier?: string;
  waybillNumber?: string;
  notes?: string;
  lines?: readonly ReceiptLineRequest[];
}

/**
 * Receiving use cases. A receipt is a draft until it is posted; posting is the
 * single point where quantities reach the purchase order and the inventory
 * context, so tolerance breaches surface there and nowhere else.
 */
export class ReceiptService {
  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly orders: PurchaseOrderRepository,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  draft(tenantId: TenantId, input: DraftReceiptInput): GoodsReceipt {
    const order = this.purchaseOrders.get(tenantId, input.purchaseOrderId);
    this.assertReceivable(order);
    const today = this.clock.today();
    for (const line of input.lines ?? []) order.lineByNumber(line.purchaseOrderLineNumber);
    const receipt = GoodsReceipt.draft(tenantId, {
      receiptNumber: this.numbers.next(tenantId, "GRN", yearOf(today)),
      purchaseOrderId: order.id,
      orderNumber: order.orderNumber,
      supplierId: order.supplierId,
      receivedBy: input.receivedBy,
      receiptDate: input.receiptDate ?? today,
      deliveryNoteReference: input.deliveryNoteReference,
      carrier: input.carrier,
      waybillNumber: input.waybillNumber,
      notes: input.notes,
      lines: (input.lines ?? []).map((line) => this.withOrderLineDetail(order, line)),
    });
    return commit(this.receipts, this.outbox, receipt);
  }

  get(tenantId: TenantId, receiptId: Ulid): GoodsReceipt {
    const receipt = this.receipts.findById(tenantId, receiptId);
    if (!receipt) throw new NotFoundError("GoodsReceipt", receiptId);
    return receipt;
  }

  list(
    tenantId: TenantId,
    filters: { purchaseOrderId?: Ulid; supplierId?: Ulid; postedOnly?: boolean } = {},
  ): GoodsReceipt[] {
    let results = filters.purchaseOrderId
      ? this.receipts.listByPurchaseOrder(tenantId, filters.purchaseOrderId)
      : filters.supplierId
        ? this.receipts.listBySupplier(tenantId, filters.supplierId)
        : this.receipts.listByTenant(tenantId);
    if (filters.postedOnly) results = results.filter((receipt) => receipt.status === "posted");
    return results.sort((a, b) => a.receiptNumber.localeCompare(b.receiptNumber));
  }

  addLine(tenantId: TenantId, receiptId: Ulid, input: ReceiptLineRequest): ReceiptLine {
    const receipt = this.get(tenantId, receiptId);
    const order = this.purchaseOrders.get(tenantId, receipt.purchaseOrderId);
    order.lineByNumber(input.purchaseOrderLineNumber);
    const line = receipt.addLine(this.withOrderLineDetail(order, input));
    commit(this.receipts, this.outbox, receipt);
    return line;
  }

  removeLine(tenantId: TenantId, receiptId: Ulid, lineId: Ulid): GoodsReceipt {
    const receipt = this.get(tenantId, receiptId);
    receipt.removeLine(lineId);
    return commit(this.receipts, this.outbox, receipt);
  }

  recordInspection(
    tenantId: TenantId,
    receiptId: Ulid,
    input: {
      lineId: Ulid;
      outcome: "passed" | "failed" | "partial";
      rejectedQuantity?: number;
      reason?: string;
      inspectorId?: Ulid;
    },
  ): ReceiptLine {
    const receipt = this.get(tenantId, receiptId);
    const line = receipt.recordInspection(input);
    commit(this.receipts, this.outbox, receipt);
    return line;
  }

  /**
   * Posts the receipt: applies every line to the purchase order (which
   * enforces the over-receipt tolerance) and only then marks the receipt
   * posted, so a rejected line leaves nothing half-applied.
   */
  post(tenantId: TenantId, receiptId: Ulid): { receipt: GoodsReceipt; order: PurchaseOrder } {
    const receipt = this.get(tenantId, receiptId);
    if (receipt.status !== "draft") {
      throw InvalidStateError.transition("goods receipt", "post", receipt.status, ["draft"]);
    }
    const order = this.purchaseOrders.get(tenantId, receipt.purchaseOrderId);
    this.assertReceivable(order);

    for (const line of receipt.lines) {
      order.applyReceipt({
        lineNumber: line.purchaseOrderLineNumber,
        receivedQuantity: line.receivedQuantity,
        acceptedQuantity: line.acceptedQuantity,
        rejectedQuantity: line.rejectedQuantity,
      });
    }
    receipt.post();
    commit(this.orders, this.outbox, order);
    commit(this.receipts, this.outbox, receipt);
    return { receipt, order };
  }

  /** Backs a posted receipt out of the purchase order (keying error, mis-delivery). */
  reverse(
    tenantId: TenantId,
    receiptId: Ulid,
    reason: string,
  ): { receipt: GoodsReceipt; order: PurchaseOrder } {
    const receipt = this.get(tenantId, receiptId);
    if (receipt.status !== "posted") {
      throw InvalidStateError.transition("goods receipt", "reverse", receipt.status, ["posted"]);
    }
    const order = this.purchaseOrders.get(tenantId, receipt.purchaseOrderId);
    for (const line of receipt.lines) {
      order.reverseReceipt({
        lineNumber: line.purchaseOrderLineNumber,
        receivedQuantity: line.receivedQuantity,
        acceptedQuantity: line.acceptedQuantity,
        rejectedQuantity: line.rejectedQuantity,
      });
    }
    receipt.reverse(reason);
    commit(this.orders, this.outbox, order);
    commit(this.receipts, this.outbox, receipt);
    return { receipt, order };
  }

  /**
   * Returns accepted stock to the supplier after posting. The purchase order
   * line is credited back so the outstanding quantity reflects reality.
   */
  returnToVendor(
    tenantId: TenantId,
    receiptId: Ulid,
    input: { lineId: Ulid; quantity: number; reason: string; rmaReference?: string },
  ): { record: ReturnToVendorRecord; order: PurchaseOrder } {
    const receipt = this.get(tenantId, receiptId);
    const order = this.purchaseOrders.get(tenantId, receipt.purchaseOrderId);
    const line = receipt.line(input.lineId);
    const qty = positiveQuantity(input.quantity, "quantity");
    const record = receipt.returnToVendor({ ...input, quantity: qty });
    order.reverseReceipt({
      lineNumber: line.purchaseOrderLineNumber,
      receivedQuantity: qty,
      acceptedQuantity: qty,
      rejectedQuantity: quantity(0),
    });
    commit(this.orders, this.outbox, order);
    commit(this.receipts, this.outbox, receipt);
    return { record, order };
  }

  /** Accepted quantity per order line across all posted receipts. */
  receivedByOrderLine(tenantId: TenantId, purchaseOrderId: Ulid): Map<number, Quantity> {
    const totals = new Map<number, Quantity>();
    for (const receipt of this.receipts.listByPurchaseOrder(tenantId, purchaseOrderId)) {
      if (receipt.status !== "posted") continue;
      for (const line of receipt.lines) {
        const current = totals.get(line.purchaseOrderLineNumber) ?? quantity(0);
        totals.set(line.purchaseOrderLineNumber, quantity(current + line.netAcceptedQuantity));
      }
    }
    return totals;
  }

  /**
   * Supplier delivery performance: share of posted receipts that arrived on or
   * before the line's promised (or need-by) date.
   */
  onTimeDeliveryBps(tenantId: TenantId, supplierId: Ulid): { onTime: number; total: number; bps: number } {
    let onTime = 0;
    let total = 0;
    for (const receipt of this.receipts.listBySupplier(tenantId, supplierId)) {
      if (receipt.status !== "posted") continue;
      const order = this.orders.findById(tenantId, receipt.purchaseOrderId);
      if (!order) continue;
      for (const line of receipt.lines) {
        const orderLine = order.lines.find(
          (candidate) => candidate.lineNumber === line.purchaseOrderLineNumber,
        );
        if (!orderLine) continue;
        total += 1;
        const due = orderLine.promisedDate ?? orderLine.needBy;
        if (receipt.receiptDate <= due) onTime += 1;
      }
    }
    return { onTime, total, bps: total === 0 ? 0 : Math.round((onTime / total) * 10_000) };
  }

  private assertReceivable(order: PurchaseOrder): void {
    if (!["issued", "acknowledged", "partially_received"].includes(order.status)) {
      throw InvalidStateError.transition("purchase order", "receive against", order.status, [
        "issued",
        "acknowledged",
        "partially_received",
      ]);
    }
  }

  /** Copies item code and description off the order line when omitted. */
  private withOrderLineDetail(order: PurchaseOrder, input: ReceiptLineRequest): ReceiptLineInput {
    const orderLine = order.lineByNumber(input.purchaseOrderLineNumber);
    if (orderLine.status === "cancelled") {
      throw ValidationError.single(
        "purchaseOrderLineNumber",
        `line ${orderLine.lineNumber} of ${order.orderNumber} is cancelled`,
      );
    }
    return {
      ...input,
      uom: input.uom ?? orderLine.uom,
      itemCode: input.itemCode ?? orderLine.itemCode,
      description: input.description ?? orderLine.description,
      purchaseOrderLineId: input.purchaseOrderLineId ?? orderLine.id,
    };
  }
}
