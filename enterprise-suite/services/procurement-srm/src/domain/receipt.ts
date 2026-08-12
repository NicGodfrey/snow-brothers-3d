import {
  AggregateRoot,
  envelope,
  newId,
  nowIso,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  addQty,
  positiveQuantity,
  qtyAtLeast,
  qtyEquals,
  quantity,
  requiredText,
  subQty,
  sumQty,
  uom,
  ZERO_QTY,
  type IsoDate,
  type Quantity,
  type UomCode,
} from "./common.js";
import { InvalidStateError, invariant, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type ReceiptStatus = "draft" | "posted" | "reversed";

export const RECEIPT_STATUSES: readonly ReceiptStatus[] = ["draft", "posted", "reversed"];

export type InspectionStatus = "not_required" | "pending" | "passed" | "failed" | "partial";

export interface ReceiptLineInput {
  purchaseOrderLineNumber: number;
  receivedQuantity: number;
  uom: string;
  purchaseOrderLineId?: Ulid;
  itemCode?: string;
  description?: string;
  /** Omitted means "accept everything received" until inspection says otherwise. */
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  rejectionReason?: string;
  inspectionRequired?: boolean;
  storageLocation?: string;
  lotNumber?: string;
  serialNumbers?: readonly string[];
  expiryDate?: IsoDate;
}

export interface ReturnToVendorRecord {
  readonly id: Ulid;
  readonly quantity: Quantity;
  readonly reason: string;
  readonly recordedAt: IsoDateTime;
  readonly rmaReference?: string;
}

/**
 * One physical line of a delivery. `received = accepted + rejected` at all
 * times; inspection moves quantity from accepted to rejected rather than
 * changing what actually turned up on the dock.
 */
export class ReceiptLine {
  readonly id: Ulid;
  readonly lineNumber: number;
  readonly purchaseOrderLineNumber: number;
  purchaseOrderLineId?: Ulid;
  itemCode?: string;
  description?: string;
  receivedQuantity: Quantity;
  acceptedQuantity: Quantity;
  rejectedQuantity: Quantity;
  uom: UomCode;
  rejectionReason?: string;
  inspectionStatus: InspectionStatus;
  storageLocation?: string;
  lotNumber?: string;
  serialNumbers?: string[];
  expiryDate?: IsoDate;
  returns: ReturnToVendorRecord[];

  constructor(lineNumber: number, input: ReceiptLineInput) {
    invariant(
      Number.isInteger(input.purchaseOrderLineNumber) && input.purchaseOrderLineNumber > 0,
      "purchaseOrderLineNumber",
      "must be a positive integer",
    );
    this.id = newId("grnline");
    this.lineNumber = lineNumber;
    this.purchaseOrderLineNumber = input.purchaseOrderLineNumber;
    this.purchaseOrderLineId = input.purchaseOrderLineId;
    this.itemCode = input.itemCode;
    this.description = input.description;
    this.receivedQuantity = positiveQuantity(input.receivedQuantity, "receivedQuantity");
    this.uom = uom(input.uom);
    const rejected = quantity(input.rejectedQuantity ?? 0);
    const accepted =
      input.acceptedQuantity === undefined
        ? subQty(this.receivedQuantity, rejected)
        : quantity(input.acceptedQuantity);
    if (!qtyEquals(addQty(accepted, rejected), this.receivedQuantity)) {
      throw ValidationError.single(
        "acceptedQuantity",
        `accepted (${accepted}) + rejected (${rejected}) must equal received (${this.receivedQuantity})`,
      );
    }
    this.acceptedQuantity = accepted;
    this.rejectedQuantity = rejected;
    this.rejectionReason = input.rejectionReason;
    if (rejected > 0 && !input.rejectionReason) {
      throw ValidationError.single("rejectionReason", "is required when quantity is rejected");
    }
    this.inspectionStatus = input.inspectionRequired ? "pending" : "not_required";
    this.storageLocation = input.storageLocation;
    this.lotNumber = input.lotNumber;
    this.serialNumbers = input.serialNumbers ? [...input.serialNumbers] : undefined;
    this.expiryDate = input.expiryDate;
    this.returns = [];
  }

  get returnedQuantity(): Quantity {
    return sumQty(this.returns.map((entry) => entry.quantity));
  }

  /** Accepted quantity net of anything sent back to the supplier. */
  get netAcceptedQuantity(): Quantity {
    return subQty(this.acceptedQuantity, this.returnedQuantity);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      lineNumber: this.lineNumber,
      purchaseOrderLineNumber: this.purchaseOrderLineNumber,
      purchaseOrderLineId: this.purchaseOrderLineId,
      itemCode: this.itemCode,
      description: this.description,
      receivedQuantity: this.receivedQuantity,
      acceptedQuantity: this.acceptedQuantity,
      rejectedQuantity: this.rejectedQuantity,
      returnedQuantity: this.returnedQuantity,
      netAcceptedQuantity: this.netAcceptedQuantity,
      uom: this.uom,
      rejectionReason: this.rejectionReason,
      inspectionStatus: this.inspectionStatus,
      storageLocation: this.storageLocation,
      lotNumber: this.lotNumber,
      serialNumbers: this.serialNumbers ? [...this.serialNumbers] : undefined,
      expiryDate: this.expiryDate,
      returns: this.returns.map((entry) => ({ ...entry })),
    };
  }
}

