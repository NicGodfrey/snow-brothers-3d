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
  applyBps,
  bps,
  compareDates,
  currencyCode,
  extendPrice,
  incoterm,
  paymentTermsDays as validPaymentTerms,
  positiveQuantity,
  requiredText,
  subMoney,
  sumMoney,
  uom,
  zeroMoney,
  ZERO_BPS,
  type Bps,
  type Incoterm,
  type IsoDate,
  type Quantity,
  type UomCode,
} from "./common.js";
import { InvalidStateError, invariant, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type QuoteStatus =
  | "draft"
  | "submitted"
  | "shortlisted"
  | "rejected"
  | "accepted"
  | "withdrawn"
  | "expired";

export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "draft",
  "submitted",
  "shortlisted",
  "rejected",
  "accepted",
  "withdrawn",
  "expired",
];

export interface QuoteLineInput {
  /** The RFQ line this bid answers. */
  rfqLineNumber: number;
  unitPrice: Money;
  quantity: number;
  uom: string;
  leadTimeDays: number;
  discountBps?: number;
  taxBps?: number;
  minimumOrderQuantity?: number;
  alternativeItemCode?: string;
  notes?: string;
}

/**
 * One bid line. Net price is unit price less line discount; tax is computed on
 * the net so that comparisons and the eventual purchase order agree to the
 * minor unit.
 */
export class QuoteLine {
  readonly id: Ulid;
  readonly rfqLineNumber: number;
  unitPrice: Money;
  quantity: Quantity;
  uom: UomCode;
  leadTimeDays: number;
  discountBps: Bps;
  taxBps: Bps;
  minimumOrderQuantity?: Quantity;
  alternativeItemCode?: string;
  notes?: string;

  constructor(input: QuoteLineInput) {
    invariant(
      Number.isInteger(input.rfqLineNumber) && input.rfqLineNumber > 0,
      "rfqLineNumber",
      "must be a positive integer",
    );
    invariant(
      Number.isInteger(input.leadTimeDays) && input.leadTimeDays >= 0 && input.leadTimeDays <= 730,
      "leadTimeDays",
      "must be an integer within [0, 730]",
    );
    invariant(input.unitPrice.amountMinor >= 0, "unitPrice", "must not be negative");
    this.id = newId("qline");
    this.rfqLineNumber = input.rfqLineNumber;
    this.unitPrice = input.unitPrice;
    this.quantity = positiveQuantity(input.quantity, "quantity");
    this.uom = uom(input.uom);
    this.leadTimeDays = input.leadTimeDays;
    this.discountBps = input.discountBps === undefined ? ZERO_BPS : bps(input.discountBps, "discountBps");
    this.taxBps = input.taxBps === undefined ? ZERO_BPS : bps(input.taxBps, "taxBps");
    if (this.discountBps > 10_000) {
      throw ValidationError.single("discountBps", "cannot exceed 10000 basis points (100%)");
    }
    this.minimumOrderQuantity =
      input.minimumOrderQuantity === undefined
        ? undefined
        : positiveQuantity(input.minimumOrderQuantity, "minimumOrderQuantity");
    this.alternativeItemCode = input.alternativeItemCode;
    this.notes = input.notes;
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
    return money(this.netAmount.amountMinor + this.taxAmount.amountMinor, this.unitPrice.currency);
  }

  /** Discounted price per unit — the figure that lands on a purchase order. */
  get netUnitPrice(): Money {
    return money(
      Math.round(this.unitPrice.amountMinor * (1 - this.discountBps / 10_000)),
      this.unitPrice.currency,
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      rfqLineNumber: this.rfqLineNumber,
      unitPrice: this.unitPrice,
      netUnitPrice: this.netUnitPrice,
      quantity: this.quantity,
      uom: this.uom,
      leadTimeDays: this.leadTimeDays,
      discountBps: this.discountBps,
      taxBps: this.taxBps,
      minimumOrderQuantity: this.minimumOrderQuantity,
      alternativeItemCode: this.alternativeItemCode,
      notes: this.notes,
      grossAmount: this.grossAmount,
      discountAmount: this.discountAmount,
      netAmount: this.netAmount,
      taxAmount: this.taxAmount,
      totalAmount: this.totalAmount,
    };
  }
}

export interface SupplierQuoteProps {
  quoteNumber: string;
  rfqId: Ulid;
  supplierId: Ulid;
  currency: string;
  status: QuoteStatus;
  validUntil: IsoDate;
  incoterm: Incoterm;
  paymentTermsDays: number;
  lines: QuoteLine[];
  revision: number;
  supplierReference?: string;
  freightCharge?: Money;
  notes?: string;
  submittedAt?: IsoDateTime;
  withdrawnReason?: string;
  rejectionReason?: string;
  decidedAt?: IsoDateTime;
}

export type SupplierQuoteView = EntityProps &
  SupplierQuoteProps & {
    netTotal: Money;
    taxTotal: Money;
    grandTotal: Money;
    maxLeadTimeDays: number;
  };

