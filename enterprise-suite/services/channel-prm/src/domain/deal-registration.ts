import {
  AggregateRoot,
  envelope,
  money,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError } from "./errors.js";
import { ChannelEventTypes } from "./events.js";
import { assertBps, assertPositiveMoney } from "./money-math.js";
import type { PartnerTier } from "./partner.js";
import {
  addDays,
  assertIso,
  describeWindow,
  extendWindow,
  hasLapsed,
  isProtectedAt,
  openWindow,
  remainingDays,
  truncateWindow,
  type ExtensionPolicy,
  type ProtectionSnapshot,
  type ProtectionWindow,
} from "./protection.js";
import {
  assertProbability,
  assertStageTransition,
  isTerminalStage,
  STAGE_DEFAULT_PROBABILITY,
  type ChannelStage,
} from "./stages.js";
import {
  customerKey,
  normalizeProductLines,
  validateEndCustomer,
  type CustomerKey,
  type EndCustomer,
} from "./territory.js";

/**
 * Deal registration — the core PRM aggregate.
 *
 *   draft ─submit→ submitted ─review→ under_review ─approve→ approved
 *                       │                  │                    ├─win→ closed_won
 *                       │                  └─reject→ rejected   ├─lose→ closed_lost
 *                       └─withdraw→ withdrawn                   └─expire→ expired
 *
 * Approval is what mints the protection window; everything downstream (special
 * pricing, conflict adjudication, sourced-revenue attribution) reads that
 * window rather than the status alone, because "approved" outlives the
 * exclusivity it granted.
 */

export type RegistrationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "expired"
  | "closed_won"
  | "closed_lost";

export const REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "withdrawn",
  "expired",
  "closed_won",
  "closed_lost",
];

/** Statuses that still occupy the customer/product-line space. */
export const ACTIVE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "submitted",
  "under_review",
  "approved",
];

export type DealSource = "partner_sourced" | "vendor_referred" | "co_sell";

export const DEAL_SOURCES: readonly DealSource[] = ["partner_sourced", "vendor_referred", "co_sell"];

export type RejectionReason =
  | "duplicate"
  | "house_account"
  | "insufficient_detail"
  | "out_of_territory"
  | "unauthorized_product_line"
  | "existing_pipeline"
  | "conflict_lost"
  | "partner_ineligible";

export const REJECTION_REASONS: readonly RejectionReason[] = [
  "duplicate",
  "house_account",
  "insufficient_detail",
  "out_of_territory",
  "unauthorized_product_line",
  "existing_pipeline",
  "conflict_lost",
  "partner_ineligible",
];

export type LossReason = "price" | "competitor" | "no_decision" | "timing" | "requirements" | "budget" | "other";

export const LOSS_REASONS: readonly LossReason[] = [
  "price",
  "competitor",
  "no_decision",
  "timing",
  "requirements",
  "budget",
  "other",
];

export interface RegistrationDecision {
  readonly by: UserId;
  readonly at: IsoDateTime;
  readonly notes?: string;
}

export interface RegistrationApproval extends RegistrationDecision {
  readonly autoApproved: boolean;
  readonly protectionDays: number;
  readonly discountBps: number;
}

export interface RegistrationRejection extends RegistrationDecision {
  readonly reasonCode: RejectionReason;
}

export interface RegistrationClosure extends RegistrationDecision {
  readonly value: Money;
  readonly reason?: LossReason;
  readonly competitor?: string;
}

export interface DocumentLink {
  readonly id: Ulid;
  readonly number: string;
  readonly linkedAt: IsoDateTime;
  readonly value?: Money;
}

/** Append-only audit trail surfaced in the partner portal. */
export interface TimelineEntry {
  readonly at: IsoDateTime;
  readonly actor: UserId;
  readonly action: string;
  readonly detail?: string;
}

