import {
  AggregateRoot,
  addMoney,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { addDays, assertOrderedRange, parseIso } from "./dates.js";
import { InvalidStateError, SegregationOfDutiesError, ValidationError } from "./errors.js";
import { PrmEventTypes } from "./events.js";
import { assertSameCurrency, applyBps, requirePositive, subtract, zero } from "./money.js";

/**
 * MDF fund request (pre-approval).
 *
 *   draft → submitted → approved → closed
 *              \            \→ (claims settle against it)
 *               \→ rejected
 *   draft/submitted → cancelled
 *
 * Approval is what *commits* budget money; the request then acts as the
 * spending envelope for one or more claims. Closing a request releases
 * whatever the partner did not claim back to the allocation.
 */

export type MdfActivityType =
  | "event"
  | "trade_show"
  | "digital_campaign"
  | "content_syndication"
  | "telemarketing"
  | "training"
  | "demo_equipment"
  | "market_research";

export const MDF_ACTIVITY_TYPES: readonly MdfActivityType[] = [
  "event",
  "trade_show",
  "digital_campaign",
  "content_syndication",
  "telemarketing",
  "training",
  "demo_equipment",
  "market_research",
];

export type MdfRequestStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled" | "closed";

export const MDF_REQUEST_STATUSES: readonly MdfRequestStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "closed",
];

export interface MdfRequestProps {
  number: string;
  partnerId: Ulid;
  budgetId: Ulid;
  allocationId: Ulid;
  activityType: MdfActivityType;
  title: string;
  description: string;
  activityStart: IsoDateTime;
  activityEnd: IsoDateTime;
  currency: string;
  requestedAmount: Money;
  /** Partner's own co-investment, derived from the budget matching rate. */
  partnerContribution: Money;
  expectedLeads: number;
  expectedPipeline?: Money;
  status: MdfRequestStatus;
  approvedAmount?: Money;
  /** Sum of claim amounts already approved against this request. */
  claimedAmount: Money;
  submittedAt?: IsoDateTime;
  submittedBy?: UserId;
  decidedAt?: IsoDateTime;
  decidedBy?: UserId;
  decisionNotes?: string;
  claimDeadline?: IsoDateTime;
  closedAt?: IsoDateTime;
  closedReason?: string;
  cancelledReason?: string;
}

export interface CreateMdfRequestInput {
  readonly number: string;
  readonly partnerId: Ulid;
  readonly budgetId: Ulid;
  readonly allocationId: Ulid;
  readonly activityType: MdfActivityType;
  readonly title: string;
  readonly description: string;
  readonly activityStart: IsoDateTime;
  readonly activityEnd: IsoDateTime;
  readonly requestedAmount: Money;
  readonly matchingRateBps: number;
  readonly expectedLeads?: number;
  readonly expectedPipeline?: Money;
}

export interface UpdateMdfRequestInput {
  readonly title?: string;
  readonly description?: string;
  readonly activityType?: MdfActivityType;
  readonly activityStart?: IsoDateTime;
  readonly activityEnd?: IsoDateTime;
  readonly requestedAmount?: Money;
  readonly expectedLeads?: number;
  readonly expectedPipeline?: Money;
}

export class MdfRequest extends AggregateRoot<MdfRequestProps> {
  static create(tenantId: TenantId, input: CreateMdfRequestInput): MdfRequest {
    if (!MDF_ACTIVITY_TYPES.includes(input.activityType)) {
      throw ValidationError.single("activityType", `must be one of [${MDF_ACTIVITY_TYPES.join(", ")}]`);
    }
    if (input.title.trim().length < 3) throw ValidationError.single("title", "must be at least 3 characters");
    if (input.description.trim().length < 10) {
      throw ValidationError.single("description", "describe the activity in at least 10 characters");
    }
    const activityStart = parseIso(input.activityStart, "activityStart");
    const activityEnd = parseIso(input.activityEnd, "activityEnd");
    assertOrderedRange(activityStart, activityEnd, "activityEnd");
    requirePositive(input.requestedAmount, "requestedAmount");
    const expectedLeads = input.expectedLeads ?? 0;
    if (!Number.isInteger(expectedLeads) || expectedLeads < 0) {
      throw ValidationError.single("expectedLeads", "must be a non-negative integer");
    }
    if (input.expectedPipeline) assertSameCurrency(input.requestedAmount, input.expectedPipeline);

    const request = new MdfRequest(tenantId, {
      number: input.number,
      partnerId: input.partnerId,
      budgetId: input.budgetId,
      allocationId: input.allocationId,
      activityType: input.activityType,
      title: input.title.trim(),
      description: input.description.trim(),
      activityStart,
      activityEnd,
      currency: input.requestedAmount.currency,
      requestedAmount: input.requestedAmount,
      partnerContribution: applyBps(input.requestedAmount, input.matchingRateBps),
      expectedLeads,
      expectedPipeline: input.expectedPipeline,
      status: "draft",
      claimedAmount: zero(input.requestedAmount.currency),
    });
    request.raise(request.requestEvent(PrmEventTypes.MdfRequestCreated));
    return request;
  }

