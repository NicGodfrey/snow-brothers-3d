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
  code,
  compareDates,
  currencyCode,
  extendPrice,
  positiveQuantity,
  qtyAtLeast,
  qtyEquals,
  quantity,
  requiredText,
  subQty,
  sumMoney,
  uom,
  ZERO_QTY,
  type IsoDate,
  type Quantity,
  type UomCode,
} from "./common.js";
import { InvalidStateError, invariant, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type RequisitionStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "partially_ordered"
  | "ordered"
  | "closed"
  | "cancelled";

export const REQUISITION_STATUSES: readonly RequisitionStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "partially_ordered",
  "ordered",
  "closed",
  "cancelled",
];

export type RequisitionPriority = "routine" | "urgent" | "emergency";

export const REQUISITION_PRIORITIES: readonly RequisitionPriority[] = [
  "routine",
  "urgent",
  "emergency",
];

export type RequisitionLineStatus =
  | "open"
  | "sourcing"
  | "partially_ordered"
  | "ordered"
  | "cancelled";

export interface RequisitionLineInput {
  description: string;
  categoryCode: string;
  quantity: number;
  uom: string;
  estimatedUnitPrice: Money;
  neededBy?: IsoDate;
  itemCode?: string;
  suggestedSupplierId?: Ulid;
  glAccount?: string;
  notes?: string;
}

/**
 * A requisition line tracks its own sourcing progress: buyers routinely split
 * one requested line across several purchase orders (multiple suppliers,
 * staged deliveries), so `orderedQuantity` accumulates and the line only
 * closes once the full quantity is on order or the remainder is cancelled.
 */
export class RequisitionLine {
  readonly id: Ulid;
  readonly lineNumber: number;
  description: string;
  categoryCode: string;
  quantity: Quantity;
  uom: UomCode;
  estimatedUnitPrice: Money;
  neededBy?: IsoDate;
  itemCode?: string;
  suggestedSupplierId?: Ulid;
  glAccount?: string;
  notes?: string;
  status: RequisitionLineStatus;
  orderedQuantity: Quantity;
  purchaseOrderIds: Ulid[];
  rfqId?: Ulid;
  agreementId?: Ulid;
  cancellationReason?: string;

  constructor(lineNumber: number, input: RequisitionLineInput) {
    this.id = newId("prline");
    this.lineNumber = lineNumber;
    this.description = requiredText(input.description, "description", 3, 500);
    this.categoryCode = code(input.categoryCode, "categoryCode");
    this.quantity = positiveQuantity(input.quantity, "quantity");
    this.uom = uom(input.uom);
    this.estimatedUnitPrice = input.estimatedUnitPrice;
    invariant(
      input.estimatedUnitPrice.amountMinor >= 0,
      "estimatedUnitPrice",
      "must not be negative",
    );
    this.neededBy = input.neededBy;
    this.itemCode = input.itemCode ? code(input.itemCode, "itemCode", 60) : undefined;
    this.suggestedSupplierId = input.suggestedSupplierId;
    this.glAccount = input.glAccount ? code(input.glAccount, "glAccount") : undefined;
    this.notes = input.notes;
    this.status = "open";
    this.orderedQuantity = ZERO_QTY;
    this.purchaseOrderIds = [];
  }

  get estimatedTotal(): Money {
    return extendPrice(this.estimatedUnitPrice, this.quantity);
  }

  get remainingQuantity(): Quantity {
    return subQty(this.quantity, this.orderedQuantity);
  }

  get isSettled(): boolean {
    return this.status === "ordered" || this.status === "cancelled";
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      lineNumber: this.lineNumber,
      description: this.description,
      categoryCode: this.categoryCode,
      quantity: this.quantity,
      uom: this.uom,
      estimatedUnitPrice: this.estimatedUnitPrice,
      estimatedTotal: this.estimatedTotal,
      neededBy: this.neededBy,
      itemCode: this.itemCode,
      suggestedSupplierId: this.suggestedSupplierId,
      glAccount: this.glAccount,
      notes: this.notes,
      status: this.status,
      orderedQuantity: this.orderedQuantity,
      remainingQuantity: this.remainingQuantity,
      purchaseOrderIds: [...this.purchaseOrderIds],
      rfqId: this.rfqId,
      agreementId: this.agreementId,
      cancellationReason: this.cancellationReason,
    };
  }
}

