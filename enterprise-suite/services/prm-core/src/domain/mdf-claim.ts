import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { isAfter, parseIso } from "./dates.js";
import {
  ClaimWindowError,
  InvalidStateError,
  SegregationOfDutiesError,
  ValidationError,
} from "./errors.js";
import { PrmEventTypes } from "./events.js";
import { assertSameCurrency, requirePositive, sum, zero } from "./money.js";

/**
 * MDF claim: the partner's reimbursement request against an approved fund
 * request, with proof of performance.
 *
 *   draft → submitted → in_review → approved → paid
 *                            \→ rejected
 *
 * Two rules carry most of the weight. First, the claim window: a claim filed
 * after `deadline` (activity end + the budget's claim window) is refused, which
 * is what lets a program close its books. Second, proof coverage: the
 * documented spend must cover the amount being claimed, so a partner cannot
 * claim 10k against a 2k invoice.
 */

export type ProofKind = "invoice" | "receipt" | "activity_report" | "attendee_list" | "screenshot" | "lead_export";

export const PROOF_KINDS: readonly ProofKind[] = [
  "invoice",
  "receipt",
  "activity_report",
  "attendee_list",
  "screenshot",
  "lead_export",
];

/** Proof kinds that count towards financial coverage of the claim. */
const FINANCIAL_PROOF_KINDS: readonly ProofKind[] = ["invoice", "receipt"];

export type MdfClaimStatus = "draft" | "submitted" | "in_review" | "approved" | "rejected" | "paid";

export const MDF_CLAIM_STATUSES: readonly MdfClaimStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "paid",
];

export interface ProofOfPerformance {
  readonly id: Ulid;
  readonly kind: ProofKind;
  readonly reference: string;
  readonly documentUrl?: string;
  /** Present for invoices and receipts; drives proof coverage. */
  readonly amount?: Money;
  readonly issuedAt?: IsoDateTime;
  readonly uploadedAt: IsoDateTime;
  readonly uploadedBy: UserId;
}

export interface MdfClaimProps {
  number: string;
  requestId: Ulid;
  partnerId: Ulid;
  budgetId: Ulid;
  allocationId: Ulid;
  currency: string;
  claimedAmount: Money;
  approvedAmount?: Money;
  status: MdfClaimStatus;
  proofs: ProofOfPerformance[];
  actualLeads?: number;
  actualPipeline?: Money;
  activitySummary?: string;
  submittedAt?: IsoDateTime;
  submittedBy?: UserId;
  reviewStartedAt?: IsoDateTime;
  reviewedBy?: UserId;
  decidedAt?: IsoDateTime;
  decisionNotes?: string;
  shortPayReason?: string;
  rejectionReason?: string;
  paymentReference?: string;
  paidAt?: IsoDateTime;
}

export interface CreateMdfClaimInput {
  readonly number: string;
  readonly requestId: Ulid;
  readonly partnerId: Ulid;
  readonly budgetId: Ulid;
  readonly allocationId: Ulid;
  readonly claimedAmount: Money;
  readonly activitySummary?: string;
  readonly actualLeads?: number;
  readonly actualPipeline?: Money;
}

export interface AddProofInput {
  readonly kind: ProofKind;
  readonly reference: string;
  readonly documentUrl?: string;
  readonly amount?: Money;
  readonly issuedAt?: IsoDateTime;
  readonly at: IsoDateTime;
  readonly by: UserId;
}