  static fromSnapshot(snapshot: EntityProps & MdfRequestProps): MdfRequest {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new MdfRequest(tenantId, { ...props }, { id, createdAt, updatedAt, version });
  }

  // --- accessors -------------------------------------------------------------

  get number(): string {
    return this.props.number;
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
  get status(): MdfRequestStatus {
    return this.props.status;
  }
  get activityType(): MdfActivityType {
    return this.props.activityType;
  }
  get title(): string {
    return this.props.title;
  }
  get activityStart(): IsoDateTime {
    return this.props.activityStart;
  }
  get activityEnd(): IsoDateTime {
    return this.props.activityEnd;
  }
  get currency(): string {
    return this.props.currency;
  }
  get requestedAmount(): Money {
    return this.props.requestedAmount;
  }
  get approvedAmount(): Money | undefined {
    return this.props.approvedAmount;
  }
  get partnerContribution(): Money {
    return this.props.partnerContribution;
  }
  get claimedAmount(): Money {
    return this.props.claimedAmount;
  }
  get claimDeadline(): IsoDateTime | undefined {
    return this.props.claimDeadline;
  }
  get submittedBy(): UserId | undefined {
    return this.props.submittedBy;
  }
  get decidedBy(): UserId | undefined {
    return this.props.decidedBy;
  }

  /** Approved money not yet consumed by approved claims. */
  claimableRemaining(): Money {
    if (!this.props.approvedAmount) return zero(this.props.currency);
    return subtract(this.props.approvedAmount, this.props.claimedAmount);
  }

  // --- drafting --------------------------------------------------------------

  update(input: UpdateMdfRequestInput): void {
    this.assertStatus("draft", "edit the request");
    if (input.title !== undefined) {
      if (input.title.trim().length < 3) throw ValidationError.single("title", "must be at least 3 characters");
      this.props.title = input.title.trim();
    }
    if (input.description !== undefined) {
      if (input.description.trim().length < 10) {
        throw ValidationError.single("description", "describe the activity in at least 10 characters");
      }
      this.props.description = input.description.trim();
    }
    if (input.activityType !== undefined) {
      if (!MDF_ACTIVITY_TYPES.includes(input.activityType)) {
        throw ValidationError.single("activityType", `must be one of [${MDF_ACTIVITY_TYPES.join(", ")}]`);
      }
      this.props.activityType = input.activityType;
    }
    const start = input.activityStart ? parseIso(input.activityStart, "activityStart") : this.props.activityStart;
    const end = input.activityEnd ? parseIso(input.activityEnd, "activityEnd") : this.props.activityEnd;
    assertOrderedRange(start, end, "activityEnd");
    this.props.activityStart = start;
    this.props.activityEnd = end;
    if (input.requestedAmount !== undefined) {
      requirePositive(input.requestedAmount, "requestedAmount");
      assertSameCurrency(this.props.requestedAmount, input.requestedAmount);
      const rateBps =
        this.props.requestedAmount.amountMinor === 0
          ? 0
          : Math.round((this.props.partnerContribution.amountMinor * 10_000) / this.props.requestedAmount.amountMinor);
      this.props.requestedAmount = input.requestedAmount;
      this.props.partnerContribution = applyBps(input.requestedAmount, rateBps);
    }
    if (input.expectedLeads !== undefined) {
      if (!Number.isInteger(input.expectedLeads) || input.expectedLeads < 0) {
        throw ValidationError.single("expectedLeads", "must be a non-negative integer");
      }
      this.props.expectedLeads = input.expectedLeads;
    }
    if (input.expectedPipeline !== undefined) {
      assertSameCurrency(this.props.requestedAmount, input.expectedPipeline);
      this.props.expectedPipeline = input.expectedPipeline;
    }
    this.touch();
  }

  submit(at: IsoDateTime, by: UserId): void {
    this.assertStatus("draft", "submit");
    this.props.status = "submitted";
    this.props.submittedAt = parseIso(at, "at");
    this.props.submittedBy = by;
    this.raise(this.requestEvent(PrmEventTypes.MdfRequestSubmitted));
  }

  /**
   * Approves the request, optionally for less than asked. The claim deadline
   * is stamped here from the budget's claim window so later claims can be
   * judged against a value the partner saw at approval time.
   */
  approve(input: {
    readonly at: IsoDateTime;
    readonly by: UserId;
    readonly approvedAmount?: Money;
    readonly claimWindowDays: number;
    readonly notes?: string;
  }): Money {
    this.assertStatus("submitted", "approve");
    if (this.props.submittedBy === input.by) {
      throw new SegregationOfDutiesError(`${input.by} submitted this request and cannot approve it`);
    }
    const approved = input.approvedAmount ?? this.props.requestedAmount;
    requirePositive(approved, "approvedAmount");
    assertSameCurrency(this.props.requestedAmount, approved);
    if (approved.amountMinor > this.props.requestedAmount.amountMinor) {
      throw ValidationError.single("approvedAmount", "cannot exceed the requested amount");
    }
    if (approved.amountMinor < this.props.requestedAmount.amountMinor && !input.notes?.trim()) {
      throw ValidationError.single("notes", "explain why less than the requested amount was approved");
    }
    this.props.status = "approved";
    this.props.approvedAmount = approved;
    this.props.decidedAt = parseIso(input.at, "at");
    this.props.decidedBy = input.by;
    this.props.decisionNotes = input.notes?.trim() || undefined;
    this.props.claimDeadline = addDays(this.props.activityEnd, input.claimWindowDays);
    this.raise(
      envelope({
        eventType: PrmEventTypes.MdfRequestApproved,
        aggregateType: "MdfRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          requestId: this.id,
          number: this.props.number,
          partnerId: this.props.partnerId,
          budgetId: this.props.budgetId,
          activityType: this.props.activityType,
          requestedAmount: this.props.requestedAmount,
          approvedAmount: approved,
          approvedBy: input.by,
          claimDeadline: this.props.claimDeadline,
        },
      }),
    );
    return approved;
  }

