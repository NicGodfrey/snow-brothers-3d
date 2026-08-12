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
  newArInvoiceId,
  type AccountId,
  type ArInvoiceId,
  type CostCenterId,
  type IsoDate,
  type JournalId,
  type TaxCodeId,
} from "./ids.js";
import { FinanceEventTypes, type ArInvoiceIssuedPayload } from "./events.js";

export type ArInvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";

export interface ArInvoiceLine {
  readonly lineNo: number;
  readonly description: string;
  /** Quantity in thousandths to keep arithmetic integral (1500 = 1.5 units). */
  readonly quantityMilli: number;
  readonly unitPriceMinor: number;
  readonly revenueAccountId: AccountId;
  readonly costCenterId?: CostCenterId;
  readonly taxCodeId?: TaxCodeId;
  readonly taxRateBps: number;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
}

export interface ArInvoiceLineInput {
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  revenueAccountId: AccountId;
  costCenterId?: CostCenterId;
  taxCodeId?: TaxCodeId;
  /** Resolved by the service from the tax code; 0 when untaxed. */
  taxRateBps?: number;
}

export interface ArInvoiceProps {
  invoiceNo: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  issueDate: IsoDate;
  dueDate: IsoDate;
  status: ArInvoiceStatus;
  lines: ArInvoiceLine[];
  subtotalMinor: number;
  taxTotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  journalId?: JournalId;
  voidReason?: string;
}

export function computeLine(input: ArInvoiceLineInput, lineNo: number): Result<ArInvoiceLine> {
  if (input.description.trim().length === 0) return err(`line ${lineNo}: description is required`);
  if (!Number.isInteger(input.quantityMilli) || input.quantityMilli <= 0) {
    return err(`line ${lineNo}: quantityMilli must be a positive integer (1000 = 1 unit)`);
  }
  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
    return err(`line ${lineNo}: unitPriceMinor must be a non-negative integer`);
  }
  const rateBps = input.taxRateBps ?? 0;
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    return err(`line ${lineNo}: taxRateBps must be 0-10000`);
  }
  const subtotal = Math.round((input.quantityMilli * input.unitPriceMinor) / 1000);
  const tax = applyBps(subtotal, rateBps);
  return ok({
    lineNo,
    description: input.description.trim(),
    quantityMilli: input.quantityMilli,
    unitPriceMinor: input.unitPriceMinor,
    revenueAccountId: input.revenueAccountId,
    costCenterId: input.costCenterId,
    taxCodeId: input.taxCodeId,
    taxRateBps: rateBps,
    subtotalMinor: subtotal,
    taxMinor: tax,
    totalMinor: subtotal + tax,
  });
}