export class MdfClaim extends AggregateRoot<MdfClaimProps> {
  static create(tenantId: TenantId, input: CreateMdfClaimInput): MdfClaim {
    requirePositive(input.claimedAmount, "claimedAmount");
    if (input.actualLeads !== undefined && (!Number.isInteger(input.actualLeads) || input.actualLeads < 0)) {
      throw ValidationError.single("actualLeads", "must be a non-negative integer");
    }
    if (input.actualPipeline) assertSameCurrency(input.claimedAmount, input.actualPipeline);

    const claim = new MdfClaim(tenantId, {
      number: input.number,
      requestId: input.requestId,
      partnerId: input.partnerId,
      budgetId: input.budgetId,
      allocationId: input.allocationId,
      currency: input.claimedAmount.currency,
      claimedAmount: input.claimedAmount,
      status: "draft",
      proofs: [],
      actualLeads: input.actualLeads,
      actualPipeline: input.actualPipeline,
      activitySummary: input.activitySummary?.trim() || undefined,
    });
    claim.raise(claim.claimEvent(PrmEventTypes.MdfClaimCreated));
    return claim;
  }

  static fromSnapshot(snapshot: EntityProps & MdfClaimProps): MdfClaim {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new MdfClaim(tenantId, { ...props, proofs: [...props.proofs] }, { id, createdAt, updatedAt, version });
  }

  // --- accessors -------------------------------------------------------------

  get number(): string {
    return this.props.number;
  }
  get requestId(): Ulid {
    return this.props.requestId;
  }
  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get budgetId(): Ulid {
    return this.props.budgetId;
  }
  get allocationId(): Ulid {
    return this.props.allocationId;
  }
  get status(): MdfClaimStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get claimedAmount(): Money {
    return this.props.claimedAmount;
  }
  get approvedAmount(): Money | undefined {
    return this.props.approvedAmount;
  }
  get proofs(): readonly ProofOfPerformance[] {
    return this.props.proofs;
  }
  get submittedBy(): UserId | undefined {
    return this.props.submittedBy;
  }
  get paymentReference(): string | undefined {
    return this.props.paymentReference;
  }
  get paidAt(): IsoDateTime | undefined {
    return this.props.paidAt;
  }
  get shortPayReason(): string | undefined {
    return this.props.shortPayReason;
  }

  /** Documented spend: the total of invoice/receipt proof amounts. */
  documentedSpend(): Money {
    return sum(
      this.props.proofs
        .filter((p) => FINANCIAL_PROOF_KINDS.includes(p.kind) && p.amount !== undefined)
        .map((p) => p.amount!),
      this.props.currency,
    );
  }

  // --- drafting --------------------------------------------------------------

  addProof(input: AddProofInput): ProofOfPerformance {
    if (this.props.status !== "draft" && this.props.status !== "in_review") {
      throw new InvalidStateError(
        `Cannot attach proof: claim ${this.props.number} is ${this.props.status}` +
          (this.props.status === "submitted" ? " — a reviewer must open it first" : ""),
      );
    }
    if (!PROOF_KINDS.includes(input.kind)) {
      throw ValidationError.single("kind", `must be one of [${PROOF_KINDS.join(", ")}]`);
    }
    if (input.reference.trim().length === 0) throw ValidationError.single("reference", "is required");
    if (FINANCIAL_PROOF_KINDS.includes(input.kind)) {
      if (!input.amount) throw ValidationError.single("amount", `${input.kind} proof requires an amount`);
      requirePositive(input.amount, "amount");
      assertSameCurrency(this.props.claimedAmount, input.amount);
    }
    const reference = input.reference.trim();
    if (this.props.proofs.some((p) => p.kind === input.kind && p.reference === reference)) {
      throw new InvalidStateError(`Proof ${input.kind}/${reference} is already attached`);
    }
    const proof: ProofOfPerformance = {
      id: newId("proof"),
      kind: input.kind,
      reference,
      documentUrl: input.documentUrl?.trim() || undefined,
      amount: input.amount,
      issuedAt: input.issuedAt ? parseIso(input.issuedAt, "issuedAt") : undefined,
      uploadedAt: parseIso(input.at, "at"),
      uploadedBy: input.by,
    };
    this.props.proofs.push(proof);
    this.touch();
    return proof;
  }

