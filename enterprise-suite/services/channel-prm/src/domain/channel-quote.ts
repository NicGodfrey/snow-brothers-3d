import {
  AggregateRoot,
  envelope,
  money,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, PolicyViolationError, ValidationError } from "./errors.js";
import { ChannelEventTypes } from "./events.js";
import {
  assertBps,
  assertPositiveMoney,
  deductBps,
  discountBpsOf,
  multiplyMoney,
  sumMoney,
  zeroMoney,
} from "./money-math.js";
import { addDays, assertIso } from "./protection.js";
import { normalizeProductLine, type CustomerKey } from "./territory.js";

/**
 * Channel quote / special pricing request.
 *
 *   draft ─submit→ submitted ─approve→ approved ─order→ ordered
 *                       └────reject→ rejected      ├─(validUntil passes)→ expired
 *                                                  └─supersede→ superseded
 *
 * The quote itself is a *channel* document: it captures what the partner asked
 * for, what the vendor authorized and why. The customer-facing quote lives in
 * sales-erp and is referenced by `salesQuoteRef` — this context never
 * duplicates its line-level tax, terms or fulfilment data, only the pricing
 * decision it is allowed to make.
 */

export type ChannelQuoteStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "expired"
  | "superseded"
  | "ordered";

export const CHANNEL_QUOTE_STATUSES: readonly ChannelQuoteStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "ordered",
];

/** Handle for a document owned by another bounded context. */
export interface ExternalRef {
  readonly system: string;
  readonly id: string;
  readonly number?: string;
}

export interface ChannelQuoteLine {
  readonly id: Ulid;
  readonly productLine: string;
  readonly sku?: string;
  readonly description?: string;
  readonly quantity: number;
  readonly listUnitPrice: Money;
  readonly requestedUnitPrice: Money;
  readonly approvedUnitPrice?: Money;
}

export interface AddQuoteLineInput {
  readonly productLine: string;
  readonly sku?: string;
  readonly description?: string;
  readonly quantity: number;
  readonly listUnitPrice: Money;
  /** Omit to request list price; provide to request a discount. */
  readonly requestedUnitPrice?: Money;
}

export interface ChannelQuoteProps {
  number: string;
  partnerId: Ulid;
  registrationId?: Ulid;
  customerKey: CustomerKey;
  customerName: string;
  currency: string;
  status: ChannelQuoteStatus;
  lines: ChannelQuoteLine[];
  validUntil?: IsoDateTime;
  submittedAt?: IsoDateTime;
  submittedBy?: UserId;
  /** False when the request sits inside the tier band and the deal is registered. */
  requiresApproval?: boolean;
  decidedAt?: IsoDateTime;
  decidedBy?: UserId;
  decisionNotes?: string;
  approvedDiscountBps?: number;
  rejectionReason?: string;
  salesQuoteRef?: ExternalRef;
  supersededByQuoteId?: Ulid;
  orderId?: Ulid;
  notes?: string;
}

export interface CreateChannelQuoteInput {
  readonly number: string;
  readonly partnerId: Ulid;
  readonly registrationId?: Ulid;
  readonly customerKey: CustomerKey;
  readonly customerName: string;
  readonly currency: string;
  readonly notes?: string;
  readonly salesQuoteRef?: ExternalRef;
}

