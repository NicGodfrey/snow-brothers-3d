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
  BPS_ONE,
  code,
  compareDates,
  currencyCode,
  incoterm,
  paymentTermsDays as validPaymentTerms,
  positiveQuantity,
  requiredText,
  uom,
  type Incoterm,
  type IsoDate,
  type Quantity,
  type UomCode,
} from "./common.js";
import { InvalidStateError, invariant, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type RfqStatus = "draft" | "issued" | "closed" | "awarded" | "cancelled";

export const RFQ_STATUSES: readonly RfqStatus[] = ["draft", "issued", "closed", "awarded", "cancelled"];

export type InvitationStatus = "invited" | "viewed" | "declined" | "responded";

/**
 * Weights used to rank quotes, in basis points; they must total 10000 so that
 * a weighted score is directly comparable across RFQs.
 */
export interface EvaluationWeights {
  readonly priceBps: number;
  readonly leadTimeBps: number;
  readonly qualityBps: number;
  readonly complianceBps: number;
}

export const DEFAULT_EVALUATION_WEIGHTS: EvaluationWeights = {
  priceBps: 6_000,
  leadTimeBps: 2_000,
  qualityBps: 1_500,
  complianceBps: 500,
};

export function evaluationWeights(input: Partial<EvaluationWeights>): EvaluationWeights {
  const weights: EvaluationWeights = { ...DEFAULT_EVALUATION_WEIGHTS, ...input };
  const total =
    weights.priceBps + weights.leadTimeBps + weights.qualityBps + weights.complianceBps;
  if (total !== BPS_ONE) {
    throw ValidationError.single(
      "evaluationWeights",
      `must total ${BPS_ONE} basis points, got ${total}`,
    );
  }
  for (const [key, value] of Object.entries(weights)) {
    invariant(Number.isInteger(value) && value >= 0, key, "must be a non-negative integer");
  }
  return weights;
}

export interface RfqLineInput {
  description: string;
  categoryCode: string;
  quantity: number;
  uom: string;
  requiredBy: IsoDate;
  itemCode?: string;
  specification?: string;
  requisitionId?: Ulid;
  requisitionLineId?: Ulid;
  /** Suppliers may bid an equivalent item unless the line is locked down. */
  alternativesAllowed?: boolean;
}

export class RfqLine {
  readonly id: Ulid;
  readonly lineNumber: number;
  description: string;
  categoryCode: string;
  quantity: Quantity;
  uom: UomCode;
  requiredBy: IsoDate;
  itemCode?: string;
  specification?: string;
  requisitionId?: Ulid;
  requisitionLineId?: Ulid;
  alternativesAllowed: boolean;
  awardedQuoteId?: Ulid;
  awardedSupplierId?: Ulid;

  constructor(lineNumber: number, input: RfqLineInput) {
    this.id = newId("rfqline");
    this.lineNumber = lineNumber;
    this.description = requiredText(input.description, "description", 3, 500);
    this.categoryCode = code(input.categoryCode, "categoryCode");
    this.quantity = positiveQuantity(input.quantity, "quantity");
    this.uom = uom(input.uom);
    this.requiredBy = input.requiredBy;
    this.itemCode = input.itemCode ? code(input.itemCode, "itemCode", 60) : undefined;
    this.specification = input.specification;
    this.requisitionId = input.requisitionId;
    this.requisitionLineId = input.requisitionLineId;
    this.alternativesAllowed = input.alternativesAllowed ?? true;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      lineNumber: this.lineNumber,
      description: this.description,
      categoryCode: this.categoryCode,
      quantity: this.quantity,
      uom: this.uom,
      requiredBy: this.requiredBy,
      itemCode: this.itemCode,
      specification: this.specification,
      requisitionId: this.requisitionId,
      requisitionLineId: this.requisitionLineId,
      alternativesAllowed: this.alternativesAllowed,
      awardedQuoteId: this.awardedQuoteId,
      awardedSupplierId: this.awardedSupplierId,
    };
  }
}

export interface RfqInvitation {
  supplierId: Ulid;
  invitedAt: IsoDateTime;
  status: InvitationStatus;
  quoteId?: Ulid;
  declineReason?: string;
  respondedAt?: IsoDateTime;
}

export interface LineAward {
  readonly quoteId: Ulid;
  readonly supplierId: Ulid;
  readonly lineNumbers: readonly number[];
  readonly note?: string;
}