  removeProof(proofId: Ulid): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`Proof can only be removed while the claim is a draft (${this.props.status})`);
    }
    const index = this.props.proofs.findIndex((p) => p.id === proofId);
    if (index === -1) throw new InvalidStateError(`Proof ${proofId} not found on claim ${this.props.number}`);
    this.props.proofs.splice(index, 1);
    this.touch();
  }

  updateResults(input: {
    readonly actualLeads?: number;
    readonly actualPipeline?: Money;
    readonly activitySummary?: string;
  }): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`Results can only be edited while the claim is a draft (${this.props.status})`);
    }
    if (input.actualLeads !== undefined) {
      if (!Number.isInteger(input.actualLeads) || input.actualLeads < 0) {
        throw ValidationError.single("actualLeads", "must be a non-negative integer");
      }
      this.props.actualLeads = input.actualLeads;
    }
    if (input.actualPipeline !== undefined) {
      assertSameCurrency(this.props.claimedAmount, input.actualPipeline);
      this.props.actualPipeline = input.actualPipeline;
    }
    if (input.activitySummary !== undefined) {
      this.props.activitySummary = input.activitySummary.trim() || undefined;
    }
    this.touch();
  }

  // --- workflow --------------------------------------------------------------

  /**
   * Files the claim. Refuses late claims and claims whose documented spend
   * does not cover the amount asked for.
   */
  submit(input: { readonly at: IsoDateTime; readonly by: UserId; readonly deadline: IsoDateTime }): void {
    this.assertStatus("draft", "submit");
    const at = parseIso(input.at, "at");
    if (isAfter(at, input.deadline)) {
      throw new ClaimWindowError(input.deadline, at);
    }
    const financialProofs = this.props.proofs.filter((p) => FINANCIAL_PROOF_KINDS.includes(p.kind));
    if (financialProofs.length === 0) {
      throw ValidationError.single("proofs", "at least one invoice or receipt is required");
    }
    if (!this.props.proofs.some((p) => !FINANCIAL_PROOF_KINDS.includes(p.kind))) {
      throw ValidationError.single(
        "proofs",
        "proof of performance (report, attendee list, lead export, ...) is required alongside the invoice",
      );
    }
    const documented = this.documentedSpend();
    if (documented.amountMinor < this.props.claimedAmount.amountMinor) {
      throw new InvalidStateError(
        `Documented spend ${documented.amountMinor} ${this.props.currency} does not cover the claimed ` +
          `${this.props.claimedAmount.amountMinor}`,
        { documented, claimed: this.props.claimedAmount },
      );
    }
    this.props.status = "submitted";
    this.props.submittedAt = at;
    this.props.submittedBy = input.by;
    this.raise(this.claimEvent(PrmEventTypes.MdfClaimSubmitted));
  }

  startReview(at: IsoDateTime, by: UserId): void {
    this.assertStatus("submitted", "start a review");
    if (this.props.submittedBy === by) {
      throw new SegregationOfDutiesError(`${by} submitted this claim and cannot review it`);
    }
    this.props.status = "in_review";
    this.props.reviewStartedAt = parseIso(at, "at");
    this.props.reviewedBy = by;
    this.raise(this.claimEvent(PrmEventTypes.MdfClaimReviewStarted));
  }

  /**
   * Approves the claim, possibly short-paying it. `cap` is the money still
   * claimable on the parent request; approving beyond it is refused here so
   * the ledger cannot be over-drawn even if the service layer slips.
   */
  approve(input: {
    readonly at: IsoDateTime;
    readonly by: UserId;
    readonly approvedAmount?: Money;
    readonly cap: Money;
    readonly notes?: string;
  }): Money {
    this.assertStatus("in_review", "approve");
    if (this.props.submittedBy === input.by) {
      throw new SegregationOfDutiesError(`${input.by} submitted this claim and cannot approve it`);
    }
    const approved = input.approvedAmount ?? this.props.claimedAmount;
    requirePositive(approved, "approvedAmount");
    assertSameCurrency(this.props.claimedAmount, approved);
    if (approved.amountMinor > this.props.claimedAmount.amountMinor) {
      throw ValidationError.single("approvedAmount", "cannot exceed the claimed amount");
    }
    assertSameCurrency(this.props.claimedAmount, input.cap);
    if (approved.amountMinor > input.cap.amountMinor) {
      throw new InvalidStateError(
        `Approving ${approved.amountMinor} would exceed the ${input.cap.amountMinor} ${this.props.currency} ` +
          "still claimable on the fund request",
        { cap: input.cap, approved },
      );
    }
    const shortPay = approved.amountMinor < this.props.claimedAmount.amountMinor;
    if (shortPay && !input.notes?.trim()) {
      throw ValidationError.single("notes", "a short-pay reason is required");
    }
    this.props.status = "approved";
    this.props.approvedAmount = approved;
    this.props.decidedAt = parseIso(input.at, "at");
    this.props.decisionNotes = input.notes?.trim() || undefined;
    this.props.shortPayReason = shortPay ? input.notes?.trim() : undefined;
    this.raise(
      envelope({
        eventType: PrmEventTypes.MdfClaimApproved,
        aggregateType: "MdfClaim",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          claimId: this.id,
          number: this.props.number,
          requestId: this.props.requestId,
          partnerId: this.props.partnerId,
          claimedAmount: this.props.claimedAmount,
          approvedAmount: approved,
          approvedBy: input.by,
          shortPayReason: this.props.shortPayReason,
        },
      }),
    );
    return approved;
  }

  reject(input: { readonly at: IsoDateTime; readonly by: UserId; readonly reason: string }): void {
    if (this.props.status !== "in_review" && this.props.status !== "submitted") {
      throw new InvalidStateError(`Claim ${this.props.number} is ${this.props.status} and cannot be rejected`);
    }
    if (this.props.submittedBy === input.by) {
      throw new SegregationOfDutiesError(`${input.by} submitted this claim and cannot reject it`);
    }
    if (input.reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.status = "rejected";
    this.props.decidedAt = parseIso(input.at, "at");
    this.props.reviewedBy = this.props.reviewedBy ?? input.by;
    this.props.rejectionReason = input.reason.trim();
    this.raise(this.claimEvent(PrmEventTypes.MdfClaimRejected));
  }

  pay(input: { readonly at: IsoDateTime; readonly reference: string }): Money {
    this.assertStatus("approved", "pay");
    if (input.reference.trim().length === 0) {
      throw ValidationError.single("reference", "a payment reference is required");
    }
    const amount = this.props.approvedAmount ?? zero(this.props.currency);
    this.props.status = "paid";
    this.props.paidAt = parseIso(input.at, "at");
    this.props.paymentReference = input.reference.trim();
    this.raise(
      envelope({
        eventType: PrmEventTypes.MdfClaimPaid,
        aggregateType: "MdfClaim",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          claimId: this.id,
          number: this.props.number,
          requestId: this.props.requestId,
          partnerId: this.props.partnerId,
          claimedAmount: this.props.claimedAmount,
          paidAmount: amount,
          paymentReference: this.props.paymentReference,
          paidAt: this.props.paidAt,
        },
      }),
    );
    return amount;
  }

  // --- internals -------------------------------------------------------------

  private claimEvent(eventType: string) {
    return envelope({
      eventType,
      aggregateType: "MdfClaim",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        claimId: this.id,
        number: this.props.number,
        requestId: this.props.requestId,
        partnerId: this.props.partnerId,
        claimedAmount: this.props.claimedAmount,
      },
    });
  }

  private assertStatus(expected: MdfClaimStatus, action: string): void {
    if (this.props.status !== expected) {
      throw new InvalidStateError(
        `Cannot ${action}: claim ${this.props.number} is ${this.props.status}, expected ${expected}`,
      );
    }
  }
}