export interface PurchaseRequisitionProps {
  requisitionNumber: string;
  title: string;
  requesterId: Ulid;
  costCenter: string;
  currency: string;
  neededBy: IsoDate;
  priority: RequisitionPriority;
  justification: string;
  status: RequisitionStatus;
  lines: RequisitionLine[];
  deliverTo: string;
  budgetCode?: string;
  projectCode?: string;
  approvalRequestId?: Ulid;
  submittedAt?: IsoDateTime;
  approvedAt?: IsoDateTime;
  closedAt?: IsoDateTime;
  rejectionReason?: string;
  cancellationReason?: string;
  closeReason?: string;
  notes?: string;
}

export type PurchaseRequisitionView = EntityProps &
  PurchaseRequisitionProps & {
    estimatedTotal: Money;
    orderedValue: Money;
    openValue: Money;
    categoryCodes: readonly string[];
  };

/**
 * Purchase requisition — the demand document that starts every procurement
 * flow.
 *
 *   draft → pending_approval → approved → partially_ordered → ordered → closed
 *
 * A rejection sends it back to `rejected` (re-openable to `draft` by the
 * requester), and cancellation is allowed from any state that has not yet
 * placed quantity on order.
 */
export class PurchaseRequisition extends AggregateRoot<PurchaseRequisitionProps> {
  private constructor(tenantId: TenantId, props: PurchaseRequisitionProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      requisitionNumber: string;
      title: string;
      requesterId: Ulid;
      costCenter: string;
      currency: string;
      neededBy: IsoDate;
      deliverTo: string;
      priority?: RequisitionPriority;
      justification?: string;
      budgetCode?: string;
      projectCode?: string;
      notes?: string;
      lines?: readonly RequisitionLineInput[];
    },
  ): PurchaseRequisition {
    const priority = input.priority ?? "routine";
    const justification = requiredText(input.justification ?? "", "justification", 0, 2000);
    if (priority === "emergency" && justification.length < 20) {
      throw ValidationError.single(
        "justification",
        "must be at least 20 characters for an emergency requisition",
      );
    }
    const requisition = new PurchaseRequisition(tenantId, {
      requisitionNumber: input.requisitionNumber,
      title: requiredText(input.title, "title", 3, 200),
      requesterId: input.requesterId,
      costCenter: code(input.costCenter, "costCenter"),
      currency: currencyCode(input.currency),
      neededBy: input.neededBy,
      priority,
      justification,
      status: "draft",
      lines: [],
      deliverTo: requiredText(input.deliverTo, "deliverTo", 2, 200),
      budgetCode: input.budgetCode ? code(input.budgetCode, "budgetCode") : undefined,
      projectCode: input.projectCode ? code(input.projectCode, "projectCode") : undefined,
      notes: input.notes,
    });
    for (const line of input.lines ?? []) requisition.addLine(line);
    requisition.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionCreated,
        aggregateType: "PurchaseRequisition",
        aggregateId: requisition.id,
        tenantId,
        payload: {
          requisitionId: requisition.id,
          requisitionNumber: requisition.props.requisitionNumber,
          requesterId: input.requesterId,
          costCenter: requisition.props.costCenter,
          priority,
        },
      }),
    );
    return requisition;
  }

  // -- accessors ------------------------------------------------------------

  get requisitionNumber(): string {
    return this.props.requisitionNumber;
  }
  get title(): string {
    return this.props.title;
  }
  get requesterId(): Ulid {
    return this.props.requesterId;
  }
  get costCenter(): string {
    return this.props.costCenter;
  }
  get currency(): string {
    return this.props.currency;
  }
  get neededBy(): IsoDate {
    return this.props.neededBy;
  }
  get priority(): RequisitionPriority {
    return this.props.priority;
  }
  get status(): RequisitionStatus {
    return this.props.status;
  }
  get lines(): readonly RequisitionLine[] {
    return this.props.lines;
  }
  get budgetCode(): string | undefined {
    return this.props.budgetCode;
  }
  get approvalRequestId(): Ulid | undefined {
    return this.props.approvalRequestId;
  }
  get rejectionReason(): string | undefined {
    return this.props.rejectionReason;
  }
  get deliverTo(): string {
    return this.props.deliverTo;
  }

  get activeLines(): readonly RequisitionLine[] {
    return this.props.lines.filter((line) => line.status !== "cancelled");
  }

  get estimatedTotal(): Money {
    return sumMoney(
      this.activeLines.map((line) => line.estimatedTotal),
      this.props.currency,
    );
  }

  /** Distinct categories on the requisition, used to pick an approval policy. */
  get categoryCodes(): readonly string[] {
    return [...new Set(this.activeLines.map((line) => line.categoryCode))].sort();
  }

  line(lineId: Ulid): RequisitionLine {
    const found = this.props.lines.find((candidate) => candidate.id === lineId);
    if (!found) {
      throw ValidationError.single("lineId", `is not a line of ${this.props.requisitionNumber}`);
    }
    return found;
  }

  lineByNumber(lineNumber: number): RequisitionLine {
    const found = this.props.lines.find((candidate) => candidate.lineNumber === lineNumber);
    if (!found) {
      throw ValidationError.single("lineNumber", `is not a line of ${this.props.requisitionNumber}`);
    }
    return found;
  }

  // -- authoring ------------------------------------------------------------

  addLine(input: RequisitionLineInput): RequisitionLine {
    this.assertEditable("add a line to");
    if (input.estimatedUnitPrice.currency !== this.props.currency) {
      throw ValidationError.single(
        "estimatedUnitPrice",
        `must be in the requisition currency ${this.props.currency}`,
      );
    }
    if (input.neededBy && compareDates(input.neededBy, this.props.neededBy) < 0) {
      throw ValidationError.single(
        "neededBy",
        `line date ${input.neededBy} precedes the requisition need-by ${this.props.neededBy}`,
      );
    }
    if (this.props.lines.length >= 200) {
      throw ValidationError.single("lines", "a requisition may not exceed 200 lines");
    }
    const line = new RequisitionLine(this.nextLineNumber(), input);
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  updateLine(
    lineId: Ulid,
    patch: {
      description?: string;
      quantity?: number;
      estimatedUnitPrice?: Money;
      neededBy?: IsoDate;
      categoryCode?: string;
      suggestedSupplierId?: Ulid;
      notes?: string;
    },
  ): RequisitionLine {
    this.assertEditable("update a line of");
    const line = this.line(lineId);
    if (patch.description !== undefined) {
      line.description = requiredText(patch.description, "description", 3, 500);
    }
    if (patch.quantity !== undefined) {
      line.quantity = positiveQuantity(patch.quantity, "quantity");
    }
    if (patch.estimatedUnitPrice !== undefined) {
      if (patch.estimatedUnitPrice.currency !== this.props.currency) {
        throw ValidationError.single(
          "estimatedUnitPrice",
          `must be in the requisition currency ${this.props.currency}`,
        );
      }
      line.estimatedUnitPrice = patch.estimatedUnitPrice;
    }
    if (patch.neededBy !== undefined) line.neededBy = patch.neededBy;
    if (patch.categoryCode !== undefined) line.categoryCode = code(patch.categoryCode, "categoryCode");
    if (patch.suggestedSupplierId !== undefined) line.suggestedSupplierId = patch.suggestedSupplierId;
    if (patch.notes !== undefined) line.notes = patch.notes;
    this.touch();
    return line;
  }

  removeLine(lineId: Ulid): void {
    this.assertEditable("remove a line from");
    const index = this.props.lines.findIndex((line) => line.id === lineId);
    if (index < 0) {
      throw ValidationError.single("lineId", `is not a line of ${this.props.requisitionNumber}`);
    }
    this.props.lines.splice(index, 1);
    this.touch();
  }

  // -- lifecycle ------------------------------------------------------------

  submit(today: IsoDate): void {
    if (this.props.status !== "draft" && this.props.status !== "rejected") {
      throw InvalidStateError.transition("requisition", "submit", this.props.status, [
        "draft",
        "rejected",
      ]);
    }
    if (this.activeLines.length === 0) {
      throw ValidationError.single("lines", "a requisition needs at least one active line");
    }
    if (compareDates(this.props.neededBy, today) < 0) {
      throw ValidationError.single(
        "neededBy",
        `${this.props.neededBy} is in the past (today is ${today})`,
      );
    }
    this.props.status = "pending_approval";
    this.props.submittedAt = nowIso();
    this.props.rejectionReason = undefined;
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionSubmitted,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          requisitionId: this.id,
          requisitionNumber: this.props.requisitionNumber,
          estimatedTotal: this.estimatedTotal,
          categoryCodes: this.categoryCodes,
          priority: this.props.priority,
        },
      }),
    );
  }

  attachApprovalRequest(approvalRequestId: Ulid): void {
    this.props.approvalRequestId = approvalRequestId;
    this.touch();
  }

  withdraw(reason: string): void {
    if (this.props.status !== "pending_approval") {
      throw InvalidStateError.transition("requisition", "withdraw", this.props.status, [
        "pending_approval",
      ]);
    }
    this.props.status = "draft";
    this.props.approvalRequestId = undefined;
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionWithdrawn,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { requisitionId: this.id, reason: requiredText(reason, "reason", 3, 500) },
      }),
    );
  }

  approve(approvedBy: readonly Ulid[]): void {
    if (this.props.status !== "pending_approval") {
      throw InvalidStateError.transition("requisition", "approve", this.props.status, [
        "pending_approval",
      ]);
    }
    this.props.status = "approved";
    this.props.approvedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionApproved,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          requisitionId: this.id,
          requisitionNumber: this.props.requisitionNumber,
          requesterId: this.props.requesterId,
          costCenter: this.props.costCenter,
          estimatedTotal: this.estimatedTotal,
          neededBy: this.props.neededBy,
          lineCount: this.activeLines.length,
          approvedBy: [...approvedBy],
        },
      }),
    );
  }

  reject(reason: string): void {
    if (this.props.status !== "pending_approval") {
      throw InvalidStateError.transition("requisition", "reject", this.props.status, [
        "pending_approval",
      ]);
    }
    this.props.status = "rejected";
    this.props.rejectionReason = requiredText(reason, "reason", 3, 500);
    this.props.approvalRequestId = undefined;
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionRejected,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          requisitionId: this.id,
          requisitionNumber: this.props.requisitionNumber,
          reason: this.props.rejectionReason,
        },
      }),
    );
  }

  /** Marks a line as being sourced through an RFQ; approved requisitions only. */
  markLineSourcing(lineId: Ulid, rfqId: Ulid): RequisitionLine {
    this.assertSourceable();
    const line = this.line(lineId);
    if (line.status === "cancelled" || line.status === "ordered") {
      throw InvalidStateError.transition("requisition line", "source", line.status, [
        "open",
        "partially_ordered",
      ]);
    }
    line.rfqId = rfqId;
    if (line.status === "open") line.status = "sourcing";
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionLineSourcing,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { requisitionId: this.id, lineNumber: line.lineNumber, rfqId },
      }),
    );
    return line;
  }

  /**
   * Records that `orderedQty` of a line has been placed on a purchase order.
   * Rolls the header to `partially_ordered`/`ordered` as coverage completes.
   */
  recordOrdered(lineId: Ulid, orderedQty: Quantity, purchaseOrderId: Ulid): RequisitionLine {
    this.assertSourceable();
    const line = this.line(lineId);
    if (line.status === "cancelled") {
      throw InvalidStateError.transition("requisition line", "order against", line.status);
    }
    const remaining = line.remainingQuantity;
    if (!qtyAtLeast(remaining, orderedQty)) {
      throw ValidationError.single(
        "quantity",
        `ordering ${orderedQty} exceeds the ${remaining} still outstanding on line ${line.lineNumber}`,
      );
    }
    line.orderedQuantity = addQty(line.orderedQuantity, orderedQty);
    if (!line.purchaseOrderIds.includes(purchaseOrderId)) {
      line.purchaseOrderIds.push(purchaseOrderId);
    }
    line.status = qtyEquals(line.orderedQuantity, line.quantity) ? "ordered" : "partially_ordered";
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionLineOrdered,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          requisitionId: this.id,
          lineNumber: line.lineNumber,
          orderedQuantity: orderedQty,
          purchaseOrderId,
          lineStatus: line.status,
        },
      }),
    );
    this.refreshHeaderStatus();
    return line;
  }

  /** Releases quantity back to the line when a purchase order is cancelled. */
  releaseOrdered(lineId: Ulid, releasedQty: Quantity, purchaseOrderId: Ulid): RequisitionLine {
    const line = this.line(lineId);
    line.orderedQuantity = subQty(line.orderedQuantity, releasedQty);
    line.purchaseOrderIds = line.purchaseOrderIds.filter((id) => id !== purchaseOrderId);
    if (line.status !== "cancelled") {
      line.status = line.orderedQuantity <= 0 ? "open" : "partially_ordered";
    }
    if (this.props.status === "ordered" || this.props.status === "partially_ordered") {
      this.props.status = "approved";
      this.refreshHeaderStatus();
    }
    this.touch();
    return line;
  }

  cancelLine(lineId: Ulid, reason: string): RequisitionLine {
    const line = this.line(lineId);
    if (line.status === "ordered") {
      throw InvalidStateError.transition("requisition line", "cancel", line.status);
    }
    if (line.orderedQuantity > 0) {
      throw new InvalidStateError(
        `Line ${line.lineNumber} already has ${line.orderedQuantity} on order; close the short quantity instead`,
        { lineNumber: line.lineNumber, orderedQuantity: line.orderedQuantity },
      );
    }
    line.status = "cancelled";
    line.cancellationReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionLineCancelled,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { requisitionId: this.id, lineNumber: line.lineNumber, reason: line.cancellationReason },
      }),
    );
    this.refreshHeaderStatus();
    return line;
  }

  /** Closes the residual demand of a partially ordered requisition. */
  close(reason: string): void {
    if (!["approved", "partially_ordered", "ordered"].includes(this.props.status)) {
      throw InvalidStateError.transition("requisition", "close", this.props.status, [
        "approved",
        "partially_ordered",
        "ordered",
      ]);
    }
    this.props.status = "closed";
    this.props.closedAt = nowIso();
    this.props.closeReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionClosed,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          requisitionId: this.id,
          requisitionNumber: this.props.requisitionNumber,
          reason: this.props.closeReason,
          orderedValue: this.orderedValue(),
        },
      }),
    );
  }

  cancel(reason: string): void {
    if (["closed", "cancelled", "ordered"].includes(this.props.status)) {
      throw InvalidStateError.transition("requisition", "cancel", this.props.status);
    }
    const onOrder = this.props.lines.some((line) => line.orderedQuantity > 0);
    if (onOrder) {
      throw new InvalidStateError(
        "Requisition already has quantity on order; close it instead of cancelling",
        { requisitionNumber: this.props.requisitionNumber },
      );
    }
    this.props.status = "cancelled";
    this.props.cancellationReason = requiredText(reason, "reason", 3, 500);
    this.props.closedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.RequisitionCancelled,
        aggregateType: "PurchaseRequisition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          requisitionId: this.id,
          requisitionNumber: this.props.requisitionNumber,
          reason: this.props.cancellationReason,
        },
      }),
    );
  }

  /** Estimated value already placed on purchase orders. */
  orderedValue(): Money {
    return sumMoney(
      this.props.lines.map((line) => extendPrice(line.estimatedUnitPrice, line.orderedQuantity)),
      this.props.currency,
    );
  }

  /** Estimated value still to be sourced. */
  openValue(): Money {
    return sumMoney(
      this.activeLines.map((line) => extendPrice(line.estimatedUnitPrice, line.remainingQuantity)),
      this.props.currency,
    );
  }

  toJSON(): PurchaseRequisitionView {
    return {
      ...super.toJSON(),
      estimatedTotal: this.estimatedTotal,
      orderedValue: this.orderedValue(),
      openValue: this.openValue(),
      categoryCodes: this.categoryCodes,
    };
  }

  // -- internals ------------------------------------------------------------

  private nextLineNumber(): number {
    return this.props.lines.reduce((max, line) => Math.max(max, line.lineNumber), 0) + 10;
  }

  private assertEditable(action: string): void {
    if (this.props.status !== "draft" && this.props.status !== "rejected") {
      throw InvalidStateError.transition("requisition", action, this.props.status, [
        "draft",
        "rejected",
      ]);
    }
  }

  private assertSourceable(): void {
    if (!["approved", "partially_ordered"].includes(this.props.status)) {
      throw InvalidStateError.transition("requisition", "source", this.props.status, [
        "approved",
        "partially_ordered",
      ]);
    }
  }

  private refreshHeaderStatus(): void {
    if (!["approved", "partially_ordered", "ordered"].includes(this.props.status)) return;
    const active = this.activeLines;
    if (active.length === 0) {
      this.props.status = "closed";
      this.props.closedAt = nowIso();
      return;
    }
    const allOrdered = active.every((line) => line.status === "ordered");
    const anyOrdered = active.some((line) => line.orderedQuantity > 0);
    const previous = this.props.status;
    this.props.status = allOrdered ? "ordered" : anyOrdered ? "partially_ordered" : "approved";
    if (this.props.status === "ordered" && previous !== "ordered") {
      this.raise(
        envelope({
          eventType: ProcurementEvents.RequisitionOrdered,
          aggregateType: "PurchaseRequisition",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            requisitionId: this.id,
            requisitionNumber: this.props.requisitionNumber,
            orderedValue: this.orderedValue(),
          },
        }),
      );
    }
  }
}

/** Convenience for callers that only have raw numbers (HTTP, fixtures). */
export function requisitionLineInput(input: {
  description: string;
  categoryCode: string;
  quantity: number;
  uom: string;
  unitPriceMinor: number;
  currency: string;
  neededBy?: IsoDate;
  itemCode?: string;
}): RequisitionLineInput {
  return {
    description: input.description,
    categoryCode: input.categoryCode,
    quantity: quantity(input.quantity),
    uom: input.uom,
    estimatedUnitPrice: money(input.unitPriceMinor, input.currency),
    neededBy: input.neededBy,
    itemCode: input.itemCode,
  };
}