export class ChannelQuote extends AggregateRoot<ChannelQuoteProps> {
  static create(tenantId: TenantId, input: CreateChannelQuoteInput): ChannelQuote {
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw ValidationError.single("currency", "must be a 3-letter ISO currency code");
    }
    if (input.customerName.trim().length < 2) {
      throw ValidationError.single("customerName", "must be at least 2 characters");
    }
    const quote = new ChannelQuote(tenantId, {
      number: input.number,
      partnerId: input.partnerId,
      registrationId: input.registrationId,
      customerKey: input.customerKey,
      customerName: input.customerName.trim(),
      currency,
      status: "draft",
      lines: [],
      notes: input.notes?.trim() || undefined,
      salesQuoteRef: input.salesQuoteRef,
    });
    quote.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelQuoteCreated,
        aggregateType: "ChannelQuote",
        aggregateId: quote.id,
        tenantId,
        payload: quote.basePayload(),
      }),
    );
    return quote;
  }

  static fromSnapshot(snapshot: EntityProps & ChannelQuoteProps): ChannelQuote {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new ChannelQuote(tenantId, { ...props, lines: [...props.lines] }, { id, createdAt, updatedAt, version });
  }

  get number(): string {
    return this.props.number;
  }
  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get registrationId(): Ulid | undefined {
    return this.props.registrationId;
  }
  get customerKey(): CustomerKey {
    return this.props.customerKey;
  }
  get customerName(): string {
    return this.props.customerName;
  }
  get status(): ChannelQuoteStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get lines(): readonly ChannelQuoteLine[] {
    return this.props.lines;
  }
  get validUntil(): IsoDateTime | undefined {
    return this.props.validUntil;
  }
  get requiresApproval(): boolean {
    return this.props.requiresApproval ?? true;
  }
  get salesQuoteRef(): ExternalRef | undefined {
    return this.props.salesQuoteRef;
  }
  get approvedDiscountBps(): number | undefined {
    return this.props.approvedDiscountBps;
  }
  get orderId(): Ulid | undefined {
    return this.props.orderId;
  }
  get supersededByQuoteId(): Ulid | undefined {
    return this.props.supersededByQuoteId;
  }
  get submittedAt(): IsoDateTime | undefined {
    return this.props.submittedAt;
  }
  get decidedAt(): IsoDateTime | undefined {
    return this.props.decidedAt;
  }

  // --- totals --------------------------------------------------------------

  listTotal(): Money {
    return sumMoney(
      this.props.lines.map((l) => multiplyMoney(l.listUnitPrice, l.quantity)),
      this.props.currency,
    );
  }

  requestedTotal(): Money {
    return sumMoney(
      this.props.lines.map((l) => multiplyMoney(l.requestedUnitPrice, l.quantity)),
      this.props.currency,
    );
  }

  /** Approved prices where decided, otherwise the requested ones. */
  approvedTotal(): Money {
    return sumMoney(
      this.props.lines.map((l) => multiplyMoney(l.approvedUnitPrice ?? l.requestedUnitPrice, l.quantity)),
      this.props.currency,
    );
  }

  requestedDiscountBps(): number {
    return discountBpsOf(this.listTotal(), this.requestedTotal());
  }

  effectiveDiscountBps(): number {
    return discountBpsOf(this.listTotal(), this.approvedTotal());
  }

  /** What the approval decision cost against the ask, in minor units. */
  concessionAgainstRequest(): Money {
    const requested = this.requestedTotal();
    const approved = this.approvedTotal();
    return money(approved.amountMinor - requested.amountMinor, this.props.currency);
  }

  isExpiredAt(at: IsoDateTime): boolean {
    return !!this.props.validUntil && Date.parse(at) >= Date.parse(this.props.validUntil);
  }

  // --- line editing --------------------------------------------------------

  addLine(input: AddQuoteLineInput): ChannelQuoteLine {
    this.assertDraft("add lines");
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw ValidationError.single("quantity", "must be greater than zero");
    }
    assertPositiveMoney(input.listUnitPrice, "listUnitPrice");
    this.assertCurrency(input.listUnitPrice, "listUnitPrice");
    const requested = input.requestedUnitPrice ?? input.listUnitPrice;
    this.assertCurrency(requested, "requestedUnitPrice");
    if (requested.amountMinor < 0) {
      throw ValidationError.single("requestedUnitPrice", "must not be negative");
    }
    if (requested.amountMinor > input.listUnitPrice.amountMinor) {
      throw ValidationError.single("requestedUnitPrice", "cannot exceed the list price — uplifts are not supported");
    }
    const line: ChannelQuoteLine = {
      id: newId("cqline"),
      productLine: normalizeProductLine(input.productLine),
      sku: input.sku?.trim().toUpperCase() || undefined,
      description: input.description?.trim() || undefined,
      quantity: input.quantity,
      listUnitPrice: input.listUnitPrice,
      requestedUnitPrice: requested,
    };
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  updateLine(
    lineId: Ulid,
    changes: { quantity?: number; requestedUnitPrice?: Money; description?: string },
  ): ChannelQuoteLine {
    this.assertDraft("update lines");
    const index = this.props.lines.findIndex((l) => l.id === lineId);
    if (index === -1) throw new InvalidStateError(`Line ${lineId} is not on quote ${this.props.number}`);
    const line = this.props.lines[index]!;
    if (changes.quantity !== undefined && (!Number.isFinite(changes.quantity) || changes.quantity <= 0)) {
      throw ValidationError.single("quantity", "must be greater than zero");
    }
    if (changes.requestedUnitPrice) {
      this.assertCurrency(changes.requestedUnitPrice, "requestedUnitPrice");
      if (changes.requestedUnitPrice.amountMinor > line.listUnitPrice.amountMinor) {
        throw ValidationError.single("requestedUnitPrice", "cannot exceed the list price");
      }
    }
    const updated: ChannelQuoteLine = {
      ...line,
      quantity: changes.quantity ?? line.quantity,
      requestedUnitPrice: changes.requestedUnitPrice ?? line.requestedUnitPrice,
      description: changes.description?.trim() ?? line.description,
    };
    this.props.lines[index] = updated;
    this.touch();
    return updated;
  }

  removeLine(lineId: Ulid): void {
    this.assertDraft("remove lines");
    const index = this.props.lines.findIndex((l) => l.id === lineId);
    if (index === -1) throw new InvalidStateError(`Line ${lineId} is not on quote ${this.props.number}`);
    this.props.lines.splice(index, 1);
    this.touch();
  }

  // --- workflow ------------------------------------------------------------

  submit(input: { by: UserId; at: IsoDateTime; validityDays: number; requiresApproval: boolean }): void {
    this.assertDraft("submit");
    if (this.props.lines.length === 0) {
      throw new InvalidStateError(`Quote ${this.props.number} has no lines`);
    }
    if (!Number.isInteger(input.validityDays) || input.validityDays < 1 || input.validityDays > 365) {
      throw ValidationError.single("validityDays", "must be an integer between 1 and 365");
    }
    this.props.status = "submitted";
    this.props.submittedAt = assertIso(input.at, "at");
    this.props.submittedBy = input.by;
    this.props.validUntil = addDays(input.at, input.validityDays);
    this.props.requiresApproval = input.requiresApproval;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelQuoteSubmitted,
        aggregateType: "ChannelQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          listTotal: this.listTotal(),
          requestedTotal: this.requestedTotal(),
          requestedDiscountBps: this.requestedDiscountBps(),
          validUntil: this.props.validUntil,
          requiresApproval: input.requiresApproval,
        },
      }),
    );
  }

  /**
   * Approves the request, optionally as a counter-offer.
   *
   * `discountBps` re-prices every line off list — the usual case, because the
   * band is negotiated at deal level. `unitPrices` overrides individual lines
   * for mixed baskets. A counter-offer may never be *better* than what the
   * partner asked for (that would leak margin the partner never requested) and
   * never worse than list.
   */
  approve(input: {
    by: UserId;
    at: IsoDateTime;
    discountBps?: number;
    unitPrices?: ReadonlyMap<Ulid, Money>;
    ceilingBps: number;
    notes?: string;
    salesQuoteRef?: ExternalRef;
  }): void {
    if (this.props.status !== "submitted") {
      throw new InvalidStateError(
        `Quote ${this.props.number} is ${this.props.status}; only submitted quotes can be approved`,
      );
    }
    if (this.isExpiredAt(input.at)) {
      throw new InvalidStateError(`Quote ${this.props.number} expired on ${this.props.validUntil}`);
    }
    assertBps(input.ceilingBps, "ceilingBps");

    if (input.discountBps !== undefined) {
      assertBps(input.discountBps, "discountBps");
      if (input.discountBps > input.ceilingBps) {
        throw new PolicyViolationError(
          `Approved discount ${input.discountBps}bps exceeds the authorized ceiling of ${input.ceilingBps}bps`,
          "quote.discountCeiling",
          { requested: input.discountBps, ceiling: input.ceilingBps },
        );
      }
      this.props.lines = this.props.lines.map((line) => ({
        ...line,
        approvedUnitPrice: deductBps(line.listUnitPrice, input.discountBps!),
      }));
    } else if (input.unitPrices) {
      this.props.lines = this.props.lines.map((line) => {
        const price = input.unitPrices!.get(line.id);
        if (!price) return { ...line, approvedUnitPrice: line.requestedUnitPrice };
        this.assertCurrency(price, "approvedUnitPrice");
        if (price.amountMinor > line.listUnitPrice.amountMinor) {
          throw ValidationError.single("approvedUnitPrice", "cannot exceed the list price");
        }
        if (price.amountMinor < line.requestedUnitPrice.amountMinor) {
          throw ValidationError.single(
            "approvedUnitPrice",
            "cannot undercut the price the partner asked for; counter-offers only move up",
          );
        }
        return { ...line, approvedUnitPrice: price };
      });
    } else {
      this.props.lines = this.props.lines.map((line) => ({ ...line, approvedUnitPrice: line.requestedUnitPrice }));
    }

    const effective = this.effectiveDiscountBps();
    if (effective > input.ceilingBps) {
      throw new PolicyViolationError(
        `Approved pricing works out at ${effective}bps, beyond the authorized ceiling of ${input.ceilingBps}bps`,
        "quote.discountCeiling",
        { effective, ceiling: input.ceilingBps },
      );
    }

    this.props.status = "approved";
    this.props.decidedAt = input.at;
    this.props.decidedBy = input.by;
    this.props.decisionNotes = input.notes?.trim() || undefined;
    this.props.approvedDiscountBps = effective;
    if (input.salesQuoteRef) this.props.salesQuoteRef = input.salesQuoteRef;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelQuoteApproved,
        aggregateType: "ChannelQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          decidedBy: input.by,
          approvedTotal: this.approvedTotal(),
          approvedDiscountBps: effective,
          salesQuoteRef: this.props.salesQuoteRef?.id,
        },
      }),
    );
  }

  reject(input: { by: UserId; at: IsoDateTime; reason: string }): void {
    if (this.props.status !== "submitted") {
      throw new InvalidStateError(
        `Quote ${this.props.number} is ${this.props.status}; only submitted quotes can be rejected`,
      );
    }
    if (input.reason.trim().length === 0) throw ValidationError.single("reason", "a rejection reason is required");
    this.props.status = "rejected";
    this.props.decidedAt = input.at;
    this.props.decidedBy = input.by;
    this.props.rejectionReason = input.reason.trim();
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelQuoteRejected,
        aggregateType: "ChannelQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), decidedBy: input.by, reason: input.reason.trim() },
      }),
    );
  }

  expire(at: IsoDateTime): boolean {
    if (this.props.status !== "submitted" && this.props.status !== "approved") return false;
    if (!this.isExpiredAt(at)) return false;
    this.props.status = "expired";
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelQuoteExpired,
        aggregateType: "ChannelQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), validUntil: this.props.validUntil },
      }),
    );
    return true;
  }

  supersede(byQuoteId: Ulid, at: IsoDateTime): void {
    if (this.props.status === "ordered") {
      throw new InvalidStateError(`Quote ${this.props.number} is already ordered and cannot be superseded`);
    }
    this.props.status = "superseded";
    this.props.supersededByQuoteId = byQuoteId;
    this.props.decidedAt = at;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelQuoteSuperseded,
        aggregateType: "ChannelQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), supersededBy: byQuoteId },
      }),
    );
  }

  markOrdered(orderId: Ulid, at: IsoDateTime): void {
    if (this.props.status !== "approved") {
      throw new InvalidStateError(
        `Quote ${this.props.number} is ${this.props.status}; only an approved quote can be ordered`,
      );
    }
    if (this.isExpiredAt(at)) {
      throw new InvalidStateError(`Quote ${this.props.number} expired on ${this.props.validUntil}`);
    }
    this.props.status = "ordered";
    this.props.orderId = orderId;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelQuoteOrdered,
        aggregateType: "ChannelQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), orderId, approvedTotal: this.approvedTotal() },
      }),
    );
  }

  linkSalesQuote(ref: ExternalRef): void {
    if (!ref.id.trim()) throw ValidationError.single("salesQuoteRef.id", "is required");
    this.props.salesQuoteRef = { system: ref.system.trim() || "sales-erp", id: ref.id.trim(), number: ref.number?.trim() };
    this.touch();
  }

  private assertDraft(action: string): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`Cannot ${action}: quote ${this.props.number} is ${this.props.status}`);
    }
  }

  private assertCurrency(value: Money, field: string): void {
    if (value.currency !== this.props.currency) {
      throw ValidationError.single(field, `must be in ${this.props.currency}, the quote currency`);
    }
  }

  private basePayload() {
    return {
      quoteId: this.id,
      number: this.props.number,
      partnerId: this.props.partnerId,
      registrationId: this.props.registrationId,
      currency: this.props.currency,
      total: this.props.lines.length === 0 ? zeroMoney(this.props.currency) : this.approvedTotal(),
    };
  }
}
