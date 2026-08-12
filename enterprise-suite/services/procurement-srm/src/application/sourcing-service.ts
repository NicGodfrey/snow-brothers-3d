import {
  NotFoundError,
  money,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { currencyCode, sumMoney, yearOf, type IsoDate } from "../domain/common.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import type { PurchaseOrder } from "../domain/purchase-order.js";
import type { PurchaseOrderLineInput } from "../domain/purchase-order.js";
import { SupplierQuote, type QuoteLineInput } from "../domain/quote.js";
import {
  evaluateQuotes,
  type EvaluationOptions,
  type RfqEvaluation,
} from "../domain/quote-evaluation.js";
import {
  RequestForQuote,
  type EvaluationWeights,
  type LineAward,
  type RfqLineInput,
  type RfqStatus,
} from "../domain/rfq.js";
import type { PurchaseOrderService } from "./purchase-order-service.js";
import type { RequisitionService } from "./requisition-service.js";
import type { SupplierDirectoryService } from "./supplier-directory-service.js";
import {
  commit,
  type Clock,
  type DocumentNumberGenerator,
  type EventOutbox,
  type QuoteRepository,
  type RfqRepository,
} from "./ports.js";

export interface CreateRfqInput {
  title: string;
  buyerId: Ulid;
  currency: string;
  responseDeadline: IsoDate;
  deliveryLocation: string;
  questionsDeadline?: IsoDate;
  incoterm?: string;
  paymentTermsDays?: number;
  sealed?: boolean;
  evaluationWeights?: Partial<EvaluationWeights>;
  requisitionIds?: readonly Ulid[];
  scopeNotes?: string;
  lines?: readonly RfqLineInput[];
}

export interface AwardDecision {
  quoteId: Ulid;
  lineNumbers: readonly number[];
  note?: string;
}

export interface AwardResult {
  rfq: RequestForQuote;
  purchaseOrders: PurchaseOrder[];
  awardedValue: Money;
}

/**
 * Sourcing use cases: build and issue an RFQ, capture supplier quotes, score
 * them and turn the award into purchase orders.
 */
export class SourcingService {
  constructor(
    private readonly rfqs: RfqRepository,
    private readonly quotes: QuoteRepository,
    private readonly suppliers: SupplierDirectoryService,
    private readonly requisitions: RequisitionService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  // -- RFQ ------------------------------------------------------------------

  createRfq(tenantId: TenantId, input: CreateRfqInput): RequestForQuote {
    const today = this.clock.today();
    const rfq = RequestForQuote.create(tenantId, {
      ...input,
      currency: currencyCode(input.currency),
      rfqNumber: this.numbers.next(tenantId, "RFQ", yearOf(today)),
    });
    return commit(this.rfqs, this.outbox, rfq);
  }

  /**
   * Builds an RFQ straight from approved requisition lines and flags those
   * lines as out to tender.
   */
  createRfqFromRequisition(
    tenantId: TenantId,
    input: {
      requisitionId: Ulid;
      buyerId: Ulid;
      responseDeadline: IsoDate;
      lineIds?: readonly Ulid[];
      title?: string;
      sealed?: boolean;
      incoterm?: string;
      paymentTermsDays?: number;
      evaluationWeights?: Partial<EvaluationWeights>;
    },
  ): RequestForQuote {
    const requisition = this.requisitions.get(tenantId, input.requisitionId);
    const selected = input.lineIds
      ? input.lineIds.map((lineId) => requisition.line(lineId))
      : requisition.lines.filter((line) => line.status === "open" || line.status === "sourcing");
    if (selected.length === 0) {
      throw ValidationError.single("lineIds", "no sourceable requisition lines were selected");
    }
    const rfq = this.createRfq(tenantId, {
      title: input.title ?? `Sourcing for ${requisition.requisitionNumber}`,
      buyerId: input.buyerId,
      currency: requisition.currency,
      responseDeadline: input.responseDeadline,
      deliveryLocation: requisition.deliverTo,
      sealed: input.sealed,
      incoterm: input.incoterm,
      paymentTermsDays: input.paymentTermsDays,
      evaluationWeights: input.evaluationWeights,
      requisitionIds: [requisition.id],
      lines: selected.map((line) => ({
        description: line.description,
        categoryCode: line.categoryCode,
        quantity: line.remainingQuantity,
        uom: line.uom,
        requiredBy: line.neededBy ?? requisition.neededBy,
        itemCode: line.itemCode,
        requisitionId: requisition.id,
        requisitionLineId: line.id,
      })),
    });
    for (const line of selected) {
      this.requisitions.markLineSourcing(tenantId, requisition.id, line.id, rfq.id);
    }
    return rfq;
  }

  getRfq(tenantId: TenantId, rfqId: Ulid): RequestForQuote {
    const rfq = this.rfqs.findById(tenantId, rfqId);
    if (!rfq) throw new NotFoundError("RequestForQuote", rfqId);
    return rfq;
  }

  listRfqs(tenantId: TenantId, filters: { status?: RfqStatus; supplierId?: Ulid } = {}): RequestForQuote[] {
    let results = filters.status
      ? this.rfqs.listByStatus(tenantId, filters.status)
      : this.rfqs.listByTenant(tenantId);
    if (filters.supplierId) {
      results = results.filter((rfq) => rfq.isInvited(filters.supplierId as Ulid));
    }
    return results.sort((a, b) => a.rfqNumber.localeCompare(b.rfqNumber));
  }

  addRfqLine(tenantId: TenantId, rfqId: Ulid, input: RfqLineInput): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    rfq.addLine(input);
    return commit(this.rfqs, this.outbox, rfq);
  }

  inviteSupplier(tenantId: TenantId, rfqId: Ulid, supplierId: Ulid): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    const supplier = this.suppliers.get(tenantId, supplierId);
    supplier.assertSourceable();
    rfq.inviteSupplier(supplier.id);
    return commit(this.rfqs, this.outbox, rfq);
  }

  /** Invites every directory supplier that covers the RFQ's categories. */
  inviteByCategory(tenantId: TenantId, rfqId: Ulid): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    const categories = new Set(rfq.lines.map((line) => line.categoryCode));
    for (const supplier of this.suppliers.list(tenantId, { status: "active" })) {
      const covers = [...categories].some((category) => supplier.handlesCategory(category));
      if (!covers || rfq.isInvited(supplier.id)) continue;
      rfq.inviteSupplier(supplier.id);
    }
    return commit(this.rfqs, this.outbox, rfq);
  }

  issueRfq(tenantId: TenantId, rfqId: Ulid): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    rfq.issue(this.clock.today());
    return commit(this.rfqs, this.outbox, rfq);
  }

  amendRfq(
    tenantId: TenantId,
    rfqId: Ulid,
    note: string,
    changes?: { scopeNotes?: string; deliveryLocation?: string; incoterm?: string },
  ): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    rfq.amend(note, changes);
    return commit(this.rfqs, this.outbox, rfq);
  }

  extendDeadline(tenantId: TenantId, rfqId: Ulid, newDeadline: IsoDate, reason: string): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    rfq.extendDeadline(newDeadline, reason);
    return commit(this.rfqs, this.outbox, rfq);
  }

  declineInvitation(tenantId: TenantId, rfqId: Ulid, supplierId: Ulid, reason: string): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    rfq.recordDecline(supplierId, reason);
    return commit(this.rfqs, this.outbox, rfq);
  }

  closeRfq(tenantId: TenantId, rfqId: Ulid, reason?: string): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    rfq.close(reason);
    return commit(this.rfqs, this.outbox, rfq);
  }

  cancelRfq(tenantId: TenantId, rfqId: Ulid, reason: string): RequestForQuote {
    const rfq = this.getRfq(tenantId, rfqId);
    rfq.cancel(reason);
    return commit(this.rfqs, this.outbox, rfq);
  }

  // -- quotes ---------------------------------------------------------------

  /**
   * Captures a supplier's bid. One quote per supplier per RFQ: a second
   * submission revises the existing quote rather than creating a rival.
   */
  submitQuote(
    tenantId: TenantId,
    input: {
      rfqId: Ulid;
      supplierId: Ulid;
      validUntil: IsoDate;
      lines: readonly QuoteLineInput[];
      incoterm?: string;
      paymentTermsDays?: number;
      supplierReference?: string;
      freightCharge?: Money;
      notes?: string;
    },
  ): SupplierQuote {
    const rfq = this.getRfq(tenantId, input.rfqId);
    const today = this.clock.today();
    if (!rfq.isOpenForQuotes(today)) {
      throw new InvalidStateError(
        `${rfq.rfqNumber} is ${rfq.status} and its deadline is ${rfq.responseDeadline}; quotes are not being accepted`,
        { status: rfq.status, responseDeadline: rfq.responseDeadline },
      );
    }
    if (!rfq.isInvited(input.supplierId)) {
      throw ValidationError.single("supplierId", `is not invited to ${rfq.rfqNumber}`);
    }
    const supplier = this.suppliers.get(tenantId, input.supplierId);
    supplier.assertSourceable();
    for (const line of input.lines) rfq.line(line.rfqLineNumber);

    const existing = this.quotes.findByRfqAndSupplier(tenantId, rfq.id, input.supplierId);
    if (existing) {
      if (existing.status !== "draft") existing.revise("Superseded by a new submission");
      for (const line of [...existing.lines]) existing.removeLine(line.rfqLineNumber);
      for (const line of input.lines) existing.addLine(line);
      existing.submit(today);
      commit(this.quotes, this.outbox, existing);
      rfq.recordResponse(input.supplierId, existing.id);
      commit(this.rfqs, this.outbox, rfq);
      return existing;
    }

    const quote = SupplierQuote.create(tenantId, {
      quoteNumber: this.numbers.next(tenantId, "QT", yearOf(today)),
      rfqId: rfq.id,
      supplierId: input.supplierId,
      currency: rfq.currency,
      validUntil: input.validUntil,
      incoterm: input.incoterm ?? rfq.incoterm,
      paymentTermsDays: input.paymentTermsDays ?? rfq.paymentTermsDays,
      supplierReference: input.supplierReference,
      freightCharge: input.freightCharge,
      notes: input.notes,
      lines: input.lines,
    });
    quote.submit(today);
    commit(this.quotes, this.outbox, quote);
    rfq.recordResponse(input.supplierId, quote.id);
    commit(this.rfqs, this.outbox, rfq);
    return quote;
  }

  getQuote(tenantId: TenantId, quoteId: Ulid): SupplierQuote {
    const quote = this.quotes.findById(tenantId, quoteId);
    if (!quote) throw new NotFoundError("SupplierQuote", quoteId);
    return quote;
  }

  listQuotes(tenantId: TenantId, filters: { rfqId?: Ulid; supplierId?: Ulid } = {}): SupplierQuote[] {
    if (filters.rfqId) {
      const byRfq = this.quotes.listByRfq(tenantId, filters.rfqId);
      return filters.supplierId
        ? byRfq.filter((quote) => quote.supplierId === filters.supplierId)
        : byRfq;
    }
    if (filters.supplierId) return this.quotes.listBySupplier(tenantId, filters.supplierId);
    return this.quotes.listByTenant(tenantId);
  }

  withdrawQuote(tenantId: TenantId, quoteId: Ulid, reason: string): SupplierQuote {
    const quote = this.getQuote(tenantId, quoteId);
    quote.withdraw(reason);
    return commit(this.quotes, this.outbox, quote);
  }

  shortlistQuote(tenantId: TenantId, quoteId: Ulid): SupplierQuote {
    const quote = this.getQuote(tenantId, quoteId);
    quote.shortlist();
    return commit(this.quotes, this.outbox, quote);
  }

  rejectQuote(tenantId: TenantId, quoteId: Ulid, reason: string): SupplierQuote {
    const quote = this.getQuote(tenantId, quoteId);
    quote.reject(reason);
    return commit(this.quotes, this.outbox, quote);
  }

  /** Expires quotes whose validity has lapsed; safe to run repeatedly. */
  expireQuotes(tenantId: TenantId): SupplierQuote[] {
    const today = this.clock.today();
    const expired: SupplierQuote[] = [];
    for (const quote of this.quotes.listByTenant(tenantId)) {
      if (quote.expire(today)) {
        commit(this.quotes, this.outbox, quote);
        expired.push(quote);
      }
    }
    return expired;
  }

  // -- evaluation and award -------------------------------------------------

  /**
   * Scores the bids on an RFQ. Sealed RFQs stay hidden until they close, which
   * is enforced here rather than in the UI.
   */
  evaluate(tenantId: TenantId, rfqId: Ulid, options: EvaluationOptions = {}): RfqEvaluation {
    const rfq = this.getRfq(tenantId, rfqId);
    if (rfq.sealed && rfq.status === "issued") {
      throw new InvalidStateError(
        `${rfq.rfqNumber} is a sealed-bid RFQ; close it before comparing quotes`,
        { status: rfq.status },
      );
    }
    const quotes = this.quotes.listByRfq(tenantId, rfq.id);
    const suppliers = this.suppliers.scoreInputs(
      tenantId,
      quotes.map((quote) => quote.supplierId),
    );
    const baseline = options.baseline ?? this.baselineFor(tenantId, rfq);
    return evaluateQuotes(rfq, quotes, suppliers, { ...options, baseline });
  }

  /**
   * Awards the RFQ and raises one purchase order per winning supplier, priced
   * from their quote and linked back to the originating requisition lines.
   */
  award(
    tenantId: TenantId,
    rfqId: Ulid,
    input: {
      awardedBy: Ulid;
      decisions: readonly AwardDecision[];
      shipTo?: string;
      rejectOthers?: boolean;
      rejectionReason?: string;
    },
  ): AwardResult {
    const rfq = this.getRfq(tenantId, rfqId);
    if (input.decisions.length === 0) {
      throw ValidationError.single("decisions", "at least one award decision is required");
    }

    const awards: LineAward[] = [];
    const valueByQuote = new Map<Ulid, number>();
    const quotesById = new Map<Ulid, SupplierQuote>();
    for (const decision of input.decisions) {
      const quote = this.getQuote(tenantId, decision.quoteId);
      if (quote.rfqId !== rfq.id) {
        throw ValidationError.single("quoteId", `${quote.quoteNumber} does not belong to ${rfq.rfqNumber}`);
      }
      if (!quote.isValidOn(this.clock.today())) {
        throw new InvalidStateError(
          `Quote ${quote.quoteNumber} expired on ${quote.validUntil}`,
          { quoteId: quote.id, validUntil: quote.validUntil },
        );
      }
      quotesById.set(quote.id, quote);
      awards.push({
        quoteId: quote.id,
        supplierId: quote.supplierId,
        lineNumbers: decision.lineNumbers,
        note: decision.note,
      });
      valueByQuote.set(quote.id, quote.valueOfLines(decision.lineNumbers).amountMinor);
    }

    rfq.award(awards, valueByQuote);
    commit(this.rfqs, this.outbox, rfq);

    const purchaseOrders: PurchaseOrder[] = [];
    for (const award of awards) {
      const quote = quotesById.get(award.quoteId);
      if (!quote) continue;
      quote.accept(award.lineNumbers);
      commit(this.quotes, this.outbox, quote);
      purchaseOrders.push(this.orderFromAward(tenantId, rfq, quote, award, input));
    }

    if (input.rejectOthers) {
      for (const quote of this.quotes.listByRfq(tenantId, rfq.id)) {
        if (quotesById.has(quote.id)) continue;
        if (quote.status !== "submitted" && quote.status !== "shortlisted") continue;
        quote.reject(input.rejectionReason ?? `Not awarded on ${rfq.rfqNumber}`);
        commit(this.quotes, this.outbox, quote);
      }
    }

    return {
      rfq,
      purchaseOrders,
      awardedValue: money(
        [...valueByQuote.values()].reduce((total, value) => total + value, 0),
        rfq.currency,
      ),
    };
  }

  // -- internals ------------------------------------------------------------

  private orderFromAward(
    tenantId: TenantId,
    rfq: RequestForQuote,
    quote: SupplierQuote,
    award: LineAward,
    input: { awardedBy: Ulid; shipTo?: string },
  ): PurchaseOrder {
    const lines: PurchaseOrderLineInput[] = award.lineNumbers.map((lineNumber) => {
      const rfqLine = rfq.line(lineNumber);
      const quoteLine = quote.requireLine(lineNumber);
      return {
        description: rfqLine.description,
        categoryCode: rfqLine.categoryCode,
        quantity: rfqLine.quantity,
        uom: rfqLine.uom,
        unitPrice: quoteLine.netUnitPrice,
        taxBps: quoteLine.taxBps,
        needBy: rfqLine.requiredBy,
        itemCode: quoteLine.alternativeItemCode ?? rfqLine.itemCode,
        requisitionId: rfqLine.requisitionId,
        requisitionLineId: rfqLine.requisitionLineId,
        quoteId: quote.id,
        rfqLineNumber: lineNumber,
      };
    });

    const order = this.purchaseOrders.create(tenantId, {
      supplierId: quote.supplierId,
      buyerId: input.awardedBy,
      currency: rfq.currency,
      shipTo: input.shipTo ?? rfq.deliveryLocation,
      incoterm: quote.incoterm,
      paymentTermsDays: quote.paymentTermsDays,
      sourceType: "quote",
      requisitionIds: [...new Set(lines.map((line) => line.requisitionId).filter(Boolean))] as Ulid[],
      rfqId: rfq.id,
      quoteId: quote.id,
      supplierReference: quote.quoteNumber,
      lines,
    });

    for (const line of order.lines) {
      if (!line.requisitionId || !line.requisitionLineId) continue;
      this.requisitions.recordOrdered(
        tenantId,
        line.requisitionId,
        line.requisitionLineId,
        line.quantity,
        order.id,
      );
    }
    return order;
  }

  /** Requisition estimate for the RFQ basket, used as the savings baseline. */
  private baselineFor(tenantId: TenantId, rfq: RequestForQuote): Money | undefined {
    const amounts: Money[] = [];
    for (const line of rfq.lines) {
      if (!line.requisitionId || !line.requisitionLineId) continue;
      const requisition = this.requisitions.get(tenantId, line.requisitionId);
      const requisitionLine = requisition.line(line.requisitionLineId);
      amounts.push(
        money(
          Math.round(requisitionLine.estimatedUnitPrice.amountMinor * line.quantity),
          rfq.currency,
        ),
      );
    }
    return amounts.length > 0 ? sumMoney(amounts, rfq.currency) : undefined;
  }
}
