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
  addQty,
  applyBps,
  bps,
  code,
  compareDates,
  currencyCode,
  extendPrice,
  incoterm,
  paymentTermsDays as validPaymentTerms,
  positiveQuantity,
  qtyAtLeast,
  qtyEquals,
  qtyGreater,
  quantity,
  requiredText,
  subMoney,
  subQty,
  sumMoney,
  uom,
  varianceBps,
  ZERO_BPS,
  ZERO_QTY,
  zeroMoney,
  type Bps,
  type Incoterm,
  type IsoDate,
  type Quantity,
  type UomCode,
} from "./common.js";
import {
  InvalidStateError,
  invariant,
  ToleranceExceededError,
  ValidationError,
} from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type PurchaseOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "issued"
  | "acknowledged"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";

export const PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "issued",
  "acknowledged",
  "partially_received",
  "received",
  "closed",
  "cancelled",
];

/** Statuses in which the supplier has the order and goods may arrive. */
const LIVE_STATUSES: readonly PurchaseOrderStatus[] = [
  "issued",
  "acknowledged",
  "partially_received",
];

export type PurchaseOrderLineStatus =
  | "open"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";

export type PurchaseOrderSource = "manual" | "requisition" | "quote" | "agreement_release";

export interface OrderTolerances {
  /** Extra quantity accepted above the ordered amount, in basis points. */
  readonly overReceiptBps: number;
  /** Invoice unit-price drift tolerated during three-way match. */
  readonly priceVarianceBps: number;
  /** Value increase on a revision that can skip re-approval. */
  readonly revisionReapprovalBps: number;
}

export const DEFAULT_TOLERANCES: OrderTolerances = {
  overReceiptBps: 500,
  priceVarianceBps: 200,
  revisionReapprovalBps: 1_000,
};

export interface PurchaseOrderLineInput {
  description: string;
  categoryCode: string;
  quantity: number;
  uom: string;
  unitPrice: Money;
  needBy: IsoDate;
  itemCode?: string;
  discountBps?: number;
  taxBps?: number;
  requisitionId?: Ulid;
  requisitionLineId?: Ulid;
  quoteId?: Ulid;
  rfqLineNumber?: number;
  agreementId?: Ulid;
  agreementLineNumber?: number;
  chargeAccount?: string;
  notes?: string;
}

/**
 * A purchase order line carries the full receipt/invoice history for its own
 * quantity, which is what makes both the receipt tolerance check and the
 * three-way match possible without joining back to the child documents.
 */
export class PurchaseOrderLine {
  readonly id: Ulid;
  readonly lineNumber: number;
  description: string;
  categoryCode: string;
  quantity: Quantity;
  uom: UomCode;
  unitPrice: Money;
  discountBps: Bps;
  taxBps: Bps;
  needBy: IsoDate;
  promisedDate?: IsoDate;
  itemCode?: string;
  requisitionId?: Ulid;
  requisitionLineId?: Ulid;
  quoteId?: Ulid;
  rfqLineNumber?: number;
  agreementId?: Ulid;
  agreementLineNumber?: number;
  chargeAccount?: string;
  notes?: string;
  status: PurchaseOrderLineStatus;
  receivedQuantity: Quantity;
  acceptedQuantity: Quantity;
  rejectedQuantity: Quantity;
  invoicedQuantity: Quantity;
  invoicedAmountMinor: number;
  closeReason?: string;
  cancellationReason?: string;

  constructor(lineNumber: number, input: PurchaseOrderLineInput) {
    invariant(input.unitPrice.amountMinor >= 0, "unitPrice", "must not be negative");
    this.id = newId("poline");
    this.lineNumber = lineNumber;
    this.description = requiredText(input.description, "description", 3, 500);
    this.categoryCode = code(input.categoryCode, "categoryCode");
    this.quantity = positiveQuantity(input.quantity, "quantity");
    this.uom = uom(input.uom);
    this.unitPrice = input.unitPrice;
    this.discountBps = input.discountBps === undefined ? ZERO_BPS : bps(input.discountBps, "discountBps");
    if (this.discountBps > 10_000) {
      throw ValidationError.single("discountBps", "cannot exceed 10000 basis points (100%)");
    }
    this.taxBps = input.taxBps === undefined ? ZERO_BPS : bps(input.taxBps, "taxBps");
    this.needBy = input.needBy;
    this.itemCode = input.itemCode ? code(input.itemCode, "itemCode", 60) : undefined;
    this.requisitionId = input.requisitionId;
    this.requisitionLineId = input.requisitionLineId;
    this.quoteId = input.quoteId;
    this.rfqLineNumber = input.rfqLineNumber;
    this.agreementId = input.agreementId;
    this.agreementLineNumber = input.agreementLineNumber;
    this.chargeAccount = input.chargeAccount ? code(input.chargeAccount, "chargeAccount") : undefined;
    this.notes = input.notes;
    this.status = "open";
    this.receivedQuantity = ZERO_QTY;
    this.acceptedQuantity = ZERO_QTY;
    this.rejectedQuantity = ZERO_QTY;
    this.invoicedQuantity = ZERO_QTY;
    this.invoicedAmountMinor = 0;
  }