export interface DealRegistrationProps {
  number: string;
  partnerId: Ulid;
  /** Tier snapshot taken at approval — later tier moves must not rewrite history. */
  tierAtApproval?: PartnerTier;
  endCustomer: EndCustomer;
  customerKey: CustomerKey;
  productLines: string[];
  source: DealSource;
  estimatedValue: Money;
  expectedCloseDate: IsoDateTime;
  stage: ChannelStage;
  probability: number;
  description?: string;
  competitors: string[];
  status: RegistrationStatus;
  protection?: ProtectionWindow;
  discountBps?: number;
  submittedAt?: IsoDateTime;
  submittedBy?: UserId;
  slaDueAt?: IsoDateTime;
  reviewStartedAt?: IsoDateTime;
  reviewerId?: UserId;
  approval?: RegistrationApproval;
  rejection?: RegistrationRejection;
  closure?: RegistrationClosure;
  withdrawnReason?: string;
  expiredAt?: IsoDateTime;
  /** Set once a protection-expiring warning has been emitted. */
  expiryWarnedAt?: IsoDateTime;
  quotes: DocumentLink[];
  orders: DocumentLink[];
  conflictCaseIds: Ulid[];
  /** Referral this registration was converted from, when applicable. */
  referralId?: Ulid;
  timeline: TimelineEntry[];
}

export interface CreateRegistrationInput {
  readonly number: string;
  readonly partnerId: Ulid;
  readonly endCustomer: EndCustomer;
  readonly productLines: readonly string[];
  readonly estimatedValue: Money;
  readonly expectedCloseDate: IsoDateTime;
  readonly source?: DealSource;
  readonly stage?: ChannelStage;
  readonly probability?: number;
  readonly description?: string;
  readonly competitors?: readonly string[];
  readonly referralId?: Ulid;
  readonly createdBy: UserId;
  readonly createdAt: IsoDateTime;
}

export interface ApproveInput {
  readonly by: UserId;
  readonly at: IsoDateTime;
  readonly protectionDays: number;
  readonly discountBps: number;
  readonly tier: PartnerTier;
  readonly autoApproved?: boolean;
  readonly notes?: string;
}

