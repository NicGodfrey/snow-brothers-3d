import {
  AggregateRoot,
  envelope,
  err,
  ok,
  type CurrencyCode,
  type Result,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import {
  applyBps,
  isIsoDate,
  newApBillId,
  type AccountId,
  type ApBillId,
  type CostCenterId,
  type IsoDate,
  type JournalId,
  type TaxCodeId,
} from "./ids.js";
import { FinanceEventTypes, type ApBillApprovedPayload } from "./events.js";

export type ApBillStatus = "DRAFT" | "APPROVED" | "PARTIALLY_PAID" | "PAID" | "VOID";

export interface ApBillLine {
  readonly lineNo: number;
  readonly description: string;
  readonly quantityMilli: number;
  readonly unitCostMinor: number;
  readonly expenseAccountId: AccountId;
  readonly costCenterId?: CostCenterId;
  readonly taxCodeId?: TaxCodeId;
  readonly taxRateBps: number;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
}

export interface ApBillLineInput {
  description: string;
  quantityMilli: number;
  unitCostMinor: number;
  expenseAccountId: AccountId;
  costCenterId?: CostCenterId;
  taxCodeId?: TaxCodeId;
  taxRateBps?: number;
}

export interface ApBillProps {
  billNo: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceRef?: string;
  currency: CurrencyCode;
  billDate: IsoDate;
  dueDate: IsoDate;
  status: ApBillStatus;
  lines: ApBillLine[];
  subtotalMinor: number;
  taxTotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  journalId?: JournalId;
  voidReason?: string;
}

function computeBillLine(input: ApBillLineInput, lineNo: number): Result<ApBillLine> {
  if (input.description.trim().length === 0) return err(`line ${lineNo}: description is required`);
  if (!Number.isInteger(input.quantityMilli) || input.quantityMilli <= 0) {
    return err(`line ${lineNo}: quantityMilli must be a positive integer (1000 = 1 unit)`);
  }
  if (!Number.isInteger(input.unitCostMinor) || input.unitCostMinor < 0) {
    return err(`line ${lineNo}: unitCostMinor must be a non-negative integer`);
  }
  const rateBps = input.taxRateBps ?? 0;
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    return err(`line ${lineNo}: taxRateBps must be 0-10000`);
  }
  const subtotal = Math.round((input.quantityMilli * input.unitCostMinor) / 1000);
  const tax = applyBps(subtotal, rateBps);
  return ok({
    lineNo,
    description: input.description.trim(),
    quantityMilli: input.quantityMilli,
    unitCostMinor: input.unitCostMinor,
    expenseAccountId: input.expenseAccountId,
    costCenterId: input.costCenterId,
    taxCodeId: input.taxCodeId,
    taxRateBps: rateBps,
    subtotalMinor: subtotal,
    taxMinor: tax,
    totalMinor: subtotal + tax,
  });
}