export interface GoodsReceiptProps {
  receiptNumber: string;
  purchaseOrderId: Ulid;
  orderNumber: string;
  supplierId: Ulid;
  receivedBy: Ulid;
  receiptDate: IsoDate;
  status: ReceiptStatus;
  lines: ReceiptLine[];
  deliveryNoteReference?: string;
  carrier?: string;
  waybillNumber?: string;
  notes?: string;
  postedAt?: IsoDateTime;
  reversedAt?: IsoDateTime;
  reversalReason?: string;
}

export type GoodsReceiptView = EntityProps &
  GoodsReceiptProps & {
    totalReceived: Quantity;
    totalAccepted: Quantity;
    totalRejected: Quantity;
    inspectionOutstanding: boolean;
  };

/**
 * Goods receipt note (GRN).
 *
 *   draft → posted → reversed
 *
 * Posting is the point at which quantities hit the purchase order and the
 * inventory context; nothing before that is visible outside procurement.
 */
export class GoodsReceipt extends AggregateRoot<GoodsReceiptProps> {
  private constructor(tenantId: TenantId, props: GoodsReceiptProps) {
    super(tenantId, props);
  }

  static draft(
    tenantId: TenantId,
    input: {
      receiptNumber: string;
      purchaseOrderId: Ulid;
      orderNumber: string;
      supplierId: Ulid;
      receivedBy: Ulid;
      receiptDate: IsoDate;
      deliveryNoteReference?: string;
      carrier?: string;
      waybillNumber?: string;
      notes?: string;
      lines?: readonly ReceiptLineInput[];
    },
  ): GoodsReceipt {
    const receipt = new GoodsReceipt(tenantId, {
      receiptNumber: input.receiptNumber,
      purchaseOrderId: input.purchaseOrderId,
      orderNumber: input.orderNumber,
      supplierId: input.supplierId,
      receivedBy: input.receivedBy,
      receiptDate: input.receiptDate,
      status: "draft",
      lines: [],
      deliveryNoteReference: input.deliveryNoteReference,
      carrier: input.carrier,
      waybillNumber: input.waybillNumber,
      notes: input.notes,
    });
    for (const line of input.lines ?? []) receipt.addLine(line);
    receipt.raise(
      envelope({
        eventType: ProcurementEvents.ReceiptDrafted,
        aggregateType: "GoodsReceipt",
        aggregateId: receipt.id,
        tenantId,
        payload: {
          receiptId: receipt.id,
          receiptNumber: receipt.props.receiptNumber,
          purchaseOrderId: input.purchaseOrderId,
          supplierId: input.supplierId,
          receiptDate: input.receiptDate,
        },
      }),
    );
    return receipt;
  }

