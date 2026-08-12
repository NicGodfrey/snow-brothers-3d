import {
  AggregateRoot,
  envelope,
  money,
  newId,
  nowIso,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  addDays,
  applyBps,
  bps,
  code,
  currencyCode,
  extendPrice,
  paymentTermsDays as validPaymentTerms,
  positiveQuantity,
  requiredText,
  sumMoney,
  uom,
  zeroMoney,
  ZERO_BPS,
  type Bps,
  type IsoDate,
  type Quantity,
  type UomCode,
} from "./common.js";
import { InvalidStateError, invariant, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";
import { normalizeSupplierReference } from "./numbering.js";
import type { MatchException, MatchResult } from "./three-way-match.js";

export type InvoiceStatus =
  | "registered"
  | "matched"
  | "exception"
  | "on_hold"
  | "approved_for_payment"
  | "rejected"
  | "cancelled";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "registered",
  "matched",
  "exception",
  "on_hold",
  "approved_for_payment",
  "rejected",
  "cancelled",
];

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  uom: string;
  unitPrice: Money;
  purchaseOrderLineNumber?: number;
  taxBps?: number;
  itemCode?: string;
  glAccount?: string;
  /** Freight/handling lines carry no purchase order line to match against. */
  chargeType?: "goods" | "freight" | "misc";
}

export class InvoiceLine {
  readonly id: Ulid;
  readonly lineNumber: number;
  description: string;
  quantity: Quantity;
  uom: UomCode;
  unitPrice: Money;
  taxBps: Bps;
  purchaseOrderLineNumber?: number;
  itemCode?: string;
  glAccount?: string;
  chargeType: "goods" | "freight" | "misc";

  constructor(lineNumber: number, input: InvoiceLineInput) {
    invariant(input.unitPrice.amountMinor >= 0, "unitPrice", "must not be negative");
    this.id = newId("invline");
    this.lineNumber = lineNumber;
    this.description = requiredText(input.description, "description", 2, 500);
    this.quantity = positiveQuantity(input.quantity, "quantity");
    this.uom = uom(input.uom);
    this.unitPrice = input.unitPrice;
    this.taxBps = input.taxBps === undefined ? ZERO_BPS : bps(input.taxBps, "taxBps");
    this.purchaseOrderLineNumber = input.purchaseOrderLineNumber;
    this.itemCode = input.itemCode;
    this.glAccount = input.glAccount ? code(input.glAccount, "glAccount") : undefined;
    this.chargeType = input.chargeType ?? "goods";
  }

  get netAmount(): Money {
    return extendPrice(this.unitPrice, this.quantity);
  }

  get taxAmount(): Money {
    return applyBps(this.netAmount, this.taxBps);
  }

  get totalAmount(): Money {
    return money(this.netAmount.amountMinor + this.taxAmount.amountMinor, this.unitPrice.currency);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      lineNumber: this.lineNumber,
      description: this.description,
      quantity: this.quantity,
      uom: this.uom,
      unitPrice: this.unitPrice,
      taxBps: this.taxBps,
      purchaseOrderLineNumber: this.purchaseOrderLineNumber,
      itemCode: this.itemCode,
      glAccount: this.glAccount,
      chargeType: this.chargeType,
      netAmount: this.netAmount,
      taxAmount: this.taxAmount,
      totalAmount: this.totalAmount,
    };
  }
}

export interface ExceptionResolution {
  readonly code: string;
  readonly lineNumber?: number;
  readonly action: "resolved" | "waived";
  readonly note: string;
  readonly resolvedBy: Ulid;
  readonly resolvedAt: IsoDateTime;
}

export interface SupplierInvoiceProps {
  invoiceNumber: string;
  supplierInvoiceNumber: string;
  normalizedReference: string;
  supplierId: Ulid;
  purchaseOrderId?: Ulid;
  currency: string;
  status: InvoiceStatus;
  invoiceDate: IsoDate;
  receivedDate: IsoDate;
  dueDate: IsoDate;
  paymentTermsDays: number;
  lines: InvoiceLine[];
  /** Total as printed by the supplier; the match engine reconciles to it. */
  declaredTotal: Money;
  declaredTaxTotal?: Money;
  matchResult?: MatchResult;
  openExceptions: MatchException[];
  resolutions: ExceptionResolution[];
  holdReason?: string;
  rejectionReason?: string;
  cancellationReason?: string;
  approvedBy?: Ulid;
  approvedAt?: IsoDateTime;
  notes?: string;
}