export interface RequestForQuoteProps {
  rfqNumber: string;
  title: string;
  buyerId: Ulid;
  currency: string;
  status: RfqStatus;
  /** Sealed bids stay hidden from comparison views until the RFQ closes. */
  sealed: boolean;
  responseDeadline: IsoDate;
  questionsDeadline?: IsoDate;
  incoterm: Incoterm;
  paymentTermsDays: number;
  deliveryLocation: string;
  evaluationWeights: EvaluationWeights;
  lines: RfqLine[];
  invitations: RfqInvitation[];
  awards: LineAward[];
  requisitionIds: Ulid[];
  revision: number;
  scopeNotes?: string;
  issuedAt?: IsoDateTime;
  closedAt?: IsoDateTime;
  awardedAt?: IsoDateTime;
  cancellationReason?: string;
  amendmentLog: Array<{ revision: number; note: string; at: IsoDateTime }>;
}

export type RequestForQuoteView = EntityProps &
  RequestForQuoteProps & {
    respondedCount: number;
    awardedLineNumbers: readonly number[];
  };

/**
 * Request for quote (sourcing event).
 *
 *   draft → issued → closed → awarded
 *
 * Issuing freezes the scope: further changes bump `revision` and are recorded
 * in the amendment log so invited suppliers can be re-notified.
 */
