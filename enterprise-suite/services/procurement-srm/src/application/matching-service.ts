import {
  NotFoundError,
  money,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { currencyCode, quantity, yearOf, type IsoDate } from "../domain/common.js";
import { ValidationError } from "../domain/errors.js";
import {
  SupplierInvoice,
  type ExceptionResolution,
  type InvoiceLine,
  type InvoiceLineInput,
  type InvoiceStatus,
} from "../domain/invoice.js";
import type { PurchaseOrder } from "../domain/purchase-order.js";
import {
  runThreeWayMatch,
  type MatchException,
  type MatchResult,
  type MatchTolerances,
} from "../domain/three-way-match.js";
import type { PurchaseOrderService } from "./purchase-order-service.js";
import {
  commit,
  type Clock,
  type DocumentNumberGenerator,
  type EventOutbox,
  type InvoiceRepository,
  type PurchaseOrderRepository,
  type ReceiptRepository,
} from "./ports.js";

export interface RegisterInvoiceInput {
  supplierInvoiceNumber: string;
  supplierId: Ulid;
  invoiceDate: IsoDate;
  declaredTotal: Money;
  purchaseOrderId?: Ulid;
  currency?: string;
  receivedDate?: IsoDate;
  paymentTermsDays?: number;
  dueDate?: IsoDate;
  declaredTaxTotal?: Money;
  notes?: string;
  lines?: readonly InvoiceLineInput[];
}

export interface MatchOutcome {
  invoice: SupplierInvoice;
  result: MatchResult;
}

/**
 * Invoice registration and three-way matching.
 *
 * Everything after "approved for payment" — AP posting, payment runs,
 * remittance — belongs to finance-erp, which consumes
 * `procurement.invoice.approved_for_payment`.
 */
export class MatchingService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly orders: PurchaseOrderRepository,
    private readonly receipts: ReceiptRepository,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
    private readonly defaultTolerances?: Partial<MatchTolerances>,
  ) {}

  register(tenantId: TenantId, input: RegisterInvoiceInput): SupplierInvoice {
    const today = this.clock.today();
    const order = input.purchaseOrderId
      ? this.purchaseOrders.get(tenantId, input.purchaseOrderId)
      : undefined;
    const currency = currencyCode(input.currency ?? order?.currency ?? input.declaredTotal.currency);
    const invoice = SupplierInvoice.register(tenantId, {
      invoiceNumber: this.numbers.next(tenantId, "INV", yearOf(today)),
      supplierInvoiceNumber: input.supplierInvoiceNumber,
      supplierId: input.supplierId,
      purchaseOrderId: order?.id,
      currency,
      invoiceDate: input.invoiceDate,
      receivedDate: input.receivedDate ?? today,
      declaredTotal: input.declaredTotal,
      paymentTermsDays: input.paymentTermsDays ?? order?.paymentTermsDays,
      dueDate: input.dueDate,
      declaredTaxTotal: input.declaredTaxTotal,
      notes: input.notes,
      lines: input.lines,
    });
    return commit(this.invoices, this.outbox, invoice);
  }

  get(tenantId: TenantId, invoiceId: Ulid): SupplierInvoice {
    const invoice = this.invoices.findById(tenantId, invoiceId);
    if (!invoice) throw new NotFoundError("SupplierInvoice", invoiceId);
    return invoice;
  }

  list(
    tenantId: TenantId,
    filters: { status?: InvoiceStatus; supplierId?: Ulid; purchaseOrderId?: Ulid } = {},
  ): SupplierInvoice[] {
    let results = filters.status
      ? this.invoices.listByStatus(tenantId, filters.status)
      : this.invoices.listByTenant(tenantId);
    if (filters.supplierId) results = results.filter((invoice) => invoice.supplierId === filters.supplierId);
    if (filters.purchaseOrderId) {
      results = results.filter((invoice) => invoice.purchaseOrderId === filters.purchaseOrderId);
    }
    return results.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
  }

  addLine(tenantId: TenantId, invoiceId: Ulid, input: InvoiceLineInput): InvoiceLine {
    const invoice = this.get(tenantId, invoiceId);
    const line = invoice.addLine(input);
    commit(this.invoices, this.outbox, invoice);
    return line;
  }

  linkPurchaseOrder(tenantId: TenantId, invoiceId: Ulid, purchaseOrderId: Ulid): SupplierInvoice {
    const invoice = this.get(tenantId, invoiceId);
    const order = this.purchaseOrders.get(tenantId, purchaseOrderId);
    if (order.supplierId !== invoice.supplierId) {
      throw ValidationError.single(
        "purchaseOrderId",
        `${order.orderNumber} belongs to a different supplier`,
      );
    }
    invoice.linkPurchaseOrder(order.id);
    return commit(this.invoices, this.outbox, invoice);
  }

  /**
   * Runs the match and records the verdict on the invoice. Re-runnable: a
   * buyer can fix the order or post the missing receipt and match again.
   */
  match(
    tenantId: TenantId,
    invoiceId: Ulid,
    tolerances?: Partial<MatchTolerances>,
  ): MatchOutcome {
    const invoice = this.get(tenantId, invoiceId);
    const order = invoice.purchaseOrderId
      ? this.orders.findById(tenantId, invoice.purchaseOrderId)
      : undefined;
    const receipts = order ? this.receipts.listByPurchaseOrder(tenantId, order.id) : [];
    const duplicates = this.invoices
      .findDuplicates(tenantId, invoice.supplierId, invoice.normalizedReference, invoice.id)
      .filter((candidate) => candidate.status !== "cancelled" && candidate.status !== "rejected")
      .map((candidate) => candidate.id);

    const result = runThreeWayMatch({
      invoice,
      order,
      receipts,
      duplicateInvoiceIds: duplicates,
      tolerances: {
        ...this.defaultTolerances,
        ...(order ? { priceVarianceBps: order.tolerances.priceVarianceBps } : {}),
        ...tolerances,
      },
    });
    invoice.applyMatchResult(result);
    commit(this.invoices, this.outbox, invoice);
    return { invoice, result };
  }

  /** Registers and immediately matches — the common AP-inbox path. */
  registerAndMatch(tenantId: TenantId, input: RegisterInvoiceInput): MatchOutcome {
    const invoice = this.register(tenantId, input);
    return this.match(tenantId, invoice.id);
  }

  resolveException(
    tenantId: TenantId,
    invoiceId: Ulid,
    input: {
      code: string;
      lineNumber?: number;
      action: "resolved" | "waived";
      note: string;
      resolvedBy: Ulid;
    },
  ): ExceptionResolution {
    const invoice = this.get(tenantId, invoiceId);
    const resolution = invoice.resolveException(input);
    commit(this.invoices, this.outbox, invoice);
    return resolution;
  }

  hold(tenantId: TenantId, invoiceId: Ulid, reason: string): SupplierInvoice {
    const invoice = this.get(tenantId, invoiceId);
    invoice.hold(reason);
    return commit(this.invoices, this.outbox, invoice);
  }

  release(tenantId: TenantId, invoiceId: Ulid): SupplierInvoice {
    const invoice = this.get(tenantId, invoiceId);
    invoice.release();
    return commit(this.invoices, this.outbox, invoice);
  }

  /**
   * Approves payment and writes the invoiced quantity back onto the purchase
   * order lines, so a later invoice for the same receipt is caught as an
   * over-invoice.
   */
  approveForPayment(tenantId: TenantId, invoiceId: Ulid, approvedBy: Ulid): SupplierInvoice {
    const invoice = this.get(tenantId, invoiceId);
    invoice.approveForPayment(approvedBy);
    commit(this.invoices, this.outbox, invoice);

    const order = invoice.purchaseOrderId
      ? this.orders.findById(tenantId, invoice.purchaseOrderId)
      : undefined;
    if (order) {
      for (const line of invoice.lines) {
        if (line.chargeType !== "goods" || line.purchaseOrderLineNumber === undefined) continue;
        order.recordInvoiced(line.purchaseOrderLineNumber, line.quantity, line.netAmount);
      }
      commit(this.orders, this.outbox, order);
    }
    return invoice;
  }

  reject(tenantId: TenantId, invoiceId: Ulid, reason: string): SupplierInvoice {
    const invoice = this.get(tenantId, invoiceId);
    invoice.reject(reason);
    return commit(this.invoices, this.outbox, invoice);
  }

  cancel(tenantId: TenantId, invoiceId: Ulid, reason: string): SupplierInvoice {
    const invoice = this.get(tenantId, invoiceId);
    invoice.cancel(reason);
    return commit(this.invoices, this.outbox, invoice);
  }

  /** Open exceptions across the tenant, grouped for an AP work queue. */
  exceptionQueue(
    tenantId: TenantId,
  ): Array<{ invoice: SupplierInvoice; exceptions: readonly MatchException[] }> {
    return this.invoices
      .listByStatus(tenantId, "exception")
      .map((invoice) => ({ invoice, exceptions: invoice.openExceptions }))
      .sort((a, b) => b.exceptions.length - a.exceptions.length);
  }

  /** Exception counts by code — the input to a "why do invoices fail" report. */
  exceptionStatistics(tenantId: TenantId): Array<{ code: string; count: number }> {
    const counts = new Map<string, number>();
    for (const invoice of this.invoices.listByTenant(tenantId)) {
      for (const exception of invoice.matchResult?.exceptions ?? []) {
        counts.set(exception.code, (counts.get(exception.code) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Invoices past their due date that procurement has not yet cleared. */
  overdue(tenantId: TenantId): SupplierInvoice[] {
    const today = this.clock.today();
    return this.invoices
      .listByTenant(tenantId)
      .filter((invoice) => invoice.isOverdue(today))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /** Received but not yet invoiced value on an order — the GR/IR balance. */
  goodsReceivedNotInvoiced(tenantId: TenantId, purchaseOrderId: Ulid): Money {
    const order: PurchaseOrder = this.purchaseOrders.get(tenantId, purchaseOrderId);
    const minor = order.lines.reduce(
      (total, line) =>
        total + Math.round(line.netUnitPrice.amountMinor * line.uninvoicedQuantity),
      0,
    );
    return money(minor, order.currency);
  }
}

/** Invoice line helper for HTTP payloads and fixtures. */
export function invoiceLineInput(input: {
  description: string;
  quantity: number;
  uom: string;
  unitPriceMinor: number;
  currency: string;
  purchaseOrderLineNumber?: number;
  taxBps?: number;
  chargeType?: "goods" | "freight" | "misc";
}): InvoiceLineInput {
  return {
    description: input.description,
    quantity: quantity(input.quantity),
    uom: input.uom,
    unitPrice: money(input.unitPriceMinor, input.currency),
    purchaseOrderLineNumber: input.purchaseOrderLineNumber,
    taxBps: input.taxBps,
    chargeType: input.chargeType,
  };
}