export type SupplierInvoiceView = EntityProps &
  SupplierInvoiceProps & {
    computedNetTotal: Money;
    computedTaxTotal: Money;
    computedTotal: Money;
    hasBlockingException: boolean;
  };

/**
 * Supplier invoice (AP document as procurement sees it).
 *
 *   registered → matched → approved_for_payment
 *              ↘ exception ⇄ on_hold → rejected
 *
 * Procurement owns matching and payment approval; posting to the ledger and
 * the payment run itself belong to finance-erp, which consumes
 * `procurement.invoice.approved_for_payment`.
 */
export class SupplierInvoice extends AggregateRoot<SupplierInvoiceProps> {
  private constructor(tenantId: TenantId, props: SupplierInvoiceProps) {
    super(tenantId, props);
  }

  static register(
    tenantId: TenantId,
    input: {
      invoiceNumber: string;
      supplierInvoiceNumber: string;
      supplierId: Ulid;
      currency: string;
      invoiceDate: IsoDate;
      receivedDate: IsoDate;
      declaredTotal: Money;
      purchaseOrderId?: Ulid;
      paymentTermsDays?: number;
      dueDate?: IsoDate;
      declaredTaxTotal?: Money;
      notes?: string;
      lines?: readonly InvoiceLineInput[];
    },
  ): SupplierInvoice {
    const currency = currencyCode(input.currency);
    if (input.declaredTotal.currency !== currency) {
      throw ValidationError.single("declaredTotal", `must be in the invoice currency ${currency}`);
    }
    const terms = validPaymentTerms(input.paymentTermsDays ?? 30);
    const invoice = new SupplierInvoice(tenantId, {
      invoiceNumber: input.invoiceNumber,
      supplierInvoiceNumber: requiredText(input.supplierInvoiceNumber, "supplierInvoiceNumber", 1, 60),
      normalizedReference: normalizeSupplierReference(input.supplierInvoiceNumber),
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      currency,
      status: "registered",
      invoiceDate: input.invoiceDate,
      receivedDate: input.receivedDate,
      dueDate: input.dueDate ?? addDays(input.invoiceDate, terms),
      paymentTermsDays: terms,
      lines: [],
      declaredTotal: input.declaredTotal,
      declaredTaxTotal: input.declaredTaxTotal,
      openExceptions: [],
      resolutions: [],
      notes: input.notes,
    });
    for (const line of input.lines ?? []) invoice.addLine(line);
    invoice.raise(
      envelope({
        eventType: ProcurementEvents.InvoiceRegistered,
        aggregateType: "SupplierInvoice",
        aggregateId: invoice.id,
        tenantId,
        payload: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.props.invoiceNumber,
          supplierInvoiceNumber: invoice.props.supplierInvoiceNumber,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId,
          declaredTotal: input.declaredTotal,
          dueDate: invoice.props.dueDate,
        },
      }),
    );
    return invoice;
  }

  get invoiceNumber(): string {
    return this.props.invoiceNumber;
  }
  get supplierInvoiceNumber(): string {
    return this.props.supplierInvoiceNumber;
  }
  get normalizedReference(): string {
    return this.props.normalizedReference;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get purchaseOrderId(): Ulid | undefined {
    return this.props.purchaseOrderId;
  }
  get currency(): string {
    return this.props.currency;
  }
  get status(): InvoiceStatus {
    return this.props.status;
  }
  get invoiceDate(): IsoDate {
    return this.props.invoiceDate;
  }
  get dueDate(): IsoDate {
    return this.props.dueDate;
  }
  get lines(): readonly InvoiceLine[] {
    return this.props.lines;
  }
  get declaredTotal(): Money {
    return this.props.declaredTotal;
  }
  get declaredTaxTotal(): Money | undefined {
    return this.props.declaredTaxTotal;
  }
  get matchResult(): MatchResult | undefined {
    return this.props.matchResult;
  }
  get openExceptions(): readonly MatchException[] {
    return this.props.openExceptions;
  }
  get resolutions(): readonly ExceptionResolution[] {
    return this.props.resolutions;
  }
  get approvedBy(): Ulid | undefined {
    return this.props.approvedBy;
  }
  get holdReason(): string | undefined {
    return this.props.holdReason;
  }

  get computedNetTotal(): Money {
    return sumMoney(
      this.props.lines.map((line) => line.netAmount),
      this.props.currency,
    );
  }

  get computedTaxTotal(): Money {
    return sumMoney(
      this.props.lines.map((line) => line.taxAmount),
      this.props.currency,
    );
  }

  get computedTotal(): Money {
    return money(
      this.computedNetTotal.amountMinor + this.computedTaxTotal.amountMinor,
      this.props.currency,
    );
  }

  get hasBlockingException(): boolean {
    return this.props.openExceptions.some((exception) => exception.severity === "blocking");
  }

  get goodsLines(): readonly InvoiceLine[] {
    return this.props.lines.filter((line) => line.chargeType === "goods");
  }

  line(lineNumber: number): InvoiceLine {
    const found = this.props.lines.find((line) => line.lineNumber === lineNumber);
    if (!found) {
      throw ValidationError.single("lineNumber", `${lineNumber} is not a line of ${this.props.invoiceNumber}`);
    }
    return found;
  }

  addLine(input: InvoiceLineInput): InvoiceLine {
    this.assertStatus("add a line to", ["registered"]);
    if (input.unitPrice.currency !== this.props.currency) {
      throw ValidationError.single("unitPrice", `must be in the invoice currency ${this.props.currency}`);
    }
    const line = new InvoiceLine(this.props.lines.length + 1, input);
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  linkPurchaseOrder(purchaseOrderId: Ulid): void {
    this.assertStatus("link a purchase order to", ["registered", "exception", "on_hold"]);
    this.props.purchaseOrderId = purchaseOrderId;
    this.touch();
  }

  /** Records the outcome of a match run and moves the invoice accordingly. */
  applyMatchResult(result: MatchResult): void {
    this.assertStatus("match", ["registered", "matched", "exception", "on_hold"]);
    this.props.matchResult = result;
    this.props.openExceptions = result.exceptions.filter(
      (exception) => !this.isResolved(exception),
    );
    const blocking = this.props.openExceptions.some((e) => e.severity === "blocking");
    this.props.status = blocking ? "exception" : "matched";
    this.raise(
      envelope({
        eventType: blocking
          ? ProcurementEvents.InvoiceMatchExceptionRaised
          : ProcurementEvents.InvoiceMatched,
        aggregateType: "SupplierInvoice",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          invoiceId: this.id,
          invoiceNumber: this.props.invoiceNumber,
          supplierId: this.props.supplierId,
          purchaseOrderId: this.props.purchaseOrderId,
          status: blocking ? "exception" : "matched",
          invoiceTotal: this.props.declaredTotal,
          exceptionCodes: this.props.openExceptions.map((exception) => exception.code),
          matchedLineCount: result.lines.length,
        },
      }),
    );
  }

  /**
   * Clears one exception. `waived` keeps the discrepancy on record (a buyer
   * accepting a small price rise); `resolved` means the underlying data was
   * corrected and a re-match is expected.
   */
  resolveException(input: {
    code: string;
    lineNumber?: number;
    action: "resolved" | "waived";
    note: string;
    resolvedBy: Ulid;
  }): ExceptionResolution {
    this.assertStatus("resolve an exception on", ["exception", "on_hold", "matched"]);
    const index = this.props.openExceptions.findIndex(
      (exception) => exception.code === input.code && exception.lineNumber === input.lineNumber,
    );
    if (index < 0) {
      throw ValidationError.single(
        "code",
        `${input.code}${input.lineNumber ? ` (line ${input.lineNumber})` : ""} is not an open exception on ${this.props.invoiceNumber}`,
      );
    }
    const resolution: ExceptionResolution = {
      code: input.code,
      lineNumber: input.lineNumber,
      action: input.action,
      note: requiredText(input.note, "note", 3, 500),
      resolvedBy: input.resolvedBy,
      resolvedAt: nowIso(),
    };
    this.props.openExceptions.splice(index, 1);
    this.props.resolutions.push(resolution);
    if (!this.hasBlockingException && this.props.status === "exception") {
      this.props.status = "matched";
    }
    this.raise(
      envelope({
        eventType: ProcurementEvents.InvoiceExceptionResolved,
        aggregateType: "SupplierInvoice",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          invoiceId: this.id,
          invoiceNumber: this.props.invoiceNumber,
          code: input.code,
          lineNumber: input.lineNumber,
          action: input.action,
          note: resolution.note,
          resolvedBy: input.resolvedBy,
          remainingExceptions: this.props.openExceptions.length,
          status: this.props.status,
        },
      }),
    );
    return resolution;
  }

  hold(reason: string): void {
    this.assertStatus("hold", ["registered", "matched", "exception"]);
    this.props.status = "on_hold";
    this.props.holdReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.InvoiceHeld,
        aggregateType: "SupplierInvoice",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          invoiceId: this.id,
          invoiceNumber: this.props.invoiceNumber,
          supplierId: this.props.supplierId,
          reason: this.props.holdReason,
        },
      }),
    );
  }

  release(): void {
    this.assertStatus("release", ["on_hold"]);
    this.props.holdReason = undefined;
    this.props.status = this.hasBlockingException ? "exception" : "matched";
    this.touch();
  }

  /**
   * Final procurement step. Downstream, finance-erp posts the AP entry and
   * schedules payment — this context deliberately stops here.
   */
  approveForPayment(approvedBy: Ulid): void {
    this.assertStatus("approve for payment", ["matched"]);
    if (this.hasBlockingException) {
      throw new InvalidStateError(
        `Invoice ${this.props.invoiceNumber} still has blocking match exceptions`,
        { codes: this.props.openExceptions.map((exception) => exception.code) },
      );
    }
    if (this.props.lines.length === 0) {
      throw ValidationError.single("lines", "an invoice needs at least one line before approval");
    }
    this.props.status = "approved_for_payment";
    this.props.approvedBy = approvedBy;
    this.props.approvedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.InvoiceApprovedForPayment,
        aggregateType: "SupplierInvoice",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          invoiceId: this.id,
          invoiceNumber: this.props.invoiceNumber,
          supplierInvoiceNumber: this.props.supplierInvoiceNumber,
          supplierId: this.props.supplierId,
          purchaseOrderId: this.props.purchaseOrderId,
          amount: this.props.declaredTotal,
          dueDate: this.props.dueDate,
          approvedBy,
          waivedExceptions: this.props.resolutions
            .filter((resolution) => resolution.action === "waived")
            .map((resolution) => resolution.code),
          stub: true,
        },
      }),
    );
  }

  reject(reason: string): void {
    this.assertStatus("reject", ["registered", "matched", "exception", "on_hold"]);
    this.props.status = "rejected";
    this.props.rejectionReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.InvoiceCancelled,
        aggregateType: "SupplierInvoice",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          invoiceId: this.id,
          invoiceNumber: this.props.invoiceNumber,
          supplierId: this.props.supplierId,
          outcome: "rejected",
          reason: this.props.rejectionReason,
        },
      }),
    );
  }

  cancel(reason: string): void {
    if (this.props.status === "approved_for_payment" || this.props.status === "cancelled") {
      throw InvalidStateError.transition("invoice", "cancel", this.props.status);
    }
    this.props.status = "cancelled";
    this.props.cancellationReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.InvoiceCancelled,
        aggregateType: "SupplierInvoice",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          invoiceId: this.id,
          invoiceNumber: this.props.invoiceNumber,
          supplierId: this.props.supplierId,
          outcome: "cancelled",
          reason: this.props.cancellationReason,
        },
      }),
    );
  }

  isOverdue(today: IsoDate): boolean {
    return (
      this.props.status !== "approved_for_payment" &&
      this.props.status !== "cancelled" &&
      today > this.props.dueDate
    );
  }

  toJSON(): SupplierInvoiceView {
    return {
      ...super.toJSON(),
      computedNetTotal: this.computedNetTotal,
      computedTaxTotal: this.computedTaxTotal,
      computedTotal: this.computedTotal,
      hasBlockingException: this.hasBlockingException,
    };
  }

  private isResolved(exception: MatchException): boolean {
    return this.props.resolutions.some(
      (resolution) =>
        resolution.code === exception.code && resolution.lineNumber === exception.lineNumber,
    );
  }

  private assertStatus(action: string, expected: readonly InvoiceStatus[]): void {
    if (!expected.includes(this.props.status)) {
      throw InvalidStateError.transition("invoice", action, this.props.status, expected);
    }
  }
}

/** Zero total helper for invoices registered before their lines are keyed. */
export function emptyInvoiceTotal(currency: string): Money {
  return zeroMoney(currency);
}