export class DealRegistration extends AggregateRoot<DealRegistrationProps> {
  static create(tenantId: TenantId, input: CreateRegistrationInput): DealRegistration {
    const endCustomer = validateEndCustomer(input.endCustomer);
    const productLines = normalizeProductLines(input.productLines);
    assertPositiveMoney(input.estimatedValue, "estimatedValue");
    const expectedCloseDate = assertIso(input.expectedCloseDate, "expectedCloseDate");
    if (Date.parse(expectedCloseDate) <= Date.parse(input.createdAt)) {
      throw ValidationError.single("expectedCloseDate", "must be in the future");
    }
    const source = input.source ?? "partner_sourced";
    if (!DEAL_SOURCES.includes(source)) {
      throw ValidationError.single("source", `must be one of [${DEAL_SOURCES.join(", ")}]`);
    }
    const stage = input.stage ?? "qualified";
    if (isTerminalStage(stage)) {
      throw ValidationError.single("stage", "a new registration cannot start in a closed stage");
    }

    const registration = new DealRegistration(tenantId, {
      number: input.number,
      partnerId: input.partnerId,
      endCustomer,
      customerKey: customerKey(endCustomer),
      productLines,
      source,
      estimatedValue: input.estimatedValue,
      expectedCloseDate,
      stage,
      probability: assertProbability(input.probability ?? STAGE_DEFAULT_PROBABILITY[stage]),
      description: input.description?.trim() || undefined,
      competitors: [...new Set((input.competitors ?? []).map((c) => c.trim()).filter(Boolean))],
      status: "draft",
      quotes: [],
      orders: [],
      conflictCaseIds: [],
      referralId: input.referralId,
      timeline: [{ at: input.createdAt, actor: input.createdBy, action: "created" }],
    });
    registration.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationCreated,
        aggregateType: "DealRegistration",
        aggregateId: registration.id,
        tenantId,
        payload: {
          registrationId: registration.id,
          number: registration.props.number,
          partnerId: registration.props.partnerId,
          customerKey: registration.props.customerKey,
          customerName: endCustomer.name,
          country: endCustomer.country,
          productLines,
          estimatedValue: input.estimatedValue,
          expectedCloseDate,
          source,
        },
      }),
    );
    return registration;
  }

  static fromSnapshot(snapshot: EntityProps & DealRegistrationProps): DealRegistration {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new DealRegistration(
      tenantId,
      {
        ...props,
        productLines: [...props.productLines],
        competitors: [...props.competitors],
        quotes: [...props.quotes],
        orders: [...props.orders],
        conflictCaseIds: [...props.conflictCaseIds],
        timeline: [...props.timeline],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get number(): string {
    return this.props.number;
  }
  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get status(): RegistrationStatus {
    return this.props.status;
  }
  get customerKey(): CustomerKey {
    return this.props.customerKey;
  }
  get endCustomer(): EndCustomer {
    return this.props.endCustomer;
  }
  get productLines(): readonly string[] {
    return this.props.productLines;
  }
  get estimatedValue(): Money {
    return this.props.estimatedValue;
  }
  get expectedCloseDate(): IsoDateTime {
    return this.props.expectedCloseDate;
  }
  get stage(): ChannelStage {
    return this.props.stage;
  }
  get probability(): number {
    return this.props.probability;
  }
  get source(): DealSource {
    return this.props.source;
  }
  get protection(): ProtectionWindow | undefined {
    return this.props.protection;
  }
  get discountBps(): number {
    return this.props.discountBps ?? 0;
  }
  get approval(): RegistrationApproval | undefined {
    return this.props.approval;
  }
  get rejection(): RegistrationRejection | undefined {
    return this.props.rejection;
  }
  get closure(): RegistrationClosure | undefined {
    return this.props.closure;
  }
  get submittedAt(): IsoDateTime | undefined {
    return this.props.submittedAt;
  }
  get slaDueAt(): IsoDateTime | undefined {
    return this.props.slaDueAt;
  }
  get quotes(): readonly DocumentLink[] {
    return this.props.quotes;
  }
  get orders(): readonly DocumentLink[] {
    return this.props.orders;
  }
  get conflictCaseIds(): readonly Ulid[] {
    return this.props.conflictCaseIds;
  }
  get referralId(): Ulid | undefined {
    return this.props.referralId;
  }
  get timeline(): readonly TimelineEntry[] {
    return this.props.timeline;
  }
  get tierAtApproval(): PartnerTier | undefined {
    return this.props.tierAtApproval;
  }
  get expiryWarnedAt(): IsoDateTime | undefined {
    return this.props.expiryWarnedAt;
  }

  /** True while the registration holds exclusivity at `at`. */
  isProtectedAt(at: IsoDateTime): boolean {
    if (!this.props.protection) return false;
    if (this.props.status !== "approved" && this.props.status !== "closed_won") return false;
    return isProtectedAt(this.props.protection, at);
  }

  protectionSnapshot(at: IsoDateTime): ProtectionSnapshot | undefined {
    return this.props.protection ? describeWindow(this.props.protection, at) : undefined;
  }

  /** Days from submission to close; the channel team's cycle-time metric. */
  cycleDays(): number | undefined {
    const start = this.props.submittedAt ?? this.createdAt;
    const end = this.props.closure?.at;
    if (!end) return undefined;
    return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000));
  }

  isOpen(): boolean {
    return (ACTIVE_REGISTRATION_STATUSES as readonly string[]).includes(this.props.status);
  }

  // --- commands ------------------------------------------------------------

  /**
   * Edits the deal body. Product lines and the end customer are frozen once
   * submitted: they define the protected space and conflict findings already
   * reference them.
   */
  updateDetails(
    input: {
      readonly estimatedValue?: Money;
      readonly expectedCloseDate?: IsoDateTime;
      readonly description?: string;
      readonly competitors?: readonly string[];
      readonly productLines?: readonly string[];
    },
    actor: UserId,
    at: IsoDateTime,
  ): void {
    this.assertMutable("update details");
    if (input.productLines) {
      if (this.props.status !== "draft") {
        throw new InvalidStateError(
          `Product lines are frozen once ${this.props.number} is submitted; withdraw and re-register instead`,
        );
      }
      this.props.productLines = normalizeProductLines(input.productLines);
    }
    if (input.estimatedValue) {
      this.props.estimatedValue = assertPositiveMoney(input.estimatedValue, "estimatedValue");
    }
    if (input.expectedCloseDate) {
      this.props.expectedCloseDate = assertIso(input.expectedCloseDate, "expectedCloseDate");
    }
    if (input.description !== undefined) {
      this.props.description = input.description.trim() || undefined;
    }
    if (input.competitors) {
      this.props.competitors = [...new Set(input.competitors.map((c) => c.trim()).filter(Boolean))];
    }
    this.log(at, actor, "details-updated");
  }

  submit(by: UserId, at: IsoDateTime, approvalSlaHours: number): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`${this.props.number} is ${this.props.status}; only drafts can be submitted`);
    }
    if (!this.props.description || this.props.description.length < 20) {
      throw ValidationError.single(
        "description",
        "at least 20 characters describing the opportunity are required before submission",
      );
    }
    this.props.status = "submitted";
    this.props.submittedAt = at;
    this.props.submittedBy = by;
    this.props.slaDueAt = addDays(at, approvalSlaHours / 24);
    this.log(at, by, "submitted");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationSubmitted,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: this.basePayload(),
      }),
    );
  }

  startReview(by: UserId, at: IsoDateTime): void {
    if (this.props.status !== "submitted") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; only submitted registrations enter review`,
      );
    }
    this.props.status = "under_review";
    this.props.reviewStartedAt = at;
    this.props.reviewerId = by;
    this.log(at, by, "review-started");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationReviewStarted,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: this.basePayload(),
      }),
    );
  }

  approve(input: ApproveInput): void {
    if (this.props.status !== "submitted" && this.props.status !== "under_review") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; only submitted or in-review registrations can be approved`,
      );
    }
    assertBps(input.discountBps, "discountBps");
    const window = openWindow(input.at, input.protectionDays);
    this.props.status = "approved";
    this.props.protection = window;
    this.props.discountBps = input.discountBps;
    this.props.tierAtApproval = input.tier;
    this.props.approval = {
      by: input.by,
      at: input.at,
      notes: input.notes?.trim() || undefined,
      autoApproved: input.autoApproved ?? false,
      protectionDays: input.protectionDays,
      discountBps: input.discountBps,
    };
    this.log(input.at, input.by, input.autoApproved ? "auto-approved" : "approved", `${input.protectionDays}d protection`);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationApproved,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          approvedBy: input.by,
          protectionStartsAt: window.startsAt,
          protectionEndsAt: window.endsAt,
          protectionDays: input.protectionDays,
          discountBps: input.discountBps,
          autoApproved: input.autoApproved ?? false,
        },
      }),
    );
  }

  reject(input: { by: UserId; at: IsoDateTime; reasonCode: RejectionReason; notes?: string }): void {
    if (this.props.status !== "submitted" && this.props.status !== "under_review") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; only submitted or in-review registrations can be rejected`,
      );
    }
    if (!REJECTION_REASONS.includes(input.reasonCode)) {
      throw ValidationError.single("reasonCode", `must be one of [${REJECTION_REASONS.join(", ")}]`);
    }
    this.props.status = "rejected";
    this.props.rejection = {
      by: input.by,
      at: input.at,
      reasonCode: input.reasonCode,
      notes: input.notes?.trim() || undefined,
    };
    this.log(input.at, input.by, "rejected", input.reasonCode);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationRejected,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          rejectedBy: input.by,
          reasonCode: input.reasonCode,
          notes: input.notes?.trim(),
        },
      }),
    );
  }

  withdraw(by: UserId, at: IsoDateTime, reason: string): void {
    if (!["draft", "submitted", "under_review", "approved"].includes(this.props.status)) {
      throw new InvalidStateError(`${this.props.number} is ${this.props.status} and cannot be withdrawn`);
    }
    if (reason.trim().length === 0) throw ValidationError.single("reason", "a withdrawal reason is required");
    this.props.status = "withdrawn";
    this.props.withdrawnReason = reason.trim();
    // Withdrawing releases the customer/product-line space immediately.
    if (this.props.protection) {
      this.props.protection = truncateWindow(this.props.protection, at);
    }
    this.log(at, by, "withdrawn", reason.trim());
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationWithdrawn,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), reason: reason.trim() },
      }),
    );
  }

  updateForecast(
    input: {
      readonly stage?: ChannelStage;
      readonly probability?: number;
      readonly estimatedValue?: Money;
      readonly expectedCloseDate?: IsoDateTime;
    },
    actor: UserId,
    at: IsoDateTime,
  ): void {
    this.assertMutable("update the forecast");
    const previousStage = this.props.stage;
    if (input.stage) {
      if (isTerminalStage(input.stage)) {
        throw new InvalidStateError("Use win/lose to close a registration, not a forecast update");
      }
      assertStageTransition(previousStage, input.stage);
      this.props.stage = input.stage;
      // A stage move resets probability to the stage default unless overridden.
      this.props.probability = STAGE_DEFAULT_PROBABILITY[input.stage];
    }
    if (input.probability !== undefined) {
      this.props.probability = assertProbability(input.probability);
    }
    if (input.estimatedValue) {
      this.props.estimatedValue = assertPositiveMoney(input.estimatedValue, "estimatedValue");
    }
    if (input.expectedCloseDate) {
      this.props.expectedCloseDate = assertIso(input.expectedCloseDate, "expectedCloseDate");
    }
    this.log(at, actor, "forecast-updated", `${previousStage} -> ${this.props.stage} @ ${this.props.probability}%`);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationForecastUpdated,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          stage: this.props.stage,
          previousStage,
          probability: this.props.probability,
          estimatedValue: this.props.estimatedValue,
          expectedCloseDate: this.props.expectedCloseDate,
        },
      }),
    );
  }

  extendProtection(input: {
    days: number;
    reason: string;
    by: UserId;
    at: IsoDateTime;
    policy: ExtensionPolicy;
  }): void {
    if (this.props.status !== "approved") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; only an approved registration holds protection`,
      );
    }
    const current = this.props.protection;
    if (!current) throw new InvalidStateError(`${this.props.number} has no protection window`);
    const previousEndsAt = current.endsAt;
    this.props.protection = extendWindow(current, {
      days: input.days,
      reason: input.reason,
      grantedBy: input.by,
      grantedAt: input.at,
      policy: input.policy,
    });
    // A fresh window means the earlier "about to lapse" warning is stale.
    this.props.expiryWarnedAt = undefined;
    this.log(input.at, input.by, "protection-extended", `+${input.days}d`);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationProtectionExtended,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          previousEndsAt,
          endsAt: this.props.protection.endsAt,
          days: input.days,
          reason: input.reason.trim(),
          grantedBy: input.by,
        },
      }),
    );
  }

  /** Cuts protection short — used when a conflict is decided against the holder. */
  truncateProtection(endsAt: IsoDateTime, reason: string, by: UserId, at: IsoDateTime): void {
    const current = this.props.protection;
    if (!current) throw new InvalidStateError(`${this.props.number} has no protection window`);
    const previousEndsAt = current.endsAt;
    this.props.protection = truncateWindow(current, endsAt);
    this.log(at, by, "protection-truncated", reason);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationProtectionTruncated,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          previousEndsAt,
          endsAt: this.props.protection.endsAt,
          days: 0,
          reason,
          grantedBy: by,
        },
      }),
    );
  }

  /**
   * Emits a single "about to lapse" warning per window. Returns false when the
   * warning was already sent or the deal is outside the notice period, so the
   * sweep stays idempotent.
   */
  warnExpiring(at: IsoDateTime, noticeDays: number): boolean {
    if (this.props.status !== "approved" || !this.props.protection) return false;
    if (this.props.expiryWarnedAt) return false;
    const left = remainingDays(this.props.protection, at);
    if (left === 0 || left > noticeDays) return false;
    this.props.expiryWarnedAt = at;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationProtectionExpiring,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          endsAt: this.props.protection.endsAt,
          remainingDays: left,
          stage: this.props.stage,
        },
      }),
    );
    return true;
  }

  /** Lapses an approved registration whose window ran out. Idempotent-safe. */
  expire(at: IsoDateTime): boolean {
    if (this.props.status !== "approved" || !this.props.protection) return false;
    if (!hasLapsed(this.props.protection, at)) return false;
    this.props.status = "expired";
    this.props.expiredAt = at;
    this.log(at, "system" as UserId, "expired");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationExpired,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), endsAt: this.props.protection.endsAt },
      }),
    );
    return true;
  }

  markWon(input: { by: UserId; at: IsoDateTime; value: Money; reason?: string }): void {
    if (this.props.status !== "approved") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; only an approved registration can be won`,
      );
    }
    assertPositiveMoney(input.value, "value");
    if (input.value.currency !== this.props.estimatedValue.currency) {
      throw ValidationError.single(
        "value",
        `must be in ${this.props.estimatedValue.currency}, the currency the deal was registered in`,
      );
    }
    this.props.status = "closed_won";
    this.props.stage = "closed_won";
    this.props.probability = 100;
    this.props.closure = { by: input.by, at: input.at, value: input.value, notes: input.reason?.trim() };
    this.log(input.at, input.by, "won");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationWon,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          closedBy: input.by,
          value: input.value,
          cycleDays: this.cycleDays() ?? 0,
        },
      }),
    );
  }

  markLost(input: { by: UserId; at: IsoDateTime; reason: LossReason; competitor?: string; notes?: string }): void {
    if (this.props.status !== "approved") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; only an approved registration can be lost`,
      );
    }
    if (!LOSS_REASONS.includes(input.reason)) {
      throw ValidationError.single("reason", `must be one of [${LOSS_REASONS.join(", ")}]`);
    }
    if (input.reason === "competitor" && !input.competitor?.trim()) {
      throw ValidationError.single("competitor", "name the competitor when the loss reason is 'competitor'");
    }
    this.props.status = "closed_lost";
    this.props.stage = "closed_lost";
    this.props.probability = 0;
    this.props.closure = {
      by: input.by,
      at: input.at,
      value: money(0, this.props.estimatedValue.currency),
      reason: input.reason,
      competitor: input.competitor?.trim(),
      notes: input.notes?.trim(),
    };
    // A lost deal stops holding the space.
    if (this.props.protection) {
      this.props.protection = truncateWindow(this.props.protection, input.at);
    }
    this.log(input.at, input.by, "lost", input.reason);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationLost,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          closedBy: input.by,
          value: this.props.closure.value,
          reason: input.reason,
          competitor: input.competitor?.trim(),
          cycleDays: this.cycleDays() ?? 0,
        },
      }),
    );
  }

  linkQuote(link: DocumentLink): void {
    if (!this.isOpen() && this.props.status !== "closed_won") {
      throw new InvalidStateError(`${this.props.number} is ${this.props.status}; quotes cannot be attached`);
    }
    if (this.props.quotes.some((q) => q.id === link.id)) return;
    this.props.quotes.push(link);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationQuoteLinked,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), linkedId: link.id, linkedNumber: link.number, value: link.value },
      }),
    );
  }

  linkOrder(link: DocumentLink): void {
    if (this.props.status !== "approved" && this.props.status !== "closed_won") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; orders only attach to approved or won registrations`,
      );
    }
    if (this.props.orders.some((o) => o.id === link.id)) return;
    this.props.orders.push(link);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.DealRegistrationOrderLinked,
        aggregateType: "DealRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), linkedId: link.id, linkedNumber: link.number, value: link.value },
      }),
    );
  }

  attachConflict(conflictId: Ulid): void {
    if (!this.props.conflictCaseIds.includes(conflictId)) {
      this.props.conflictCaseIds.push(conflictId);
      this.touch();
    }
  }

  private assertMutable(action: string): void {
    if (!["draft", "submitted", "under_review", "approved"].includes(this.props.status)) {
      throw new InvalidStateError(`Cannot ${action}: ${this.props.number} is ${this.props.status}`);
    }
  }

  private log(at: IsoDateTime, actor: UserId, action: string, detail?: string): void {
    this.props.timeline.push({ at, actor, action, detail });
    this.touch();
  }

  private basePayload() {
    return {
      registrationId: this.id,
      number: this.props.number,
      partnerId: this.props.partnerId,
      customerKey: this.props.customerKey,
    };
  }
}