  reject(input: { readonly at: IsoDateTime; readonly by: UserId; readonly reason: string }): void {
    this.assertStatus("submitted", "reject");
    if (this.props.submittedBy === input.by) {
      throw new SegregationOfDutiesError(`${input.by} submitted this request and cannot reject it`);
    }
    if (input.reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.status = "rejected";
    this.props.decidedAt = parseIso(input.at, "at");
    this.props.decidedBy = input.by;
    this.props.decisionNotes = input.reason.trim();
    this.raise(this.requestEvent(PrmEventTypes.MdfRequestRejected));
  }

  cancel(reason: string): void {
    if (this.props.status !== "draft" && this.props.status !== "submitted") {
      throw new InvalidStateError(`Request ${this.props.number} is ${this.props.status} and cannot be cancelled`);
    }
    if (reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.status = "cancelled";
    this.props.cancelledReason = reason.trim();
    this.raise(this.requestEvent(PrmEventTypes.MdfRequestCancelled));
  }

  /** Books an approved claim against the envelope. */
  recordClaimApproved(amount: Money): void {
    this.assertStatus("approved", "record a claim");
    requirePositive(amount, "amount");
    assertSameCurrency(this.props.claimedAmount, amount);
    const remaining = this.claimableRemaining();
    if (amount.amountMinor > remaining.amountMinor) {
      throw new InvalidStateError(
        `Claims would exceed the approved ${this.props.approvedAmount?.amountMinor} ${this.props.currency}`,
        { remaining, requested: amount },
      );
    }
    this.props.claimedAmount = addMoney(this.props.claimedAmount, amount);
    this.touch();
  }

  /** Reverses a previously booked claim (claim rejected after approval). */
  reverseClaim(amount: Money): void {
    requirePositive(amount, "amount");
    assertSameCurrency(this.props.claimedAmount, amount);
    if (amount.amountMinor > this.props.claimedAmount.amountMinor) {
      throw new InvalidStateError("Cannot reverse more than has been claimed");
    }
    this.props.claimedAmount = subtract(this.props.claimedAmount, amount);
    this.touch();
  }

  /** Ends the envelope; the caller releases the unclaimed remainder. */
  close(at: IsoDateTime, reason: string): Money {
    this.assertStatus("approved", "close");
    const remaining = this.claimableRemaining();
    this.props.status = "closed";
    this.props.closedAt = parseIso(at, "at");
    this.props.closedReason = reason.trim() || "closed";
    this.raise(this.requestEvent(PrmEventTypes.MdfRequestClosed));
    return remaining;
  }

  // --- internals -------------------------------------------------------------

  private requestEvent(eventType: string) {
    return envelope({
      eventType,
      aggregateType: "MdfRequest",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        requestId: this.id,
        number: this.props.number,
        partnerId: this.props.partnerId,
        budgetId: this.props.budgetId,
        activityType: this.props.activityType,
        requestedAmount: this.props.requestedAmount,
      },
    });
  }

  private assertStatus(expected: MdfRequestStatus, action: string): void {
    if (this.props.status !== expected) {
      throw new InvalidStateError(
        `Cannot ${action}: request ${this.props.number} is ${this.props.status}, expected ${expected}`,
      );
    }
  }
}
