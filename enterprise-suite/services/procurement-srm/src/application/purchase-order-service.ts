import {
  NotFoundError,
  money,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  compareDates,
  currencyCode,
  positiveQuantity,
  quantity,
  yearOf,
  type IsoDate,
  type Quantity,
} from "../domain/common.js";
import { ValidationError } from "../domain/errors.js";
import {
  PurchaseOrder,
  type OrderRevision,
  type OrderTolerances,
  type PurchaseOrderLine,
  type PurchaseOrderLineInput,
  type PurchaseOrderSource,
  type PurchaseOrderStatus,
} from "../domain/purchase-order.js";
import type { ApprovalService } from "./approval-service.js";
import type { RequisitionService } from "./requisition-service.js";
import type { SupplierDirectoryService } from "./supplier-directory-service.js";
import {
  commit,
  type Clock,
  type DocumentNumberGenerator,
  type EventOutbox,
  type PurchaseOrderRepository,
} from "./ports.js";

export interface CreatePurchaseOrderInput {
  supplierId: Ulid;
  buyerId: Ulid;
  currency?: string;
  shipTo: string;
  billTo?: string;
  orderDate?: IsoDate;
  incoterm?: string;
  paymentTermsDays?: number;
  tolerances?: Partial<OrderTolerances>;
  sourceType?: PurchaseOrderSource;
  requisitionIds?: readonly Ulid[];
  rfqId?: Ulid;
  quoteId?: Ulid;
  agreementId?: Ulid;
  supplierReference?: string;
  notes?: string;
  lines?: readonly PurchaseOrderLineInput[];
}

/** Requisition line to convert, optionally splitting the quantity. */
export interface RequisitionLineSelection {
  lineId: Ulid;
  quantity?: number;
  unitPrice?: Money;
  taxBps?: number;
  needBy?: IsoDate;
}

export type PurchaseOrderCancellationHandler = (input: {
  tenantId: TenantId;
  order: PurchaseOrder;
  reason: string;
}) => void;

export interface PurchaseOrderFilters {
  status?: PurchaseOrderStatus;
  supplierId?: Ulid;
  requisitionId?: Ulid;
  agreementId?: Ulid;
}

/**
 * Buying side use cases: create orders (manually, from a requisition, from a
 * won quote or as an agreement release), run them through approval, issue them
 * to suppliers and manage change orders and closure.
 */
export class PurchaseOrderService {
  private readonly cancellationHandlers: PurchaseOrderCancellationHandler[] = [];