export class ArInvoice extends AggregateRoot<ArInvoiceProps> {
  private constructor(tenantId: TenantId, props: ArInvoiceProps, id?: ArInvoiceId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static create(tenantId: TenantId, input: {
    invoiceNo: string;
    customerId: string;
    customerName: string;
    currency: CurrencyCode;
    issueDate: string;
    dueDate: string;
    lines: ArInvoiceLineInput[];
  }): Result<ArInvoice> {
    if (input.customerId.trim().length === 0) return err("customerId is required");
    if (!isIsoDate(input.issueDate) || !isIsoDate(input.dueDate)) {
      return err("issueDate and dueDate must be ISO dates (yyyy-mm-dd)");
    }
    if (input.dueDate < input.issueDate) return err("dueDate cannot precede issueDate");
    if (input.lines.length === 0) return err("an invoice requires at least one line");

    const lines: ArInvoiceLine[] = [];
    for (let i = 0; i < input.lines.length; i++) {
      const line = computeLine(input.lines[i], i + 1);
      if (!line.ok) return line;
      lines.push(line.value);
    }
    const subtotal = lines.reduce((s, l) => s + l.subtotalMinor, 0);
    const tax = lines.reduce((s, l) => s + l.taxMinor, 0);
    if (subtotal + tax <= 0) return err("invoice total must be positive");

    return ok(new ArInvoice(tenantId, {
      invoiceNo: input.invoiceNo,
      customerId: input.customerId.trim(),
      customerName: input.customerName.trim(),
      currency: input.currency,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: "DRAFT",
      lines,
      subtotalMinor: subtotal,
      taxTotalMinor: tax,
      totalMinor: subtotal + tax,
      paidMinor: 0,
    }, newArInvoiceId()));
  }

  get invoiceNo(): string { return this.props.invoiceNo; }
  get customerId(): string { return this.props.customerId; }
  get currency(): CurrencyCode { return this.props.currency; }
  get issueDate(): IsoDate { return this.props.issueDate; }
  get dueDate(): IsoDate { return this.props.dueDate; }
  get status(): ArInvoiceStatus { return this.props.status; }
  get lines(): readonly ArInvoiceLine[] { return this.props.lines; }
  get subtotalMinor(): number { return this.props.subtotalMinor; }
  get taxTotalMinor(): number { return this.props.taxTotalMinor; }
  get totalMinor(): number { return this.props.totalMinor; }
  get paidMinor(): number { return this.props.paidMinor; }
  get journalId(): JournalId | undefined { return this.props.journalId; }

  balanceMinor(): number {
    return this.props.totalMinor - this.props.paidMinor;
  }

  /** Issuing locks the invoice and links the GL journal that recognized it. */
  issue(journalId: JournalId): Result<void> {
    if (this.props.status !== "DRAFT") {
      return err(`invoice ${this.props.invoiceNo} is ${this.props.status}, only DRAFT can be issued`);
    }
    this.props = { ...this.props, status: "ISSUED", journalId };
    const payload: ArInvoiceIssuedPayload = {
      invoiceId: this.id,
      invoiceNo: this.props.invoiceNo,
      customerId: this.props.customerId,
      currency: this.props.currency,
      totalMinor: this.props.totalMinor,
      journalId,
    };
    this.raise(envelope({
      eventType: FinanceEventTypes.ArInvoiceIssued,
      aggregateType: "ArInvoice",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload,
    }));
    return ok(undefined);
  }

  applyPayment(amountMinor: number): Result<void> {
    if (this.props.status !== "ISSUED" && this.props.status !== "PARTIALLY_PAID") {
      return err(`invoice ${this.props.invoiceNo} is ${this.props.status} and cannot take payments`);
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return err("payment application amount must be a positive integer");
    }
    if (amountMinor > this.balanceMinor()) {
      return err(
        `application ${amountMinor} exceeds open balance ${this.balanceMinor()} on ${this.props.invoiceNo}`,
      );
    }
    const paid = this.props.paidMinor + amountMinor;
    const status: ArInvoiceStatus = paid === this.props.totalMinor ? "PAID" : "PARTIALLY_PAID";
    this.props = { ...this.props, paidMinor: paid, status };
    if (status === "PAID") {
      this.raise(envelope({
        eventType: FinanceEventTypes.ArInvoicePaid,
        aggregateType: "ArInvoice",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { invoiceId: this.id, invoiceNo: this.props.invoiceNo, totalMinor: this.props.totalMinor },
      }));
    } else {
      this.touch();
    }
    return ok(undefined);
  }

  voidInvoice(reason: string): Result<void> {
    if (this.props.status !== "DRAFT" && this.props.status !== "ISSUED") {
      return err(`invoice ${this.props.invoiceNo} is ${this.props.status} and cannot be voided`);
    }
    if (this.props.paidMinor > 0) {
      return err(`invoice ${this.props.invoiceNo} has payments applied; unapply before voiding`);
    }
    if (reason.trim().length === 0) return err("a void reason is required");
    this.props = { ...this.props, status: "VOID", voidReason: reason.trim() };
    this.raise(envelope({
      eventType: FinanceEventTypes.ArInvoiceVoided,
      aggregateType: "ArInvoice",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: { invoiceId: this.id, invoiceNo: this.props.invoiceNo, reason: reason.trim() },
    }));
    return ok(undefined);
  }
}
