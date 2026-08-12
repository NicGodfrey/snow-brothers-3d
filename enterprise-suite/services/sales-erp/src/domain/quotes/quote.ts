import {
  ConflictError,
  NotFoundError,
  assertTransition,
  type CurrencyCode,
  type IsoDate,
  type TenantId,
  type Ulid,
  type UserId,
  currency,
} from "../../kernel/index.js";
import { AggregateRoot } from "../../kernel/aggregate.js";
import { requiresManagerApproval } from "../pricing/discount.js";
import type { TaxCalculator } from "../pricing/tax.js";
import { computeTotals, type DocumentTotals } from "./calculator.js";
import { createQuoteLine, updateQuoteLine, type QuoteLine, type QuoteLineInput } from "./quote-line.js";
import { QUOTE_STATUS_MACHINE, type QuoteStatus } from "./status.js";
import { QuoteEventTypes, quoteEvent } from "./events.js";

export interface QuoteProps {
  quoteNumber: string;
  accountId: Ulid;
  opportunityId?: Ulid;
  currency: CurrencyCode;
  taxRegion: string;
  status: QuoteStatus;
  revision: number;
  validUntil: IsoDate;
  lines: QuoteLine[];
  notes?: string;
  submittedBy?: UserId;
  approvedBy?: UserId;
  rejectionReason?: string;
  acceptedAt?: IsoDate;
}