  get currency(): string {
    return this.unitPrice.currency;
  }

  get netUnitPrice(): Money {
    return money(
      Math.round(this.unitPrice.amountMinor * (1 - this.discountBps / 10_000)),
      this.unitPrice.currency,
    );
  }

  get grossAmount(): Money {
    return extendPrice(this.unitPrice, this.quantity);
  }

  get discountAmount(): Money {
    return applyBps(this.grossAmount, this.discountBps);
  }

  get netAmount(): Money {
    return subMoney(this.grossAmount, this.discountAmount);
  }

  get taxAmount(): Money {
    return applyBps(this.netAmount, this.taxBps);
  }

  get totalAmount(): Money {
    return money(this.netAmount.amountMinor + this.taxAmount.amountMinor, this.currency);
  }

  /** Quantity still expected from the supplier (accepted counts, rejected does not). */
  get outstandingQuantity(): Quantity {
    if (this.status === "cancelled" || this.status === "closed") return ZERO_QTY;
    return subQty(this.quantity, this.acceptedQuantity);
  }

  get uninvoicedQuantity(): Quantity {
    return subQty(this.acceptedQuantity, this.invoicedQuantity);
  }

  get receivedValue(): Money {
    return extendPrice(this.netUnitPrice, this.acceptedQuantity);
  }

  get invoicedAmount(): Money {
    return money(this.invoicedAmountMinor, this.currency);
  }

  get isSettled(): boolean {
    return this.status === "received" || this.status === "closed" || this.status === "cancelled";
  }

  maxReceivableQuantity(overReceiptBps: number): Quantity {
    return quantity(this.quantity * (1 + overReceiptBps / 10_000));
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      lineNumber: this.lineNumber,
      description: this.description,
      categoryCode: this.categoryCode,
      quantity: this.quantity,
      uom: this.uom,
      unitPrice: this.unitPrice,
      netUnitPrice: this.netUnitPrice,
      discountBps: this.discountBps,
      taxBps: this.taxBps,
      needBy: this.needBy,
      promisedDate: this.promisedDate,
      itemCode: this.itemCode,
      requisitionId: this.requisitionId,
      requisitionLineId: this.requisitionLineId,
      quoteId: this.quoteId,
      rfqLineNumber: this.rfqLineNumber,
      agreementId: this.agreementId,
      agreementLineNumber: this.agreementLineNumber,
      chargeAccount: this.chargeAccount,
      notes: this.notes,
      status: this.status,
      receivedQuantity: this.receivedQuantity,
      acceptedQuantity: this.acceptedQuantity,
      rejectedQuantity: this.rejectedQuantity,
      invoicedQuantity: this.invoicedQuantity,
      outstandingQuantity: this.outstandingQuantity,
      uninvoicedQuantity: this.uninvoicedQuantity,
      netAmount: this.netAmount,
      taxAmount: this.taxAmount,
      totalAmount: this.totalAmount,
      invoicedAmount: this.invoicedAmount,
      closeReason: this.closeReason,
      cancellationReason: this.cancellationReason,
    };
  }
}

export interface OrderRevision {
  readonly revision: number;
  readonly at: IsoDateTime;
  readonly reason: string;
  readonly changedBy: Ulid;
  readonly previousTotalMinor: number;
  readonly newTotalMinor: number;
  readonly requiredReapproval: boolean;
}

export interface PurchaseOrderProps {
  orderNumber: string;
  revision: number;
  supplierId: Ulid;
  buyerId: Ulid;
  currency: string;
  status: PurchaseOrderStatus;
  orderDate: IsoDate;
  incoterm: Incoterm;
  paymentTermsDays: number;
  shipTo: string;
  billTo: string;
  lines: PurchaseOrderLine[];
  tolerances: OrderTolerances;
  sourceType: PurchaseOrderSource;
  requisitionIds: Ulid[];
  rfqId?: Ulid;
  quoteId?: Ulid;
  agreementId?: Ulid;
  approvalRequestId?: Ulid;
  supplierReference?: string;
  notes?: string;
  revisions: OrderRevision[];
  issuedAt?: IsoDateTime;
  acknowledgedAt?: IsoDateTime;
  closedAt?: IsoDateTime;
  rejectionReason?: string;
  cancellationReason?: string;
  closeReason?: string;
}