export class RequestForQuote extends AggregateRoot<RequestForQuoteProps> {
  private constructor(tenantId: TenantId, props: RequestForQuoteProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      rfqNumber: string;
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
    },
  ): RequestForQuote {
    if (input.questionsDeadline && compareDates(input.questionsDeadline, input.responseDeadline) > 0) {
      throw ValidationError.single(
        "questionsDeadline",
        `${input.questionsDeadline} must not fall after the response deadline ${input.responseDeadline}`,
      );
    }
    const rfq = new RequestForQuote(tenantId, {
      rfqNumber: input.rfqNumber,
      title: requiredText(input.title, "title", 3, 200),
      buyerId: input.buyerId,
      currency: currencyCode(input.currency),
      status: "draft",
      sealed: input.sealed ?? true,
      responseDeadline: input.responseDeadline,
      questionsDeadline: input.questionsDeadline,
      incoterm: incoterm(input.incoterm ?? "DAP"),
      paymentTermsDays: validPaymentTerms(input.paymentTermsDays ?? 30),
      deliveryLocation: requiredText(input.deliveryLocation, "deliveryLocation", 2, 200),
      evaluationWeights: evaluationWeights(input.evaluationWeights ?? {}),
      lines: [],
      invitations: [],
      awards: [],
      requisitionIds: [...(input.requisitionIds ?? [])],
      revision: 0,
      scopeNotes: input.scopeNotes,
      amendmentLog: [],
    });
    for (const line of input.lines ?? []) rfq.addLine(line);
    rfq.raise(
      envelope({
        eventType: ProcurementEvents.RfqCreated,
        aggregateType: "RequestForQuote",
        aggregateId: rfq.id,
        tenantId,
        payload: {
          rfqId: rfq.id,
          rfqNumber: rfq.props.rfqNumber,
          buyerId: input.buyerId,
          currency: rfq.props.currency,
          responseDeadline: rfq.props.responseDeadline,
        },
      }),
    );
    return rfq;
  }

  get rfqNumber(): string {
    return this.props.rfqNumber;
  }
  get title(): string {
    return this.props.title;
  }
  get buyerId(): Ulid {
    return this.props.buyerId;
  }
  get currency(): string {
    return this.props.currency;
  }
  get status(): RfqStatus {
    return this.props.status;
  }
  get sealed(): boolean {
    return this.props.sealed;
  }
  get responseDeadline(): IsoDate {
    return this.props.responseDeadline;
  }
  get incoterm(): Incoterm {
    return this.props.incoterm;
  }
  get paymentTermsDays(): number {
    return this.props.paymentTermsDays;
  }
  get deliveryLocation(): string {
    return this.props.deliveryLocation;
  }
  get weights(): EvaluationWeights {
    return this.props.evaluationWeights;
  }
  get lines(): readonly RfqLine[] {
    return this.props.lines;
  }
  get invitations(): readonly RfqInvitation[] {
    return this.props.invitations;
  }
  get awards(): readonly LineAward[] {
    return this.props.awards;
  }
  get requisitionIds(): readonly Ulid[] {
    return this.props.requisitionIds;
  }
  get revision(): number {
    return this.props.revision;
  }

  get respondedCount(): number {
    return this.props.invitations.filter((invitation) => invitation.status === "responded").length;
  }

  get awardedLineNumbers(): readonly number[] {
    return this.props.awards.flatMap((award) => award.lineNumbers).sort((a, b) => a - b);
  }

  line(lineNumber: number): RfqLine {
    const found = this.props.lines.find((line) => line.lineNumber === lineNumber);
    if (!found) {
      throw ValidationError.single("lineNumber", `${lineNumber} is not a line of ${this.props.rfqNumber}`);
    }
    return found;
  }

  isInvited(supplierId: Ulid): boolean {
    return this.props.invitations.some((invitation) => invitation.supplierId === supplierId);
  }

  invitation(supplierId: Ulid): RfqInvitation {
    const found = this.props.invitations.find((invite) => invite.supplierId === supplierId);
    if (!found) {
      throw ValidationError.single("supplierId", `is not invited to ${this.props.rfqNumber}`);
    }
    return found;
  }

  /** Deadline handling is date-based: quotes are accepted up to end of day. */
  isOpenForQuotes(today: IsoDate): boolean {
    return this.props.status === "issued" && compareDates(today, this.props.responseDeadline) <= 0;
  }

  addLine(input: RfqLineInput): RfqLine {
    this.assertStatus("add a line to", ["draft"]);
    if (this.props.lines.length >= 200) {
      throw ValidationError.single("lines", "an RFQ may not exceed 200 lines");
    }
    const line = new RfqLine(this.nextLineNumber(), input);
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  removeLine(lineNumber: number): void {
    this.assertStatus("remove a line from", ["draft"]);
    const index = this.props.lines.findIndex((line) => line.lineNumber === lineNumber);
    if (index < 0) {
      throw ValidationError.single("lineNumber", `${lineNumber} is not a line of ${this.props.rfqNumber}`);
    }
    this.props.lines.splice(index, 1);
    this.touch();
  }

  inviteSupplier(supplierId: Ulid): RfqInvitation {
    this.assertStatus("invite a supplier to", ["draft", "issued"]);
    if (this.isInvited(supplierId)) {
      throw ValidationError.single("supplierId", `is already invited to ${this.props.rfqNumber}`);
    }
    const invitation: RfqInvitation = {
      supplierId,
      invitedAt: nowIso(),
      status: "invited",
    };
    this.props.invitations.push(invitation);
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqSupplierInvited,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rfqId: this.id,
          rfqNumber: this.props.rfqNumber,
          supplierId,
          responseDeadline: this.props.responseDeadline,
          issued: this.props.status === "issued",
        },
      }),
    );
    return invitation;
  }

  issue(today: IsoDate): void {
    this.assertStatus("issue", ["draft"]);
    if (this.props.lines.length === 0) {
      throw ValidationError.single("lines", "an RFQ needs at least one line before issue");
    }
    if (this.props.invitations.length < 1) {
      throw ValidationError.single("invitations", "invite at least one supplier before issuing");
    }
    if (compareDates(this.props.responseDeadline, today) < 0) {
      throw ValidationError.single(
        "responseDeadline",
        `${this.props.responseDeadline} is in the past (today is ${today})`,
      );
    }
    this.props.status = "issued";
    this.props.issuedAt = nowIso();
    this.props.revision = 1;
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqIssued,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rfqId: this.id,
          rfqNumber: this.props.rfqNumber,
          supplierIds: this.props.invitations.map((invite) => invite.supplierId),
          lineCount: this.props.lines.length,
          responseDeadline: this.props.responseDeadline,
          sealed: this.props.sealed,
        },
      }),
    );
  }

  /** Post-issue scope change: bumps the revision and notifies bidders. */
  amend(note: string, changes?: { scopeNotes?: string; deliveryLocation?: string; incoterm?: string }): void {
    this.assertStatus("amend", ["issued"]);
    const amendmentNote = requiredText(note, "note", 5, 500);
    if (changes?.scopeNotes !== undefined) this.props.scopeNotes = changes.scopeNotes;
    if (changes?.deliveryLocation !== undefined) {
      this.props.deliveryLocation = requiredText(changes.deliveryLocation, "deliveryLocation", 2, 200);
    }
    if (changes?.incoterm !== undefined) this.props.incoterm = incoterm(changes.incoterm);
    this.props.revision += 1;
    this.props.amendmentLog.push({ revision: this.props.revision, note: amendmentNote, at: nowIso() });
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqAmended,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rfqId: this.id,
          rfqNumber: this.props.rfqNumber,
          revision: this.props.revision,
          note: amendmentNote,
          supplierIds: this.props.invitations.map((invite) => invite.supplierId),
        },
      }),
    );
  }

  extendDeadline(newDeadline: IsoDate, reason: string): void {
    this.assertStatus("extend the deadline of", ["issued"]);
    if (compareDates(newDeadline, this.props.responseDeadline) <= 0) {
      throw ValidationError.single(
        "responseDeadline",
        `${newDeadline} must be later than the current deadline ${this.props.responseDeadline}`,
      );
    }
    const previous = this.props.responseDeadline;
    this.props.responseDeadline = newDeadline;
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqDeadlineExtended,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rfqId: this.id,
          previousDeadline: previous,
          responseDeadline: newDeadline,
          reason: requiredText(reason, "reason", 3, 500),
          supplierIds: this.props.invitations.map((invite) => invite.supplierId),
        },
      }),
    );
  }

  recordDecline(supplierId: Ulid, reason: string): void {
    this.assertStatus("decline", ["issued"]);
    const invitation = this.invitation(supplierId);
    if (invitation.status === "responded") {
      throw new InvalidStateError(`Supplier ${supplierId} has already quoted ${this.props.rfqNumber}`);
    }
    invitation.status = "declined";
    invitation.declineReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqSupplierDeclined,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { rfqId: this.id, supplierId, reason: invitation.declineReason },
      }),
    );
  }

  recordResponse(supplierId: Ulid, quoteId: Ulid): void {
    const invitation = this.invitation(supplierId);
    invitation.status = "responded";
    invitation.quoteId = quoteId;
    invitation.respondedAt = nowIso();
    this.touch();
  }

  close(reason?: string): void {
    this.assertStatus("close", ["issued"]);
    this.props.status = "closed";
    this.props.closedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqClosed,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rfqId: this.id,
          rfqNumber: this.props.rfqNumber,
          responses: this.respondedCount,
          invited: this.props.invitations.length,
          reason,
        },
      }),
    );
  }

  /**
   * Awards lines to one or more quotes. Split awards are normal (cheapest
   * supplier per line), so every line may be awarded at most once and lines
   * left unawarded simply return to the requisition for re-sourcing.
   */
  award(awards: readonly LineAward[], awardedValueByQuote: ReadonlyMap<Ulid, number>): void {
    this.assertStatus("award", ["closed", "issued"]);
    if (awards.length === 0) {
      throw ValidationError.single("awards", "at least one award is required");
    }
    const seen = new Set<number>();
    for (const award of awards) {
      if (award.lineNumbers.length === 0) {
        throw ValidationError.single("lineNumbers", "an award must cover at least one line");
      }
      for (const lineNumber of award.lineNumbers) {
        if (seen.has(lineNumber)) {
          throw ValidationError.single("lineNumbers", `line ${lineNumber} is awarded more than once`);
        }
        seen.add(lineNumber);
        const line = this.line(lineNumber);
        line.awardedQuoteId = award.quoteId;
        line.awardedSupplierId = award.supplierId;
      }
      this.props.awards.push(award);
    }
    this.props.status = "awarded";
    this.props.awardedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqAwarded,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rfqId: this.id,
          rfqNumber: this.props.rfqNumber,
          awards: awards.map((award) => ({
            quoteId: award.quoteId,
            supplierId: award.supplierId,
            lineNumbers: [...award.lineNumbers],
            awardedValueMinor: awardedValueByQuote.get(award.quoteId) ?? 0,
            currency: this.props.currency,
          })),
          unawardedLineNumbers: this.props.lines
            .filter((line) => line.awardedQuoteId === undefined)
            .map((line) => line.lineNumber),
        },
      }),
    );
  }

  cancel(reason: string): void {
    if (this.props.status === "awarded" || this.props.status === "cancelled") {
      throw InvalidStateError.transition("RFQ", "cancel", this.props.status);
    }
    this.props.status = "cancelled";
    this.props.cancellationReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.RfqCancelled,
        aggregateType: "RequestForQuote",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rfqId: this.id,
          rfqNumber: this.props.rfqNumber,
          reason: this.props.cancellationReason,
          supplierIds: this.props.invitations.map((invite) => invite.supplierId),
        },
      }),
    );
  }

  toJSON(): RequestForQuoteView {
    return {
      ...super.toJSON(),
      respondedCount: this.respondedCount,
      awardedLineNumbers: this.awardedLineNumbers,
    };
  }

  private nextLineNumber(): number {
    return this.props.lines.reduce((max, line) => Math.max(max, line.lineNumber), 0) + 10;
  }

  private assertStatus(action: string, expected: readonly RfqStatus[]): void {
    if (!expected.includes(this.props.status)) {
      throw InvalidStateError.transition("RFQ", action, this.props.status, expected);
    }
  }
}

/** Weight helper for callers that think in percentages rather than bps. */
export function weightsFromPercent(input: {
  price: number;
  leadTime: number;
  quality: number;
  compliance: number;
}): EvaluationWeights {
  const toBps = (value: number): number => Math.round(value * 100);
  return evaluationWeights({
    priceBps: toBps(input.price),
    leadTimeBps: toBps(input.leadTime),
    qualityBps: toBps(input.quality),
    complianceBps: toBps(input.compliance),
  });
}