export class Quote extends AggregateRoot<QuoteProps> {
  private constructor(tenantId: TenantId, props: QuoteProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      quoteNumber: string;
      accountId: Ulid;
      opportunityId?: Ulid;
      currency: string;
      taxRegion: string;
      validUntil: IsoDate;
      notes?: string;
    },
  ): Quote {
    const quote = new Quote(tenantId, {
      quoteNumber: input.quoteNumber,
      accountId: input.accountId,
      opportunityId: input.opportunityId,
      currency: currency(input.currency),
      taxRegion: input.taxRegion.toUpperCase(),
      status: QUOTE_STATUS_MACHINE.initial,
      revision: 1,
      validUntil: input.validUntil,
      lines: [],
      notes: input.notes,
    });
    quote.raise(
      quoteEvent(QuoteEventTypes.QuoteCreated, quote.id, tenantId, {
        quoteNumber: quote.props.quoteNumber,
        accountId: quote.props.accountId as unknown as string,
        revision: quote.props.revision,
      }),
    );
    return quote;
  }

  get quoteNumber(): string {
    return this.props.quoteNumber;
  }

  get accountId(): Ulid {
    return this.props.accountId;
  }

  get opportunityId(): Ulid | undefined {
    return this.props.opportunityId;
  }

  get status(): QuoteStatus {
    return this.props.status;
  }

  get revision(): number {
    return this.props.revision;
  }

  get currencyCode(): CurrencyCode {
    return this.props.currency;
  }

  get taxRegion(): string {
    return this.props.taxRegion;
  }

  get validUntil(): IsoDate {
    return this.props.validUntil;
  }

  get lines(): readonly QuoteLine[] {
    return this.props.lines;
  }

  get maxLineDiscountPercent(): number {
    return this.props.lines.reduce((max, l) => Math.max(max, l.discountPercent), 0);
  }

  totals(taxCalculator?: TaxCalculator): DocumentTotals {
    return computeTotals(this.props.lines, this.props.currency, this.props.taxRegion, taxCalculator);
  }

  addLine(input: Omit<QuoteLineInput, "currency">): QuoteLine {
    this.assertEditable();
    const line = createQuoteLine({ ...input, currency: this.props.currency });
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  updateLine(
    lineId: Ulid,
    patch: { qty?: number; unitPriceMinor?: number; discountPercent?: number; description?: string },
  ): QuoteLine {
    this.assertEditable();
    const idx = this.props.lines.findIndex((l) => l.lineId === lineId);
    if (idx === -1) throw new NotFoundError("QuoteLine", lineId as unknown as string);
    const updated = updateQuoteLine(this.props.lines[idx], patch);
    this.props.lines[idx] = updated;
    this.touch();
    return updated;
  }

  removeLine(lineId: Ulid): void {
    this.assertEditable();
    const idx = this.props.lines.findIndex((l) => l.lineId === lineId);
    if (idx === -1) throw new NotFoundError("QuoteLine", lineId as unknown as string);
    this.props.lines.splice(idx, 1);
    this.touch();
  }

  /** True when any line discount is above the manager-approval threshold. */
  get needsManagerApproval(): boolean {
    return requiresManagerApproval(this.maxLineDiscountPercent);
  }

  submit(submittedBy: UserId): void {
    assertTransition(QUOTE_STATUS_MACHINE, this.props.status, "pending_approval");
    if (this.props.lines.length === 0) {
      throw new ConflictError(`Quote ${this.props.quoteNumber} has no lines`);
    }
    this.props.status = "pending_approval";
    this.props.submittedBy = submittedBy;
    this.raise(
      quoteEvent(QuoteEventTypes.QuoteSubmitted, this.id, this.tenantId, this.lifecyclePayload()),
    );
  }

  approve(approvedBy: UserId): void {
    assertTransition(QUOTE_STATUS_MACHINE, this.props.status, "approved");
    this.props.status = "approved";
    this.props.approvedBy = approvedBy;
    this.props.rejectionReason = undefined;
    this.raise(
      quoteEvent(QuoteEventTypes.QuoteApproved, this.id, this.tenantId, this.lifecyclePayload()),
    );
  }

  reject(reason: string): void {
    assertTransition(QUOTE_STATUS_MACHINE, this.props.status, "rejected");
    if (!reason.trim()) throw new ConflictError("A rejection reason is required");
    this.props.status = "rejected";
    this.props.rejectionReason = reason.trim();
    this.raise(
      quoteEvent(QuoteEventTypes.QuoteRejected, this.id, this.tenantId, {
        ...this.lifecyclePayload(),
        reason: this.props.rejectionReason,
      }),
    );
  }

  /** Customer acceptance; only valid for approved quotes still within validity. */
  accept(today: IsoDate): void {
    assertTransition(QUOTE_STATUS_MACHINE, this.props.status, "accepted");
    if ((today as unknown as string) > (this.props.validUntil as unknown as string)) {
      throw new ConflictError(
        `Quote ${this.props.quoteNumber} validity ended ${this.props.validUntil}; it can no longer be accepted`,
      );
    }
    this.props.status = "accepted";
    this.props.acceptedAt = today;
    const totals = this.totals();
    this.raise(
      quoteEvent(QuoteEventTypes.QuoteAccepted, this.id, this.tenantId, {
        ...this.lifecyclePayload(),
        grandTotalMinor: totals.grandTotal.amountMinor as unknown as number,
        currency: this.props.currency as unknown as string,
        opportunityId: this.props.opportunityId as unknown as string | undefined,
      }),
    );
  }

  /** Validity sweep: approved quotes past validUntil expire. */
  markExpired(today: IsoDate): boolean {
    if (this.props.status !== "approved") return false;
    if ((today as unknown as string) <= (this.props.validUntil as unknown as string)) return false;
    assertTransition(QUOTE_STATUS_MACHINE, this.props.status, "expired");
    this.props.status = "expired";
    this.raise(
      quoteEvent(QuoteEventTypes.QuoteExpired, this.id, this.tenantId, this.lifecyclePayload()),
    );
    return true;
  }

  cancel(): void {
    assertTransition(QUOTE_STATUS_MACHINE, this.props.status, "cancelled");
    this.props.status = "cancelled";
    this.raise(
      quoteEvent(QuoteEventTypes.QuoteCancelled, this.id, this.tenantId, this.lifecyclePayload()),
    );
  }

  /** Re-open a rejected or expired quote as a new revision (lines preserved for editing). */
  revise(newValidUntil: IsoDate): void {
    assertTransition(QUOTE_STATUS_MACHINE, this.props.status, "draft");
    this.props.status = "draft";
    this.props.revision += 1;
    this.props.validUntil = newValidUntil;
    this.props.approvedBy = undefined;
    this.props.rejectionReason = undefined;
    this.raise(
      quoteEvent(QuoteEventTypes.QuoteRevised, this.id, this.tenantId, this.lifecyclePayload()),
    );
  }

  private lifecyclePayload(): { quoteNumber: string; accountId: string; revision: number } {
    return {
      quoteNumber: this.props.quoteNumber,
      accountId: this.props.accountId as unknown as string,
      revision: this.props.revision,
    };
  }

  private assertEditable(): void {
    if (this.props.status !== "draft") {
      throw new ConflictError(
        `Quote ${this.props.quoteNumber} is ${this.props.status}; lines can only change in draft`,
      );
    }
  }
}