/**
 * A supplier's response to an RFQ.
 *
 *   draft → submitted → shortlisted → accepted
 *                    ↘ rejected / withdrawn / expired
 *
 * Revisions are allowed while the RFQ is still open: `revise` returns the
 * quote to draft, bumps the revision and requires a fresh submit.
 */
export class SupplierQuote extends AggregateRoot<SupplierQuoteProps> {
  private constructor(tenantId: TenantId, props: SupplierQuoteProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      quoteNumber: string;
      rfqId: Ulid;
      supplierId: Ulid;
      currency: string;
      validUntil: IsoDate;
      incoterm?: string;
      paymentTermsDays?: number;
      supplierReference?: string;
      freightCharge?: Money;
      notes?: string;
      lines?: readonly QuoteLineInput[];
    },
  ): SupplierQuote {
    const currency = currencyCode(input.currency);
    if (input.freightCharge && input.freightCharge.currency !== currency) {
      throw ValidationError.single("freightCharge", `must be in the quote currency ${currency}`);
    }
    const quote = new SupplierQuote(tenantId, {
      quoteNumber: input.quoteNumber,
      rfqId: input.rfqId,
      supplierId: input.supplierId,
      currency,
      status: "draft",
      validUntil: input.validUntil,
      incoterm: incoterm(input.incoterm ?? "DAP"),
      paymentTermsDays: validPaymentTerms(input.paymentTermsDays ?? 30),
      lines: [],
      revision: 1,
      supplierReference: input.supplierReference,
      freightCharge: input.freightCharge,
      notes: input.notes,
    });
    for (const line of input.lines ?? []) quote.addLine(line);
    return quote;
  }

  get quoteNumber(): string {
    return this.props.quoteNumber;
  }
  get rfqId(): Ulid {
    return this.props.rfqId;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get currency(): string {
    return this.props.currency;
  }
  get status(): QuoteStatus {
    return this.props.status;
  }
  get validUntil(): IsoDate {
    return this.props.validUntil;
  }
  get incoterm(): Incoterm {
    return this.props.incoterm;
  }
  get paymentTermsDays(): number {
    return this.props.paymentTermsDays;
  }
  get lines(): readonly QuoteLine[] {
    return this.props.lines;
  }
  get revision(): number {
    return this.props.revision;
  }
  get freightCharge(): Money | undefined {
    return this.props.freightCharge;
  }
  get rejectionReason(): string | undefined {
    return this.props.rejectionReason;
  }

  get netTotal(): Money {
    const lines = sumMoney(
      this.props.lines.map((line) => line.netAmount),
      this.props.currency,
    );
    const freight = this.props.freightCharge ?? zeroMoney(this.props.currency);
    return money(lines.amountMinor + freight.amountMinor, this.props.currency);
  }

  get taxTotal(): Money {
    return sumMoney(
      this.props.lines.map((line) => line.taxAmount),
      this.props.currency,
    );
  }

  get grandTotal(): Money {
    return money(this.netTotal.amountMinor + this.taxTotal.amountMinor, this.props.currency);
  }

  /** The slowest line drives the delivery promise used for scoring. */
  get maxLeadTimeDays(): number {
    return this.props.lines.reduce((max, line) => Math.max(max, line.leadTimeDays), 0);
  }

  get quotedLineNumbers(): readonly number[] {
    return this.props.lines.map((line) => line.rfqLineNumber).sort((a, b) => a - b);
  }

  line(rfqLineNumber: number): QuoteLine | undefined {
    return this.props.lines.find((line) => line.rfqLineNumber === rfqLineNumber);
  }

  requireLine(rfqLineNumber: number): QuoteLine {
    const line = this.line(rfqLineNumber);
    if (!line) {
      throw ValidationError.single(
        "rfqLineNumber",
        `quote ${this.props.quoteNumber} does not bid line ${rfqLineNumber}`,
      );
    }
    return line;
  }

  addLine(input: QuoteLineInput): QuoteLine {
    this.assertStatus("add a line to", ["draft"]);
    if (input.unitPrice.currency !== this.props.currency) {
      throw ValidationError.single("unitPrice", `must be in the quote currency ${this.props.currency}`);
    }
    if (this.line(input.rfqLineNumber)) {
      throw ValidationError.single(
        "rfqLineNumber",
        `line ${input.rfqLineNumber} is already quoted on ${this.props.quoteNumber}`,
      );
    }
    const line = new QuoteLine(input);
    this.props.lines.push(line);
    this.props.lines.sort((a, b) => a.rfqLineNumber - b.rfqLineNumber);
    this.touch();
    return line;
  }

  removeLine(rfqLineNumber: number): void {
    this.assertStatus("remove a line from", ["draft"]);
    const index = this.props.lines.findIndex((line) => line.rfqLineNumber === rfqLineNumber);
    if (index < 0) {
      throw ValidationError.single("rfqLineNumber", `line ${rfqLineNumber} is not on this quote`);
    }
    this.props.lines.splice(index, 1);
    this.touch();
  }

  submit(today: IsoDate): void {
    this.assertStatus("submit", ["draft"]);
    if (this.props.lines.length === 0) {
      throw ValidationError.single("lines", "a quote needs at least one priced line");
    }
    if (compareDates(this.props.validUntil, today) < 0) {
      throw ValidationError.single(
        "validUntil",
        `${this.props.validUntil} has already passed (today is ${today})`,
      );
    }
    this.props.status = "submitted";
    this.props.submittedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.QuoteSubmitted,
        aggregateType: "SupplierQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          quoteId: this.id,
          quoteNumber: this.props.quoteNumber,
          rfqId: this.props.rfqId,
          supplierId: this.props.supplierId,
          revision: this.props.revision,
          netTotal: this.netTotal,
          grandTotal: this.grandTotal,
          maxLeadTimeDays: this.maxLeadTimeDays,
          lineNumbers: this.quotedLineNumbers,
        },
      }),
    );
  }

  /** Reopens a submitted quote for editing; the supplier must resubmit. */
  revise(reason: string): void {
    this.assertStatus("revise", ["submitted", "shortlisted"]);
    this.props.status = "draft";
    this.props.revision += 1;
    this.props.submittedAt = undefined;
    this.raise(
      envelope({
        eventType: ProcurementEvents.QuoteRevised,
        aggregateType: "SupplierQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          quoteId: this.id,
          rfqId: this.props.rfqId,
          revision: this.props.revision,
          reason: requiredText(reason, "reason", 3, 500),
        },
      }),
    );
  }

  withdraw(reason: string): void {
    this.assertStatus("withdraw", ["draft", "submitted", "shortlisted"]);
    this.props.status = "withdrawn";
    this.props.withdrawnReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.QuoteWithdrawn,
        aggregateType: "SupplierQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          quoteId: this.id,
          rfqId: this.props.rfqId,
          supplierId: this.props.supplierId,
          reason: this.props.withdrawnReason,
        },
      }),
    );
  }

  shortlist(): void {
    this.assertStatus("shortlist", ["submitted"]);
    this.props.status = "shortlisted";
    this.raise(
      envelope({
        eventType: ProcurementEvents.QuoteShortlisted,
        aggregateType: "SupplierQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { quoteId: this.id, rfqId: this.props.rfqId, supplierId: this.props.supplierId },
      }),
    );
  }

  reject(reason: string): void {
    this.assertStatus("reject", ["submitted", "shortlisted"]);
    this.props.status = "rejected";
    this.props.rejectionReason = requiredText(reason, "reason", 3, 500);
    this.props.decidedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.QuoteRejected,
        aggregateType: "SupplierQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          quoteId: this.id,
          rfqId: this.props.rfqId,
          supplierId: this.props.supplierId,
          reason: this.props.rejectionReason,
        },
      }),
    );
  }

  accept(awardedLineNumbers: readonly number[]): void {
    this.assertStatus("accept", ["submitted", "shortlisted"]);
    for (const lineNumber of awardedLineNumbers) this.requireLine(lineNumber);
    this.props.status = "accepted";
    this.props.decidedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.QuoteAccepted,
        aggregateType: "SupplierQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          quoteId: this.id,
          quoteNumber: this.props.quoteNumber,
          rfqId: this.props.rfqId,
          supplierId: this.props.supplierId,
          awardedLineNumbers: [...awardedLineNumbers],
          awardedValue: this.valueOfLines(awardedLineNumbers),
        },
      }),
    );
  }

  expire(today: IsoDate): boolean {
    if (!["submitted", "shortlisted"].includes(this.props.status)) return false;
    if (compareDates(today, this.props.validUntil) <= 0) return false;
    this.props.status = "expired";
    this.raise(
      envelope({
        eventType: ProcurementEvents.QuoteExpired,
        aggregateType: "SupplierQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          quoteId: this.id,
          rfqId: this.props.rfqId,
          supplierId: this.props.supplierId,
          validUntil: this.props.validUntil,
        },
      }),
    );
    return true;
  }

  isValidOn(date: IsoDate): boolean {
    return compareDates(date, this.props.validUntil) <= 0;
  }

  /** Net value (excluding tax and freight) of the given RFQ lines. */
  valueOfLines(lineNumbers: readonly number[]): Money {
    return sumMoney(
      lineNumbers.map((lineNumber) => this.requireLine(lineNumber).netAmount),
      this.props.currency,
    );
  }

  toJSON(): SupplierQuoteView {
    return {
      ...super.toJSON(),
      netTotal: this.netTotal,
      taxTotal: this.taxTotal,
      grandTotal: this.grandTotal,
      maxLeadTimeDays: this.maxLeadTimeDays,
    };
  }

  private assertStatus(action: string, expected: readonly QuoteStatus[]): void {
    if (!expected.includes(this.props.status)) {
      throw InvalidStateError.transition("quote", action, this.props.status, expected);
    }
  }
}