  constructor(
    private readonly orders: PurchaseOrderRepository,
    private readonly suppliers: SupplierDirectoryService,
    private readonly requisitions: RequisitionService,
    private readonly approvals: ApprovalService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  registerApprovalHandler(): () => void {
    return this.approvals.onOutcome("purchase_order", ({ tenantId, request, outcome, reason }) => {
      const order = this.orders.findById(tenantId, request.documentId);
      if (!order || order.status !== "pending_approval") return;
      if (outcome === "approved") order.approve(request.approvers);
      else order.reject(reason ?? "Rejected during approval");
      commit(this.orders, this.outbox, order);
    });
  }

  /** Lets other contexts (agreements) react to a cancelled order. */
  onCancelled(handler: PurchaseOrderCancellationHandler): () => void {
    this.cancellationHandlers.push(handler);
    return () => {
      const index = this.cancellationHandlers.indexOf(handler);
      if (index >= 0) this.cancellationHandlers.splice(index, 1);
    };
  }

  create(tenantId: TenantId, input: CreatePurchaseOrderInput): PurchaseOrder {
    const supplier = this.suppliers.get(tenantId, input.supplierId);
    supplier.assertSourceable();
    const today = this.clock.today();
    const order = PurchaseOrder.create(tenantId, {
      orderNumber: this.numbers.next(tenantId, "PO", yearOf(today)),
      supplierId: supplier.id,
      buyerId: input.buyerId,
      currency: currencyCode(input.currency ?? supplier.currency),
      orderDate: input.orderDate ?? today,
      shipTo: input.shipTo,
      billTo: input.billTo,
      incoterm: input.incoterm ?? supplier.defaultIncoterm,
      paymentTermsDays: input.paymentTermsDays ?? supplier.paymentTermsDays,
      tolerances: input.tolerances,
      sourceType: input.sourceType,
      requisitionIds: input.requisitionIds,
      rfqId: input.rfqId,
      quoteId: input.quoteId,
      agreementId: input.agreementId,
      supplierReference: input.supplierReference,
      notes: input.notes,
      lines: input.lines,
    });
    return commit(this.orders, this.outbox, order);
  }

  /**
   * Converts approved requisition lines into a draft order and reserves the
   * quantity on the requisition, so the same demand cannot be ordered twice.
   */
  createFromRequisition(
    tenantId: TenantId,
    input: {
      requisitionId: Ulid;
      supplierId: Ulid;
      buyerId: Ulid;
      lineSelections: readonly RequisitionLineSelection[];
      shipTo?: string;
      incoterm?: string;
      paymentTermsDays?: number;
      tolerances?: Partial<OrderTolerances>;
      notes?: string;
    },
  ): PurchaseOrder {
    const requisition = this.requisitions.get(tenantId, input.requisitionId);
    if (input.lineSelections.length === 0) {
      throw ValidationError.single("lineSelections", "select at least one requisition line");
    }
    const supplier = this.suppliers.get(tenantId, input.supplierId);
    supplier.assertSourceable();

    const lines: PurchaseOrderLineInput[] = input.lineSelections.map((selection) => {
      const requisitionLine = requisition.line(selection.lineId);
      const qty =
        selection.quantity === undefined
          ? requisitionLine.remainingQuantity
          : positiveQuantity(selection.quantity, "quantity");
      if (qty > requisitionLine.remainingQuantity) {
        throw ValidationError.single(
          "quantity",
          `line ${requisitionLine.lineNumber} has only ${requisitionLine.remainingQuantity} ${requisitionLine.uom} left to order`,
        );
      }
      const unitPrice = selection.unitPrice ?? requisitionLine.estimatedUnitPrice;
      if (unitPrice.currency !== requisition.currency) {
        throw ValidationError.single("unitPrice", `must be in ${requisition.currency}`);
      }
      return {
        description: requisitionLine.description,
        categoryCode: requisitionLine.categoryCode,
        quantity: qty,
        uom: requisitionLine.uom,
        unitPrice,
        taxBps: selection.taxBps,
        needBy: selection.needBy ?? requisitionLine.neededBy ?? requisition.neededBy,
        itemCode: requisitionLine.itemCode,
        requisitionId: requisition.id,
        requisitionLineId: requisitionLine.id,
        chargeAccount: requisitionLine.glAccount,
      };
    });

    const order = this.create(tenantId, {
      supplierId: supplier.id,
      buyerId: input.buyerId,
      currency: requisition.currency,
      shipTo: input.shipTo ?? requisition.deliverTo,
      incoterm: input.incoterm,
      paymentTermsDays: input.paymentTermsDays,
      tolerances: input.tolerances,
      sourceType: "requisition",
      requisitionIds: [requisition.id],
      notes: input.notes,
      lines,
    });

    for (const line of order.lines) {
      if (!line.requisitionLineId) continue;
      this.requisitions.recordOrdered(tenantId, requisition.id, line.requisitionLineId, line.quantity, order.id);
    }
    return order;
  }

  get(tenantId: TenantId, purchaseOrderId: Ulid): PurchaseOrder {
    const order = this.orders.findById(tenantId, purchaseOrderId);
    if (!order) throw new NotFoundError("PurchaseOrder", purchaseOrderId);
    return order;
  }

  getByNumber(tenantId: TenantId, orderNumber: string): PurchaseOrder {
    const order = this.orders.findByNumber(tenantId, orderNumber);
    if (!order) throw new NotFoundError("PurchaseOrder", orderNumber);
    return order;
  }

  list(tenantId: TenantId, filters: PurchaseOrderFilters = {}): PurchaseOrder[] {
    let results = filters.status
      ? this.orders.listByStatus(tenantId, filters.status)
      : this.orders.listByTenant(tenantId);
    if (filters.supplierId) results = results.filter((order) => order.supplierId === filters.supplierId);
    if (filters.requisitionId) {
      results = results.filter((order) => order.requisitionIds.includes(filters.requisitionId as Ulid));
    }
    if (filters.agreementId) {
      results = results.filter((order) => order.agreementId === filters.agreementId);
    }
    return results.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
  }

  addLine(tenantId: TenantId, purchaseOrderId: Ulid, input: PurchaseOrderLineInput): PurchaseOrderLine {
    const order = this.get(tenantId, purchaseOrderId);
    const line = order.addLine(input);
    commit(this.orders, this.outbox, order);
    return line;
  }

  updateLine(
    tenantId: TenantId,
    purchaseOrderId: Ulid,
    lineId: Ulid,
    patch: {
      quantity?: number;
      unitPrice?: Money;
      needBy?: IsoDate;
      description?: string;
      discountBps?: number;
      taxBps?: number;
      notes?: string;
    },
  ): PurchaseOrderLine {
    const order = this.get(tenantId, purchaseOrderId);
    const line = order.updateLine(lineId, patch);
    commit(this.orders, this.outbox, order);
    return line;
  }

  removeLine(tenantId: TenantId, purchaseOrderId: Ulid, lineId: Ulid): PurchaseOrder {
    const order = this.get(tenantId, purchaseOrderId);
    const line = order.line(lineId);
    order.removeLine(lineId);
    commit(this.orders, this.outbox, order);
    this.releaseRequisitionCoverage(tenantId, order, line);
    return order;
  }

  submitForApproval(tenantId: TenantId, purchaseOrderId: Ulid, policyCode?: string): PurchaseOrder {
    const order = this.get(tenantId, purchaseOrderId);
    order.submitForApproval();
    commit(this.orders, this.outbox, order);
    const request = this.approvals.requestApproval(tenantId, {
      documentType: "purchase_order",
      documentId: order.id,
      documentNumber: order.orderNumber,
      amount: order.grandTotal,
      requestedBy: order.buyerId,
      categoryCodes: order.categoryCodes,
      policyCode,
      context: { supplierId: order.supplierId, revision: order.revision },
    });
    order.attachApprovalRequest(request.id);
    return commit(this.orders, this.outbox, order);
  }

  /** Marks an order approved without a chain (agreement auto-release path). */
  approveWithoutChain(tenantId: TenantId, purchaseOrderId: Ulid, approvedBy: Ulid): PurchaseOrder {
    const order = this.get(tenantId, purchaseOrderId);
    if (order.status === "draft") order.submitForApproval();
    order.approve([approvedBy]);
    return commit(this.orders, this.outbox, order);
  }

  issue(tenantId: TenantId, purchaseOrderId: Ulid): PurchaseOrder {
    const order = this.get(tenantId, purchaseOrderId);
    const supplier = this.suppliers.get(tenantId, order.supplierId);
    supplier.assertOrderable();
    supplier.assertMeetsMinimumOrderValue(order.netTotal);
    const wasRevised = order.revisions.length > 0;
    if (wasRevised) order.reissue(this.clock.today());
    else order.issue(this.clock.today());
    return commit(this.orders, this.outbox, order);
  }

  acknowledge(
    tenantId: TenantId,
    purchaseOrderId: Ulid,
    input: {
      supplierReference?: string;
      promisedDates?: ReadonlyArray<{ lineNumber: number; promisedDate: IsoDate }>;
    },
  ): PurchaseOrder {
    const order = this.get(tenantId, purchaseOrderId);
    order.acknowledge(input);
    return commit(this.orders, this.outbox, order);
  }

  /**
   * Raises a change order. A material value increase pushes the order back to
   * `pending_approval` and opens a fresh approval chain automatically.
   */
  revise(
    tenantId: TenantId,
    purchaseOrderId: Ulid,
    input: {
      changedBy: Ulid;
      reason: string;
      lineChanges?: ReadonlyArray<{
        lineId: Ulid;
        quantity?: number;
        unitPrice?: Money;
        needBy?: IsoDate;
        description?: string;
        discountBps?: number;
        taxBps?: number;
      }>;
      newLines?: readonly PurchaseOrderLineInput[];
      paymentTermsDays?: number;
      incoterm?: string;
      shipTo?: string;
      policyCode?: string;
    },
  ): { order: PurchaseOrder; revision: OrderRevision } {
    const order = this.get(tenantId, purchaseOrderId);
    const revision = order.revise(input);
    commit(this.orders, this.outbox, order);
    if (revision.requiredReapproval) {
      const request = this.approvals.requestApproval(tenantId, {
        documentType: "purchase_order",
        documentId: order.id,
        documentNumber: order.orderNumber,
        amount: order.grandTotal,
        requestedBy: input.changedBy,
        categoryCodes: order.categoryCodes,
        policyCode: input.policyCode,
        context: { revision: revision.revision, reason: revision.reason },
      });
      order.attachApprovalRequest(request.id);
      commit(this.orders, this.outbox, order);
    }
    return { order, revision };
  }

  closeLine(tenantId: TenantId, purchaseOrderId: Ulid, lineNumber: number, reason: string): PurchaseOrderLine {
    const order = this.get(tenantId, purchaseOrderId);
    const line = order.closeLine(lineNumber, reason);
    commit(this.orders, this.outbox, order);
    this.releaseRequisitionCoverage(tenantId, order, line, line.outstandingQuantity);
    return line;
  }

  cancelLine(tenantId: TenantId, purchaseOrderId: Ulid, lineNumber: number, reason: string): PurchaseOrderLine {
    const order = this.get(tenantId, purchaseOrderId);
    const line = order.cancelLine(lineNumber, reason);
    commit(this.orders, this.outbox, order);
    this.releaseRequisitionCoverage(tenantId, order, line);
    return line;
  }

  close(tenantId: TenantId, purchaseOrderId: Ulid, reason: string): PurchaseOrder {
    const order = this.get(tenantId, purchaseOrderId);
    order.close(reason);
    return commit(this.orders, this.outbox, order);
  }

  cancel(tenantId: TenantId, purchaseOrderId: Ulid, reason: string): PurchaseOrder {
    const order = this.get(tenantId, purchaseOrderId);
    const linesBefore = order.lines.map((line) => ({
      line,
      quantity: line.quantity,
    }));
    order.cancel(reason);
    commit(this.orders, this.outbox, order);
    this.approvals.cancelForDocument(tenantId, order.id, `Purchase order cancelled: ${reason}`);
    for (const entry of linesBefore) {
      this.releaseRequisitionCoverage(tenantId, order, entry.line, entry.quantity);
    }
    for (const handler of this.cancellationHandlers) handler({ tenantId, order, reason });
    return order;
  }

  /** Orders the supplier has, still awaiting goods. */
  listReceivable(tenantId: TenantId): PurchaseOrder[] {
    return this.orders.listOpen(tenantId);
  }

  /**
   * Orders running late: the promised date (or need-by when the supplier never
   * acknowledged) has passed with quantity still outstanding.
   */
  expediteList(
    tenantId: TenantId,
  ): Array<{ order: PurchaseOrder; lineNumber: number; dueDate: IsoDate; daysLate: number }> {
    const today = this.clock.today();
    const results: Array<{ order: PurchaseOrder; lineNumber: number; dueDate: IsoDate; daysLate: number }> = [];
    for (const order of this.orders.listOpen(tenantId)) {
      for (const line of order.lines) {
        if (line.status !== "open" && line.status !== "partially_received") continue;
        const dueDate = line.promisedDate ?? line.needBy;
        if (compareDates(dueDate, today) >= 0) continue;
        results.push({
          order,
          lineNumber: line.lineNumber,
          dueDate,
          daysLate: Math.round(
            (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000,
          ),
        });
      }
    }
    return results.sort((a, b) => b.daysLate - a.daysLate);
  }

  /** Value committed to suppliers but not yet received. */
  openCommitment(tenantId: TenantId, currency: string): Money {
    const target = currencyCode(currency);
    return money(
      this.orders
        .listOpen(tenantId)
        .filter((order) => order.currency === target)
        .reduce((total, order) => total + order.outstandingValue.amountMinor, 0),
      target,
    );
  }

  /** Returns unfulfilled quantity to the originating requisition line. */
  private releaseRequisitionCoverage(
    tenantId: TenantId,
    order: PurchaseOrder,
    line: PurchaseOrderLine,
    releaseQuantity?: Quantity,
  ): void {
    if (!line.requisitionId || !line.requisitionLineId) return;
    const qty = releaseQuantity ?? line.quantity;
    if (qty <= 0) return;
    this.requisitions.releaseOrdered(tenantId, line.requisitionId, line.requisitionLineId, qty, order.id);
  }
}

/** Line input helper for HTTP payloads and fixtures. */
export function orderLineInput(input: {
  description: string;
  categoryCode: string;
  quantity: number;
  uom: string;
  unitPriceMinor: number;
  currency: string;
  needBy: IsoDate;
  taxBps?: number;
  discountBps?: number;
  itemCode?: string;
}): PurchaseOrderLineInput {
  return {
    description: input.description,
    categoryCode: input.categoryCode,
    quantity: quantity(input.quantity),
    uom: input.uom,
    unitPrice: money(input.unitPriceMinor, input.currency),
    needBy: input.needBy,
    taxBps: input.taxBps,
    discountBps: input.discountBps,
    itemCode: input.itemCode,
  };
}