  get receiptNumber(): string {
    return this.props.receiptNumber;
  }
  get purchaseOrderId(): Ulid {
    return this.props.purchaseOrderId;
  }
  get orderNumber(): string {
    return this.props.orderNumber;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get receivedBy(): Ulid {
    return this.props.receivedBy;
  }
  get receiptDate(): IsoDate {
    return this.props.receiptDate;
  }
  get status(): ReceiptStatus {
    return this.props.status;
  }
  get lines(): readonly ReceiptLine[] {
    return this.props.lines;
  }
  get deliveryNoteReference(): string | undefined {
    return this.props.deliveryNoteReference;
  }

  get totalReceived(): Quantity {
    return sumQty(this.props.lines.map((line) => line.receivedQuantity));
  }

  get totalAccepted(): Quantity {
    return sumQty(this.props.lines.map((line) => line.acceptedQuantity));
  }

  get totalRejected(): Quantity {
    return sumQty(this.props.lines.map((line) => line.rejectedQuantity));
  }

  get inspectionOutstanding(): boolean {
    return this.props.lines.some((line) => line.inspectionStatus === "pending");
  }

  line(lineId: Ulid): ReceiptLine {
    const found = this.props.lines.find((line) => line.id === lineId);
    if (!found) throw ValidationError.single("lineId", `is not a line of ${this.props.receiptNumber}`);
    return found;
  }

  lineForOrderLine(purchaseOrderLineNumber: number): ReceiptLine | undefined {
    return this.props.lines.find((line) => line.purchaseOrderLineNumber === purchaseOrderLineNumber);
  }

  addLine(input: ReceiptLineInput): ReceiptLine {
    this.assertStatus("add a line to", ["draft"]);
    if (this.lineForOrderLine(input.purchaseOrderLineNumber)) {
      throw ValidationError.single(
        "purchaseOrderLineNumber",
        `line ${input.purchaseOrderLineNumber} is already on receipt ${this.props.receiptNumber}`,
      );
    }
    const line = new ReceiptLine(this.props.lines.length + 1, input);
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  removeLine(lineId: Ulid): void {
    this.assertStatus("remove a line from", ["draft"]);
    const index = this.props.lines.findIndex((line) => line.id === lineId);
    if (index < 0) throw ValidationError.single("lineId", `is not a line of ${this.props.receiptNumber}`);
    this.props.lines.splice(index, 1);
    this.touch();
  }

  /**
   * Records a QC outcome. Rejecting quantity after posting is handled by
   * `returnToVendor`; before posting the split simply moves between the
   * accepted and rejected buckets.
   */
  recordInspection(input: {
    lineId: Ulid;
    outcome: "passed" | "failed" | "partial";
    rejectedQuantity?: number;
    reason?: string;
    inspectorId?: Ulid;
  }): ReceiptLine {
    this.assertStatus("inspect", ["draft"]);
    const line = this.line(input.lineId);
    if (line.inspectionStatus === "not_required") {
      throw new InvalidStateError(
        `Line ${line.lineNumber} of ${this.props.receiptNumber} was not flagged for inspection`,
      );
    }
    const rejected =
      input.outcome === "passed"
        ? ZERO_QTY
        : input.outcome === "failed"
          ? line.receivedQuantity
          : positiveQuantity(input.rejectedQuantity ?? 0, "rejectedQuantity");
    if (!qtyAtLeast(line.receivedQuantity, rejected)) {
      throw ValidationError.single(
        "rejectedQuantity",
        `cannot reject ${rejected} of the ${line.receivedQuantity} received`,
      );
    }
    if (rejected > 0 && !input.reason) {
      throw ValidationError.single("reason", "is required when quantity fails inspection");
    }
    line.rejectedQuantity = rejected;
    line.acceptedQuantity = subQty(line.receivedQuantity, rejected);
    line.rejectionReason = rejected > 0 ? requiredText(input.reason ?? "", "reason", 3, 500) : undefined;
    line.inspectionStatus = input.outcome;
    this.raise(
      envelope({
        eventType: ProcurementEvents.ReceiptInspected,
        aggregateType: "GoodsReceipt",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          receiptId: this.id,
          receiptNumber: this.props.receiptNumber,
          lineNumber: line.lineNumber,
          purchaseOrderLineNumber: line.purchaseOrderLineNumber,
          outcome: input.outcome,
          acceptedQuantity: line.acceptedQuantity,
          rejectedQuantity: line.rejectedQuantity,
          inspectorId: input.inspectorId,
          reason: line.rejectionReason,
        },
      }),
    );
    return line;
  }

  post(): void {
    this.assertStatus("post", ["draft"]);
    if (this.props.lines.length === 0) {
      throw ValidationError.single("lines", "a receipt needs at least one line before posting");
    }
    if (this.inspectionOutstanding) {
      throw new InvalidStateError(
        `Receipt ${this.props.receiptNumber} has lines awaiting inspection`,
        {
          pendingLines: this.props.lines
            .filter((line) => line.inspectionStatus === "pending")
            .map((line) => line.lineNumber),
        },
      );
    }
    this.props.status = "posted";
    this.props.postedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.ReceiptPosted,
        aggregateType: "GoodsReceipt",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          receiptId: this.id,
          receiptNumber: this.props.receiptNumber,
          purchaseOrderId: this.props.purchaseOrderId,
          orderNumber: this.props.orderNumber,
          supplierId: this.props.supplierId,
          receiptDate: this.props.receiptDate,
          lines: this.props.lines.map((line) => ({
            purchaseOrderLineNumber: line.purchaseOrderLineNumber,
            itemCode: line.itemCode,
            receivedQuantity: line.receivedQuantity,
            acceptedQuantity: line.acceptedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            uom: line.uom,
            storageLocation: line.storageLocation,
            lotNumber: line.lotNumber,
          })),
        },
      }),
    );
  }

  reverse(reason: string): void {
    this.assertStatus("reverse", ["posted"]);
    if (this.props.lines.some((line) => line.returns.length > 0)) {
      throw new InvalidStateError(
        `Receipt ${this.props.receiptNumber} has return-to-vendor records; reverse those first`,
      );
    }
    this.props.status = "reversed";
    this.props.reversedAt = nowIso();
    this.props.reversalReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.ReceiptReversed,
        aggregateType: "GoodsReceipt",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          receiptId: this.id,
          receiptNumber: this.props.receiptNumber,
          purchaseOrderId: this.props.purchaseOrderId,
          supplierId: this.props.supplierId,
          reason: this.props.reversalReason,
          lines: this.props.lines.map((line) => ({
            purchaseOrderLineNumber: line.purchaseOrderLineNumber,
            receivedQuantity: line.receivedQuantity,
            acceptedQuantity: line.acceptedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            uom: line.uom,
          })),
        },
      }),
    );
  }

  /** Sends accepted stock back after posting (damage found later, wrong item). */
  returnToVendor(input: {
    lineId: Ulid;
    quantity: number;
    reason: string;
    rmaReference?: string;
  }): ReturnToVendorRecord {
    this.assertStatus("return from", ["posted"]);
    const line = this.line(input.lineId);
    const qty = positiveQuantity(input.quantity, "quantity");
    if (!qtyAtLeast(line.netAcceptedQuantity, qty)) {
      throw ValidationError.single(
        "quantity",
        `cannot return ${qty}; only ${line.netAcceptedQuantity} of line ${line.lineNumber} remains accepted`,
      );
    }
    const record: ReturnToVendorRecord = {
      id: newId("rtv"),
      quantity: qty,
      reason: requiredText(input.reason, "reason", 3, 500),
      recordedAt: nowIso(),
      rmaReference: input.rmaReference,
    };
    line.returns.push(record);
    this.raise(
      envelope({
        eventType: ProcurementEvents.ReceiptReturnedToVendor,
        aggregateType: "GoodsReceipt",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          receiptId: this.id,
          receiptNumber: this.props.receiptNumber,
          purchaseOrderId: this.props.purchaseOrderId,
          supplierId: this.props.supplierId,
          purchaseOrderLineNumber: line.purchaseOrderLineNumber,
          quantity: qty,
          uom: line.uom,
          reason: record.reason,
          rmaReference: record.rmaReference,
        },
      }),
    );
    return record;
  }

  toJSON(): GoodsReceiptView {
    return {
      ...super.toJSON(),
      totalReceived: this.totalReceived,
      totalAccepted: this.totalAccepted,
      totalRejected: this.totalRejected,
      inspectionOutstanding: this.inspectionOutstanding,
    };
  }

  private assertStatus(action: string, expected: readonly ReceiptStatus[]): void {
    if (!expected.includes(this.props.status)) {
      throw InvalidStateError.transition("goods receipt", action, this.props.status, expected);
    }
  }
}