export class ApBill extends AggregateRoot<ApBillProps> {
  private constructor(tenantId: TenantId, props: ApBillProps, id?: ApBillId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static create(tenantId: TenantId, input: {
    billNo: string;
    supplierId: string;
    supplierName: string;
    supplierInvoiceRef?: string;
    currency: CurrencyCode;
    billDate: string;
    dueDate: string;
    lines: ApBillLineInput[];
  }): Result<ApBill> {
    if (input.supplierId.trim().length === 0) return err("supplierId is required");
    if (!isIsoDate(input.billDate) || !isIsoDate(input.dueDate)) {
      return err("billDate and dueDate must be ISO dates (yyyy-mm-dd)");
    }
    if (input.dueDate < input.billDate) return err("dueDate cannot precede billDate");
    if (input.lines.length === 0) return err("a bill requires at least one line");

    const lines: ApBillLine[] = [];
    for (let i = 0; i < input.lines.length; i++) {
      const line = computeBillLine(input.lines[i], i + 1);
      if (!line.ok) return line;
      lines.push(line.value);
    }
    const subtotal = lines.reduce((s, l) => s + l.subtotalMinor, 0);
    const tax = lines.reduce((s, l) => s + l.taxMinor, 0);
    if (subtotal + tax <= 0) return err("bill total must be positive");

    return ok(new ApBill(tenantId, {
      billNo: input.billNo,
      supplierId: input.supplierId.trim(),
      supplierName: input.supplierName.trim(),
      supplierInvoiceRef: input.supplierInvoiceRef,
      currency: input.currency,
      billDate: input.billDate,
      dueDate: input.dueDate,
      status: "DRAFT",
      lines,
      subtotalMinor: subtotal,
      taxTotalMinor: tax,
      totalMinor: subtotal + tax,
      paidMinor: 0,
    }, newApBillId()));
  }

  get billNo(): string { return this.props.billNo; }
  get supplierId(): string { return this.props.supplierId; }
  get currency(): CurrencyCode { return this.props.currency; }
  get billDate(): IsoDate { return this.props.billDate; }
  get dueDate(): IsoDate { return this.props.dueDate; }
  get status(): ApBillStatus { return this.props.status; }
  get lines(): readonly ApBillLine[] { return this.props.lines; }
  get subtotalMinor(): number { return this.props.subtotalMinor; }
  get taxTotalMinor(): number { return this.props.taxTotalMinor; }
  get totalMinor(): number { return this.props.totalMinor; }
  get paidMinor(): number { return this.props.paidMinor; }
  get journalId(): JournalId | undefined { return this.props.journalId; }

  balanceMinor(): number {
    return this.props.totalMinor - this.props.paidMinor;
  }

  /** Approval recognizes the liability in the GL and locks the bill. */
  approve(journalId: JournalId): Result<void> {
    if (this.props.status !== "DRAFT") {
      return err(`bill ${this.props.billNo} is ${this.props.status}, only DRAFT can be approved`);
    }
    this.props = { ...this.props, status: "APPROVED", journalId };
    const payload: ApBillApprovedPayload = {
      billId: this.id,
      billNo: this.props.billNo,
      supplierId: this.props.supplierId,
      currency: this.props.currency,
      totalMinor: this.props.totalMinor,
      journalId,
    };
    this.raise(envelope({
      eventType: FinanceEventTypes.ApBillApproved,
      aggregateType: "ApBill",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload,
    }));
    return ok(undefined);
  }

  applyPayment(amountMinor: number): Result<void> {
    if (this.props.status !== "APPROVED" && this.props.status !== "PARTIALLY_PAID") {
      return err(`bill ${this.props.billNo} is ${this.props.status} and cannot take payments`);
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return err("payment application amount must be a positive integer");
    }
    if (amountMinor > this.balanceMinor()) {
      return err(
        `application ${amountMinor} exceeds open balance ${this.balanceMinor()} on ${this.props.billNo}`,
      );
    }
    const paid = this.props.paidMinor + amountMinor;
    const status: ApBillStatus = paid === this.props.totalMinor ? "PAID" : "PARTIALLY_PAID";
    this.props = { ...this.props, paidMinor: paid, status };
    if (status === "PAID") {
      this.raise(envelope({
        eventType: FinanceEventTypes.ApBillPaid,
        aggregateType: "ApBill",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { billId: this.id, billNo: this.props.billNo, totalMinor: this.props.totalMinor },
      }));
    } else {
      this.touch();
    }
    return ok(undefined);
  }

  voidBill(reason: string): Result<void> {
    if (this.props.status !== "DRAFT" && this.props.status !== "APPROVED") {
      return err(`bill ${this.props.billNo} is ${this.props.status} and cannot be voided`);
    }
    if (this.props.paidMinor > 0) {
      return err(`bill ${this.props.billNo} has payments applied; unapply before voiding`);
    }
    if (reason.trim().length === 0) return err("a void reason is required");
    this.props = { ...this.props, status: "VOID", voidReason: reason.trim() };
    this.raise(envelope({
      eventType: FinanceEventTypes.ApBillVoided,
      aggregateType: "ApBill",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: { billId: this.id, billNo: this.props.billNo, reason: reason.trim() },
    }));
    return ok(undefined);
  }
}