export type PurchaseOrderView = EntityProps &
  PurchaseOrderProps & {
    netTotal: Money;
    taxTotal: Money;
    grandTotal: Money;
    receivedValue: Money;
    invoicedValue: Money;
    outstandingValue: Money;
    openLineCount: number;
  };

/**
 * Purchase order.
 *
 *   draft → pending_approval → approved → issued → acknowledged
 *         → partially_received → received → closed
 *
 * Post-issue changes go through `revise`, which bumps the revision and pushes
 * the order back into approval when the value rises beyond the configured
 * tolerance — the behaviour buyers expect from "change order" handling.
 */
export class PurchaseOrder extends AggregateRoot<PurchaseOrderProps> {
  private constructor(tenantId: TenantId, props: PurchaseOrderProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      orderNumber: string;
      supplierId: Ulid;
      buyerId: Ulid;
      currency: string;
      orderDate: IsoDate;
      shipTo: string;
      billTo?: string;
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
    },
  ): PurchaseOrder {
    const tolerances: OrderTolerances = { ...DEFAULT_TOLERANCES, ...input.tolerances };
    for (const [key, value] of Object.entries(tolerances)) bps(value, key);
    const order = new PurchaseOrder(tenantId, {
      orderNumber: input.orderNumber,
      revision: 0,
      supplierId: input.supplierId,
      buyerId: input.buyerId,
      currency: currencyCode(input.currency),
      status: "draft",
      orderDate: input.orderDate,
      incoterm: incoterm(input.incoterm ?? "DAP"),
      paymentTermsDays: validPaymentTerms(input.paymentTermsDays ?? 30),
      shipTo: requiredText(input.shipTo, "shipTo", 2, 200),
      billTo: requiredText(input.billTo ?? input.shipTo, "billTo", 2, 200),
      lines: [],
      tolerances,
      sourceType: input.sourceType ?? "manual",
      requisitionIds: [...(input.requisitionIds ?? [])],
      rfqId: input.rfqId,
      quoteId: input.quoteId,
      agreementId: input.agreementId,
      supplierReference: input.supplierReference,
      notes: input.notes,
      revisions: [],
    });
    for (const line of input.lines ?? []) order.addLine(line);
    order.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderCreated,
        aggregateType: "PurchaseOrder",
        aggregateId: order.id,
        tenantId,
        payload: {
          purchaseOrderId: order.id,
          orderNumber: order.props.orderNumber,
          supplierId: input.supplierId,
          buyerId: input.buyerId,
          currency: order.props.currency,
          sourceType: order.props.sourceType,
          netTotal: order.netTotal,
        },
      }),
    );
    return order;
  }

  // -- accessors ------------------------------------------------------------

  get orderNumber(): string {
    return this.props.orderNumber;
  }
  get revision(): number {
    return this.props.revision;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get buyerId(): Ulid {
    return this.props.buyerId;
  }
  get currency(): string {
    return this.props.currency;
  }
  get status(): PurchaseOrderStatus {
    return this.props.status;
  }
  get orderDate(): IsoDate {
    return this.props.orderDate;
  }
  get incoterm(): Incoterm {
    return this.props.incoterm;
  }
  get paymentTermsDays(): number {
    return this.props.paymentTermsDays;
  }
  get shipTo(): string {
    return this.props.shipTo;
  }
  get lines(): readonly PurchaseOrderLine[] {
    return this.props.lines;
  }
  get tolerances(): OrderTolerances {
    return this.props.tolerances;
  }
  get sourceType(): PurchaseOrderSource {
    return this.props.sourceType;
  }
  get requisitionIds(): readonly Ulid[] {
    return this.props.requisitionIds;
  }
  get agreementId(): Ulid | undefined {
    return this.props.agreementId;
  }
  get quoteId(): Ulid | undefined {
    return this.props.quoteId;
  }
  get approvalRequestId(): Ulid | undefined {
    return this.props.approvalRequestId;
  }
  get revisions(): readonly OrderRevision[] {
    return this.props.revisions;
  }
  get issuedAt(): IsoDateTime | undefined {
    return this.props.issuedAt;
  }
  get supplierReference(): string | undefined {
    return this.props.supplierReference;
  }

  get activeLines(): readonly PurchaseOrderLine[] {
    return this.props.lines.filter((line) => line.status !== "cancelled");
  }

  get openLineCount(): number {
    return this.props.lines.filter((line) => line.status === "open" || line.status === "partially_received")
      .length;
  }

  get netTotal(): Money {
    return sumMoney(
      this.activeLines.map((line) => line.netAmount),
      this.props.currency,
    );
  }

  get taxTotal(): Money {
    return sumMoney(
      this.activeLines.map((line) => line.taxAmount),
      this.props.currency,
    );
  }

  get grandTotal(): Money {
    return money(this.netTotal.amountMinor + this.taxTotal.amountMinor, this.props.currency);
  }

  get receivedValue(): Money {
    return sumMoney(
      this.activeLines.map((line) => line.receivedValue),
      this.props.currency,
    );
  }

  get invoicedValue(): Money {
    return sumMoney(
      this.props.lines.map((line) => line.invoicedAmount),
      this.props.currency,
    );
  }

  get outstandingValue(): Money {
    return sumMoney(
      this.activeLines.map((line) => extendPrice(line.netUnitPrice, line.outstandingQuantity)),
      this.props.currency,
    );
  }

  get categoryCodes(): readonly string[] {
    return [...new Set(this.activeLines.map((line) => line.categoryCode))].sort();
  }

  /** Latest date the supplier has committed to, if any line is acknowledged. */
  get latestPromisedDate(): IsoDate | undefined {
    const promised = this.activeLines
      .map((line) => line.promisedDate)
      .filter((date): date is IsoDate => date !== undefined)
      .sort(compareDates);
    return promised[promised.length - 1];
  }

  line(lineId: Ulid): PurchaseOrderLine {
    const found = this.props.lines.find((line) => line.id === lineId);
    if (!found) throw ValidationError.single("lineId", `is not a line of ${this.props.orderNumber}`);
    return found;
  }

  lineByNumber(lineNumber: number): PurchaseOrderLine {
    const found = this.props.lines.find((line) => line.lineNumber === lineNumber);
    if (!found) {
      throw ValidationError.single("lineNumber", `${lineNumber} is not a line of ${this.props.orderNumber}`);
    }
    return found;
  }

  // -- authoring ------------------------------------------------------------

  addLine(input: PurchaseOrderLineInput): PurchaseOrderLine {
    this.assertStatus("add a line to", ["draft", "pending_approval"]);
    if (input.unitPrice.currency !== this.props.currency) {
      throw ValidationError.single("unitPrice", `must be in the order currency ${this.props.currency}`);
    }
    if (this.props.lines.length >= 500) {
      throw ValidationError.single("lines", "a purchase order may not exceed 500 lines");
    }
    const line = new PurchaseOrderLine(this.nextLineNumber(), input);
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  updateLine(
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
    this.assertStatus("update a line of", ["draft", "pending_approval"]);
    return this.applyLinePatch(lineId, patch);
  }

  removeLine(lineId: Ulid): void {
    this.assertStatus("remove a line from", ["draft"]);
    const index = this.props.lines.findIndex((line) => line.id === lineId);
    if (index < 0) throw ValidationError.single("lineId", `is not a line of ${this.props.orderNumber}`);
    this.props.lines.splice(index, 1);
    this.touch();
  }

  // -- approval and issue ---------------------------------------------------

  submitForApproval(): void {
    this.assertStatus("submit", ["draft"]);
    if (this.activeLines.length === 0) {
      throw ValidationError.single("lines", "a purchase order needs at least one active line");
    }
    this.props.status = "pending_approval";
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderSubmitted,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          supplierId: this.props.supplierId,
          netTotal: this.netTotal,
          grandTotal: this.grandTotal,
          categoryCodes: this.categoryCodes,
        },
      }),
    );
  }

  attachApprovalRequest(approvalRequestId: Ulid): void {
    this.props.approvalRequestId = approvalRequestId;
    this.touch();
  }

  approve(approvedBy: readonly Ulid[]): void {
    this.assertStatus("approve", ["pending_approval"]);
    this.props.status = "approved";
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderApproved,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          grandTotal: this.grandTotal,
          approvedBy: [...approvedBy],
        },
      }),
    );
  }

  reject(reason: string): void {
    this.assertStatus("reject", ["pending_approval"]);
    this.props.status = "draft";
    this.props.rejectionReason = requiredText(reason, "reason", 3, 500);
    this.props.approvalRequestId = undefined;
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderRejected,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          reason: this.props.rejectionReason,
        },
      }),
    );
  }

  /** Sends the order to the supplier; this is the commitment point. */
  issue(today: IsoDate): void {
    this.assertStatus("issue", ["approved"]);
    if (this.activeLines.length === 0) {
      throw ValidationError.single("lines", "a purchase order needs at least one active line");
    }
    const earliest = this.activeLines
      .map((line) => line.needBy)
      .sort(compareDates)[0];
    if (earliest && compareDates(earliest, today) < 0) {
      throw ValidationError.single(
        "needBy",
        `line need-by ${earliest} is already in the past (today is ${today})`,
      );
    }
    this.props.status = "issued";
    this.props.issuedAt = nowIso();
    if (this.props.revision === 0) this.props.revision = 1;
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderIssued,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          revision: this.props.revision,
          supplierId: this.props.supplierId,
          buyerId: this.props.buyerId,
          currency: this.props.currency,
          orderTotal: this.grandTotal,
          incoterm: this.props.incoterm,
          paymentTermsDays: this.props.paymentTermsDays,
          shipTo: this.props.shipTo,
          lines: this.activeLines.map((line) => ({
            lineNumber: line.lineNumber,
            itemCode: line.itemCode,
            description: line.description,
            quantity: line.quantity,
            uom: line.uom,
            unitPrice: line.netUnitPrice,
            needBy: line.needBy,
          })),
        },
      }),
    );
  }

  acknowledge(input: {
    supplierReference?: string;
    promisedDates?: ReadonlyArray<{ lineNumber: number; promisedDate: IsoDate }>;
  }): void {
    this.assertStatus("acknowledge", ["issued"]);
    if (input.supplierReference !== undefined) {
      this.props.supplierReference = requiredText(input.supplierReference, "supplierReference", 1, 60);
    }
    for (const promise of input.promisedDates ?? []) {
      const line = this.lineByNumber(promise.lineNumber);
      line.promisedDate = promise.promisedDate;
    }
    this.props.status = "acknowledged";
    this.props.acknowledgedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderAcknowledged,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          supplierId: this.props.supplierId,
          supplierReference: this.props.supplierReference,
          promisedDates: (input.promisedDates ?? []).map((promise) => ({ ...promise })),
          latePromises: this.activeLines
            .filter((line) => line.promisedDate && compareDates(line.promisedDate, line.needBy) > 0)
            .map((line) => line.lineNumber),
        },
      }),
    );
  }

  /**
   * Change order. Applies line patches, bumps the revision and returns the
   * order to `pending_approval` when the value increase exceeds the tolerance.
   */
  revise(input: {
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
  }): OrderRevision {
    this.assertStatus("revise", ["issued", "acknowledged", "partially_received"]);
    const reason = requiredText(input.reason, "reason", 5, 500);
    const previousTotal = this.grandTotal.amountMinor;

    for (const change of input.lineChanges ?? []) {
      const line = this.line(change.lineId);
      if (change.quantity !== undefined) {
        const newQuantity = positiveQuantity(change.quantity, "quantity");
        if (!qtyAtLeast(newQuantity, line.acceptedQuantity)) {
          throw ValidationError.single(
            "quantity",
            `line ${line.lineNumber} already has ${line.acceptedQuantity} received; cannot reduce below that`,
          );
        }
      }
      this.applyLinePatch(change.lineId, change);
    }
    for (const newLine of input.newLines ?? []) {
      if (newLine.unitPrice.currency !== this.props.currency) {
        throw ValidationError.single("unitPrice", `must be in the order currency ${this.props.currency}`);
      }
      this.props.lines.push(new PurchaseOrderLine(this.nextLineNumber(), newLine));
    }
    if (input.paymentTermsDays !== undefined) {
      this.props.paymentTermsDays = validPaymentTerms(input.paymentTermsDays);
    }
    if (input.incoterm !== undefined) this.props.incoterm = incoterm(input.incoterm);
    if (input.shipTo !== undefined) this.props.shipTo = requiredText(input.shipTo, "shipTo", 2, 200);

    const newTotal = this.grandTotal.amountMinor;
    const increaseBps = newTotal > previousTotal ? varianceBps(newTotal, previousTotal) : 0;
    const requiresReapproval = increaseBps > this.props.tolerances.revisionReapprovalBps;
    this.props.revision += 1;
    const revision: OrderRevision = {
      revision: this.props.revision,
      at: nowIso(),
      reason,
      changedBy: input.changedBy,
      previousTotalMinor: previousTotal,
      newTotalMinor: newTotal,
      requiredReapproval: requiresReapproval,
    };
    this.props.revisions.push(revision);
    if (requiresReapproval) {
      this.props.status = "pending_approval";
      this.props.approvalRequestId = undefined;
    }
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderRevised,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          revision: this.props.revision,
          reason,
          previousTotal: money(previousTotal, this.props.currency),
          newTotal: money(newTotal, this.props.currency),
          increaseBps,
          requiresReapproval,
          supplierId: this.props.supplierId,
        },
      }),
    );
    return revision;
  }

  /** Re-issues an order that went back through approval after a revision. */
  reissue(today: IsoDate): void {
    this.assertStatus("re-issue", ["approved"]);
    this.props.status = this.props.lines.some((line) => line.acceptedQuantity > 0)
      ? "partially_received"
      : "issued";
    if (this.props.status === "issued") {
      this.props.issuedAt = nowIso();
    }
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderIssued,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          revision: this.props.revision,
          supplierId: this.props.supplierId,
          buyerId: this.props.buyerId,
          currency: this.props.currency,
          orderTotal: this.grandTotal,
          incoterm: this.props.incoterm,
          paymentTermsDays: this.props.paymentTermsDays,
          shipTo: this.props.shipTo,
          reissuedOn: today,
          lines: this.activeLines.map((line) => ({
            lineNumber: line.lineNumber,
            itemCode: line.itemCode,
            description: line.description,
            quantity: line.quantity,
            uom: line.uom,
            unitPrice: line.netUnitPrice,
            needBy: line.needBy,
          })),
        },
      }),
    );
  }

  // -- receiving ------------------------------------------------------------

  /**
   * Applies a posted receipt line. Accepted quantity may exceed the ordered
   * quantity only within `overReceiptBps`; anything beyond that is rejected so
   * the buyer must issue a change order first.
   */
  applyReceipt(input: {
    lineNumber: number;
    receivedQuantity: Quantity;
    acceptedQuantity: Quantity;
    rejectedQuantity: Quantity;
  }): PurchaseOrderLine {
    if (!LIVE_STATUSES.includes(this.props.status)) {
      throw InvalidStateError.transition("purchase order", "receive against", this.props.status, LIVE_STATUSES);
    }
    const line = this.lineByNumber(input.lineNumber);
    if (line.status === "cancelled" || line.status === "closed") {
      throw InvalidStateError.transition("purchase order line", "receive against", line.status);
    }
    const newAccepted = addQty(line.acceptedQuantity, input.acceptedQuantity);
    const maxReceivable = line.maxReceivableQuantity(this.props.tolerances.overReceiptBps);
    if (qtyGreater(newAccepted, maxReceivable)) {
      throw new ToleranceExceededError(
        `Receiving ${input.acceptedQuantity} would take line ${line.lineNumber} to ${newAccepted} ${line.uom}, above the ${maxReceivable} allowed by the ${this.props.tolerances.overReceiptBps}bp over-receipt tolerance`,
        "OVER_RECEIPT",
        {
          lineNumber: line.lineNumber,
          orderedQuantity: line.quantity,
          acceptedQuantity: line.acceptedQuantity,
          attemptedQuantity: input.acceptedQuantity,
          maxReceivable,
        },
      );
    }
    line.receivedQuantity = addQty(line.receivedQuantity, input.receivedQuantity);
    line.acceptedQuantity = newAccepted;
    line.rejectedQuantity = addQty(line.rejectedQuantity, input.rejectedQuantity);
    line.status = qtyAtLeast(line.acceptedQuantity, line.quantity) ? "received" : "partially_received";
    this.refreshReceiptStatus();
    return line;
  }

  /** Backs a receipt out again (reversal or return to vendor). */
  reverseReceipt(input: {
    lineNumber: number;
    receivedQuantity: Quantity;
    acceptedQuantity: Quantity;
    rejectedQuantity: Quantity;
  }): PurchaseOrderLine {
    const line = this.lineByNumber(input.lineNumber);
    if (!qtyAtLeast(line.acceptedQuantity, input.acceptedQuantity)) {
      throw ValidationError.single(
        "acceptedQuantity",
        `cannot reverse ${input.acceptedQuantity} from line ${line.lineNumber} which has only ${line.acceptedQuantity} accepted`,
      );
    }
    if (qtyGreater(line.invoicedQuantity, subQty(line.acceptedQuantity, input.acceptedQuantity))) {
      throw new InvalidStateError(
        `Line ${line.lineNumber} has ${line.invoicedQuantity} invoiced; reverse or credit the invoice before the receipt`,
        { lineNumber: line.lineNumber, invoicedQuantity: line.invoicedQuantity },
      );
    }
    line.receivedQuantity = subQty(line.receivedQuantity, input.receivedQuantity);
    line.acceptedQuantity = subQty(line.acceptedQuantity, input.acceptedQuantity);
    line.rejectedQuantity = subQty(line.rejectedQuantity, input.rejectedQuantity);
    if (line.status !== "cancelled" && line.status !== "closed") {
      line.status = line.acceptedQuantity <= 0 ? "open" : "partially_received";
    }
    if (this.props.status === "received" || this.props.status === "closed") {
      this.props.status = "partially_received";
    }
    this.refreshReceiptStatus();
    return line;
  }

  /** Records an invoice match against a line, feeding the uninvoiced balance. */
  recordInvoiced(lineNumber: number, invoicedQty: Quantity, amount: Money): PurchaseOrderLine {
    const line = this.lineByNumber(lineNumber);
    if (amount.currency !== this.props.currency) {
      throw ValidationError.single("amount", `must be in the order currency ${this.props.currency}`);
    }
    line.invoicedQuantity = addQty(line.invoicedQuantity, invoicedQty);
    line.invoicedAmountMinor += amount.amountMinor;
    this.touch();
    return line;
  }

  reverseInvoiced(lineNumber: number, invoicedQty: Quantity, amount: Money): PurchaseOrderLine {
    const line = this.lineByNumber(lineNumber);
    line.invoicedQuantity = subQty(line.invoicedQuantity, invoicedQty);
    line.invoicedAmountMinor -= amount.amountMinor;
    this.touch();
    return line;
  }

  // -- closing --------------------------------------------------------------

  /** Short-closes a line: the buyer accepts under-delivery and stops chasing. */
  closeLine(lineNumber: number, reason: string): PurchaseOrderLine {
    const line = this.lineByNumber(lineNumber);
    if (line.status === "cancelled") {
      throw InvalidStateError.transition("purchase order line", "close", line.status);
    }
    line.status = "closed";
    line.closeReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderLineClosed,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          lineNumber,
          shortQuantity: subQty(line.quantity, line.acceptedQuantity),
          reason: line.closeReason,
        },
      }),
    );
    this.refreshReceiptStatus();
    return line;
  }

  cancelLine(lineNumber: number, reason: string): PurchaseOrderLine {
    const line = this.lineByNumber(lineNumber);
    if (line.acceptedQuantity > 0) {
      throw new InvalidStateError(
        `Line ${lineNumber} has ${line.acceptedQuantity} received; close it short instead of cancelling`,
        { lineNumber, acceptedQuantity: line.acceptedQuantity },
      );
    }
    line.status = "cancelled";
    line.cancellationReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderLineCancelled,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          lineNumber,
          reason: line.cancellationReason,
        },
      }),
    );
    this.refreshReceiptStatus();
    return line;
  }

  close(reason: string): void {
    if (!["received", "partially_received", "issued", "acknowledged"].includes(this.props.status)) {
      throw InvalidStateError.transition("purchase order", "close", this.props.status, [
        "issued",
        "acknowledged",
        "partially_received",
        "received",
      ]);
    }
    const uninvoiced = this.activeLines.filter((line) => qtyGreater(line.uninvoicedQuantity, ZERO_QTY));
    this.props.status = "closed";
    this.props.closedAt = nowIso();
    this.props.closeReason = requiredText(reason, "reason", 3, 500);
    for (const line of this.props.lines) {
      if (line.status === "open" || line.status === "partially_received") {
        line.status = "closed";
        line.closeReason = this.props.closeReason;
      }
    }
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderClosed,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          supplierId: this.props.supplierId,
          reason: this.props.closeReason,
          receivedValue: this.receivedValue,
          invoicedValue: this.invoicedValue,
          uninvoicedLineNumbers: uninvoiced.map((line) => line.lineNumber),
        },
      }),
    );
  }

  cancel(reason: string): void {
    if (["closed", "cancelled", "received"].includes(this.props.status)) {
      throw InvalidStateError.transition("purchase order", "cancel", this.props.status);
    }
    if (this.props.lines.some((line) => line.acceptedQuantity > 0)) {
      throw new InvalidStateError(
        `Purchase order ${this.props.orderNumber} has received quantity; close it instead of cancelling`,
      );
    }
    this.props.status = "cancelled";
    this.props.cancellationReason = requiredText(reason, "reason", 3, 500);
    this.props.closedAt = nowIso();
    for (const line of this.props.lines) {
      if (line.status !== "cancelled") line.status = "cancelled";
    }
    this.raise(
      envelope({
        eventType: ProcurementEvents.PurchaseOrderCancelled,
        aggregateType: "PurchaseOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          purchaseOrderId: this.id,
          orderNumber: this.props.orderNumber,
          supplierId: this.props.supplierId,
          agreementId: this.props.agreementId,
          releasedValue: this.netTotal,
          reason: this.props.cancellationReason,
        },
      }),
    );
  }

  toJSON(): PurchaseOrderView {
    return {
      ...super.toJSON(),
      netTotal: this.netTotal,
      taxTotal: this.taxTotal,
      grandTotal: this.grandTotal,
      receivedValue: this.receivedValue,
      invoicedValue: this.invoicedValue,
      outstandingValue: this.outstandingValue,
      openLineCount: this.openLineCount,
    };
  }

  // -- internals ------------------------------------------------------------

  private nextLineNumber(): number {
    return this.props.lines.reduce((max, line) => Math.max(max, line.lineNumber), 0) + 10;
  }

  private applyLinePatch(
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
    const line = this.line(lineId);
    if (line.status === "cancelled") {
      throw InvalidStateError.transition("purchase order line", "update", line.status);
    }
    if (patch.quantity !== undefined) line.quantity = positiveQuantity(patch.quantity, "quantity");
    if (patch.unitPrice !== undefined) {
      if (patch.unitPrice.currency !== this.props.currency) {
        throw ValidationError.single("unitPrice", `must be in the order currency ${this.props.currency}`);
      }
      invariant(patch.unitPrice.amountMinor >= 0, "unitPrice", "must not be negative");
      line.unitPrice = patch.unitPrice;
    }
    if (patch.needBy !== undefined) line.needBy = patch.needBy;
    if (patch.description !== undefined) {
      line.description = requiredText(patch.description, "description", 3, 500);
    }
    if (patch.discountBps !== undefined) line.discountBps = bps(patch.discountBps, "discountBps");
    if (patch.taxBps !== undefined) line.taxBps = bps(patch.taxBps, "taxBps");
    if (patch.notes !== undefined) line.notes = patch.notes;
    this.touch();
    return line;
  }

  /** Rolls the header between issued / partially_received / received. */
  private refreshReceiptStatus(): void {
    if (!LIVE_STATUSES.includes(this.props.status)) return;
    const active = this.activeLines;
    if (active.length === 0) return;
    const settled = active.every(
      (line) => line.status === "received" || line.status === "closed",
    );
    const anyReceipt = active.some((line) => line.acceptedQuantity > 0);
    const previous = this.props.status;
    if (settled) {
      this.props.status = "received";
      if (previous !== "received") {
        this.raise(
          envelope({
            eventType: ProcurementEvents.PurchaseOrderReceived,
            aggregateType: "PurchaseOrder",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
              purchaseOrderId: this.id,
              orderNumber: this.props.orderNumber,
              supplierId: this.props.supplierId,
              receivedValue: this.receivedValue,
            },
          }),
        );
      }
      return;
    }
    if (anyReceipt) {
      this.props.status = "partially_received";
      if (previous !== "partially_received") {
        this.raise(
          envelope({
            eventType: ProcurementEvents.PurchaseOrderPartiallyReceived,
            aggregateType: "PurchaseOrder",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
              purchaseOrderId: this.id,
              orderNumber: this.props.orderNumber,
              supplierId: this.props.supplierId,
              outstandingValue: this.outstandingValue,
            },
          }),
        );
      }
    }
  }

  private assertStatus(action: string, expected: readonly PurchaseOrderStatus[]): void {
    if (!expected.includes(this.props.status)) {
      throw InvalidStateError.transition("purchase order", action, this.props.status, expected);
    }
  }
}

/** Helper used by tests, fixtures and HTTP to build a line from raw numbers. */
export function purchaseOrderLineInput(input: {
  description: string;
  categoryCode: string;
  quantity: number;
  uom: string;
  unitPriceMinor: number;
  currency: string;
  needBy: IsoDate;
  taxBps?: number;
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
    itemCode: input.itemCode,
  };
}

/** Zero-value order total, used when an order has no active lines yet. */
export function emptyOrderTotal(currency: string): Money {
  return zeroMoney(currency);
}

/** True when every active line has been fully received or short-closed. */
export function isFullyReceived(order: PurchaseOrder): boolean {
  return order.activeLines.every(
    (line) => line.status === "received" || line.status === "closed" || qtyEquals(line.outstandingQuantity, ZERO_QTY),
  );
}
