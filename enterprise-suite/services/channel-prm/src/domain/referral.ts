import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type Email,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError, type ValidationIssue } from "./errors.js";
import { ChannelEventTypes } from "./events.js";
import { applyBps, assertBps, assertPositiveMoney, zeroMoney } from "./money-math.js";
import {
  assertIso,
  describeWindow,
  hasLapsed,
  isProtectedAt,
  openWindow,
  type ProtectionSnapshot,
  type ProtectionWindow,
} from "./protection.js";
import {
  customerKey,
  normalizeCountry,
  normalizeDomain,
  normalizeProductLines,
  type CustomerKey,
} from "./territory.js";
import type { TimelineEntry } from "./deal-registration.js";

/**
 * Opportunity referral — the light-weight sibling of deal registration.
 *
 *   submitted ─accept→ accepted ─convert→ converted ─won→ closed_won
 *        │                  │                  └────────lost→ closed_lost
 *        ├─reject→ rejected └─(attribution lapses)→ expired
 *        └─(no decision in SLA)→ expired
 *
 * A referral agent hands over a contact and earns commission on the outcome;
 * they do not run the deal, so there is no protection window in the resale
 * sense — instead an *attribution* window bounds how long the introduction
 * keeps earning. Converting a referral is what creates a registration and
 * moves the relationship into the resale flow.
 */

export type ReferralStatus =
  | "submitted"
  | "accepted"
  | "rejected"
  | "converted"
  | "expired"
  | "closed_won"
  | "closed_lost";

export const REFERRAL_STATUSES: readonly ReferralStatus[] = [
  "submitted",
  "accepted",
  "rejected",
  "converted",
  "expired",
  "closed_won",
  "closed_lost",
];

export type ReferralRejectionReason =
  | "duplicate"
  | "existing_customer"
  | "existing_pipeline"
  | "out_of_scope"
  | "invalid_contact"
  | "no_consent";

export const REFERRAL_REJECTION_REASONS: readonly ReferralRejectionReason[] = [
  "duplicate",
  "existing_customer",
  "existing_pipeline",
  "out_of_scope",
  "invalid_contact",
  "no_consent",
];

export type CommissionStatus = "none" | "accrued" | "approved" | "paid" | "void";

export interface ReferralContact {
  readonly name: string;
  readonly email: Email;
  readonly phone?: string;
  readonly title?: string;
}

export interface ReferralCompany {
  readonly name: string;
  readonly domain?: string;
  readonly country: string;
  readonly region?: string;
}

export interface ReferralCommission {
  readonly bps: number;
  readonly basis: Money;
  readonly amount: Money;
  readonly status: CommissionStatus;
  readonly accruedAt?: IsoDateTime;
  readonly approvedAt?: IsoDateTime;
  readonly approvedBy?: UserId;
  readonly paidAt?: IsoDateTime;
  readonly paymentRef?: string;
}

export interface ReferralConversion {
  readonly at: IsoDateTime;
  readonly by: UserId;
  readonly registrationId?: Ulid;
  /** External opportunity handle when the deal runs direct (sales-erp id). */
  readonly opportunityRef?: string;
}

export interface ReferralProps {
  number: string;
  partnerId: Ulid;
  contact: ReferralContact;
  company: ReferralCompany;
  customerKey: CustomerKey;
  productLines: string[];
  estimatedValue?: Money;
  notes?: string;
  status: ReferralStatus;
  submittedAt: IsoDateTime;
  /** Deadline for the vendor to accept or reject. */
  decisionDueAt: IsoDateTime;
  acceptedAt?: IsoDateTime;
  acceptedBy?: UserId;
  /** Attribution window opened on acceptance. */
  attribution?: ProtectionWindow;
  commissionBps?: number;
  rejectionReason?: ReferralRejectionReason;
  rejectionNotes?: string;
  rejectedAt?: IsoDateTime;
  conversion?: ReferralConversion;
  outcomeAt?: IsoDateTime;
  outcomeBy?: UserId;
  outcomeValue?: Money;
  outcomeReason?: string;
  expiredAt?: IsoDateTime;
  commission?: ReferralCommission;
  timeline: TimelineEntry[];
}

export interface CreateReferralInput {
  readonly number: string;
  readonly partnerId: Ulid;
  readonly contact: ReferralContact;
  readonly company: ReferralCompany;
  readonly productLines: readonly string[];
  readonly estimatedValue?: Money;
  readonly notes?: string;
  readonly submittedBy: UserId;
  readonly submittedAt: IsoDateTime;
  readonly decisionSlaDays: number;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class Referral extends AggregateRoot<ReferralProps> {
  static create(tenantId: TenantId, input: CreateReferralInput): Referral {
    const issues: ValidationIssue[] = [];
    if (!input.contact?.name || input.contact.name.trim().length < 2) {
      issues.push({ field: "contact.name", message: "must be at least 2 characters" });
    }
    if (!input.contact?.email || !EMAIL_RE.test(input.contact.email)) {
      issues.push({ field: "contact.email", message: "must be a valid email address" });
    }
    if (!input.company?.name || input.company.name.trim().length < 2) {
      issues.push({ field: "company.name", message: "must be at least 2 characters" });
    }
    if (issues.length > 0) throw ValidationError.fromIssues("Invalid referral", issues);

    const company: ReferralCompany = {
      name: input.company.name.trim(),
      domain: normalizeDomain(input.company.domain),
      country: normalizeCountry(input.company.country),
      region: input.company.region?.trim() || undefined,
    };
    const referral = new Referral(tenantId, {
      number: input.number,
      partnerId: input.partnerId,
      contact: {
        name: input.contact.name.trim(),
        email: input.contact.email.trim().toLowerCase() as Email,
        phone: input.contact.phone?.trim() || undefined,
        title: input.contact.title?.trim() || undefined,
      },
      company,
      customerKey: customerKey({ name: company.name, domain: company.domain, country: company.country }),
      productLines: normalizeProductLines(input.productLines),
      estimatedValue: input.estimatedValue ? assertPositiveMoney(input.estimatedValue, "estimatedValue") : undefined,
      notes: input.notes?.trim() || undefined,
      status: "submitted",
      submittedAt: assertIso(input.submittedAt, "submittedAt"),
      decisionDueAt: new Date(
        Date.parse(input.submittedAt) + input.decisionSlaDays * 86_400_000,
      ).toISOString() as IsoDateTime,
      timeline: [{ at: input.submittedAt, actor: input.submittedBy, action: "submitted" }],
    });
    referral.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralSubmitted,
        aggregateType: "Referral",
        aggregateId: referral.id,
        tenantId,
        payload: {
          referralId: referral.id,
          number: referral.props.number,
          partnerId: referral.props.partnerId,
          companyName: company.name,
          customerKey: referral.props.customerKey,
          productLines: referral.props.productLines,
          estimatedValue: referral.props.estimatedValue,
          contactEmail: referral.props.contact.email,
        },
      }),
    );
    return referral;
  }

  static fromSnapshot(snapshot: EntityProps & ReferralProps): Referral {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Referral(
      tenantId,
      { ...props, productLines: [...props.productLines], timeline: [...props.timeline] },
      { id, createdAt, updatedAt, version },
    );
  }

  get number(): string {
    return this.props.number;
  }
  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get status(): ReferralStatus {
    return this.props.status;
  }
  get customerKey(): CustomerKey {
    return this.props.customerKey;
  }
  get company(): ReferralCompany {
    return this.props.company;
  }
  get contact(): ReferralContact {
    return this.props.contact;
  }
  get productLines(): readonly string[] {
    return this.props.productLines;
  }
  get estimatedValue(): Money | undefined {
    return this.props.estimatedValue;
  }
  get decisionDueAt(): IsoDateTime {
    return this.props.decisionDueAt;
  }
  get attribution(): ProtectionWindow | undefined {
    return this.props.attribution;
  }
  get commission(): ReferralCommission | undefined {
    return this.props.commission;
  }
  get commissionBps(): number {
    return this.props.commissionBps ?? 0;
  }
  get conversion(): ReferralConversion | undefined {
    return this.props.conversion;
  }
  get outcomeValue(): Money | undefined {
    return this.props.outcomeValue;
  }
  get submittedAt(): IsoDateTime {
    return this.props.submittedAt;
  }
  get timeline(): readonly TimelineEntry[] {
    return this.props.timeline;
  }

  attributionSnapshot(at: IsoDateTime): ProtectionSnapshot | undefined {
    return this.props.attribution ? describeWindow(this.props.attribution, at) : undefined;
  }

  /** Commission is only earned while the attribution window is live. */
  isAttributedAt(at: IsoDateTime): boolean {
    return this.props.attribution ? isProtectedAt(this.props.attribution, at) : false;
  }

  // --- commands ------------------------------------------------------------

  accept(input: { by: UserId; at: IsoDateTime; attributionDays: number; commissionBps: number }): void {
    if (this.props.status !== "submitted") {
      throw new InvalidStateError(
        `Referral ${this.props.number} is ${this.props.status}; only submitted referrals can be accepted`,
      );
    }
    assertBps(input.commissionBps, "commissionBps");
    this.props.status = "accepted";
    this.props.acceptedAt = input.at;
    this.props.acceptedBy = input.by;
    this.props.attribution = openWindow(input.at, input.attributionDays);
    this.props.commissionBps = input.commissionBps;
    this.log(input.at, input.by, "accepted", `${input.attributionDays}d attribution`);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralAccepted,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          acceptedBy: input.by,
          attributionEndsAt: this.props.attribution.endsAt,
          commissionBps: input.commissionBps,
        },
      }),
    );
  }

  reject(input: { by: UserId; at: IsoDateTime; reason: ReferralRejectionReason; notes?: string }): void {
    if (this.props.status !== "submitted") {
      throw new InvalidStateError(
        `Referral ${this.props.number} is ${this.props.status}; only submitted referrals can be rejected`,
      );
    }
    if (!REFERRAL_REJECTION_REASONS.includes(input.reason)) {
      throw ValidationError.single("reason", `must be one of [${REFERRAL_REJECTION_REASONS.join(", ")}]`);
    }
    this.props.status = "rejected";
    this.props.rejectionReason = input.reason;
    this.props.rejectionNotes = input.notes?.trim() || undefined;
    this.props.rejectedAt = input.at;
    this.log(input.at, input.by, "rejected", input.reason);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralRejected,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), reason: input.reason },
      }),
    );
  }

  /**
   * Links the accepted referral to the vehicle that will carry the deal: a
   * channel deal registration (partner resells) or a direct opportunity
   * reference (vendor sells, partner still earns).
   */
  convert(input: { by: UserId; at: IsoDateTime; registrationId?: Ulid; opportunityRef?: string }): void {
    if (this.props.status !== "accepted") {
      throw new InvalidStateError(
        `Referral ${this.props.number} is ${this.props.status}; only accepted referrals can be converted`,
      );
    }
    if (!input.registrationId && !input.opportunityRef?.trim()) {
      throw ValidationError.single("registrationId", "either a registration id or an opportunity reference is required");
    }
    if (this.props.attribution && hasLapsed(this.props.attribution, input.at)) {
      throw new InvalidStateError(
        `Attribution for referral ${this.props.number} lapsed on ${this.props.attribution.endsAt}`,
      );
    }
    this.props.status = "converted";
    this.props.conversion = {
      at: input.at,
      by: input.by,
      registrationId: input.registrationId,
      opportunityRef: input.opportunityRef?.trim() || undefined,
    };
    this.log(input.at, input.by, "converted", input.registrationId ?? input.opportunityRef);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralConverted,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          registrationId: input.registrationId,
          opportunityRef: this.props.conversion.opportunityRef,
        },
      }),
    );
  }

  /**
   * Records the win and accrues commission on the realised value. Accrual is a
   * liability, not a payment: it still needs approval and a payment run.
   */
  markWon(input: { by: UserId; at: IsoDateTime; value: Money }): ReferralCommission {
    if (this.props.status !== "converted") {
      throw new InvalidStateError(
        `Referral ${this.props.number} is ${this.props.status}; only a converted referral can be won`,
      );
    }
    assertPositiveMoney(input.value, "value");
    const bps = this.props.commissionBps ?? 0;
    const commission: ReferralCommission = {
      bps,
      basis: input.value,
      amount: applyBps(input.value, bps),
      status: bps > 0 ? "accrued" : "none",
      accruedAt: input.at,
    };
    this.props.status = "closed_won";
    this.props.outcomeAt = input.at;
    this.props.outcomeBy = input.by;
    this.props.outcomeValue = input.value;
    this.props.commission = commission;
    this.log(input.at, input.by, "won");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralWon,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), value: input.value },
      }),
    );
    if (commission.status === "accrued") {
      this.raise(
        envelope({
          eventType: ChannelEventTypes.ReferralCommissionAccrued,
          aggregateType: "Referral",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            ...this.basePayload(),
            commissionBps: bps,
            basis: commission.basis,
            amount: commission.amount,
            status: commission.status,
          },
        }),
      );
    }
    return commission;
  }

  markLost(input: { by: UserId; at: IsoDateTime; reason: string }): void {
    if (this.props.status !== "converted" && this.props.status !== "accepted") {
      throw new InvalidStateError(
        `Referral ${this.props.number} is ${this.props.status}; only accepted or converted referrals can be lost`,
      );
    }
    if (input.reason.trim().length === 0) throw ValidationError.single("reason", "a loss reason is required");
    this.props.status = "closed_lost";
    this.props.outcomeAt = input.at;
    this.props.outcomeBy = input.by;
    this.props.outcomeReason = input.reason.trim();
    this.props.outcomeValue = this.props.estimatedValue
      ? zeroMoney(this.props.estimatedValue.currency)
      : undefined;
    this.log(input.at, input.by, "lost", input.reason.trim());
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralLost,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), reason: input.reason.trim() },
      }),
    );
  }

  approveCommission(by: UserId, at: IsoDateTime): void {
    const commission = this.props.commission;
    if (!commission || commission.status !== "accrued") {
      throw new InvalidStateError(
        `Referral ${this.props.number} has no accrued commission to approve (${commission?.status ?? "none"})`,
      );
    }
    this.props.commission = { ...commission, status: "approved", approvedAt: at, approvedBy: by };
    this.log(at, by, "commission-approved");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralCommissionApproved,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          commissionBps: commission.bps,
          basis: commission.basis,
          amount: commission.amount,
          status: "approved",
        },
      }),
    );
  }

  payCommission(by: UserId, at: IsoDateTime, paymentRef: string): void {
    const commission = this.props.commission;
    if (!commission || commission.status !== "approved") {
      throw new InvalidStateError(
        `Referral ${this.props.number} commission is ${commission?.status ?? "none"}; approve it before payment`,
      );
    }
    if (paymentRef.trim().length === 0) {
      throw ValidationError.single("paymentRef", "a payment reference is required");
    }
    this.props.commission = { ...commission, status: "paid", paidAt: at, paymentRef: paymentRef.trim() };
    this.log(at, by, "commission-paid", paymentRef.trim());
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralCommissionPaid,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          commissionBps: commission.bps,
          basis: commission.basis,
          amount: commission.amount,
          status: "paid",
        },
      }),
    );
  }

  /**
   * Lapses a referral that was never decided, or one whose attribution ran out
   * before conversion. Returns false when nothing was due, keeping the sweep
   * idempotent.
   */
  expire(at: IsoDateTime): boolean {
    const overdueDecision = this.props.status === "submitted" && Date.parse(at) >= Date.parse(this.props.decisionDueAt);
    const lapsedAttribution =
      this.props.status === "accepted" && !!this.props.attribution && hasLapsed(this.props.attribution, at);
    if (!overdueDecision && !lapsedAttribution) return false;
    this.props.status = "expired";
    this.props.expiredAt = at;
    this.log(at, "system" as UserId, "expired", overdueDecision ? "decision-sla" : "attribution-lapsed");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ReferralExpired,
        aggregateType: "Referral",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), reason: overdueDecision ? "decision_sla" : "attribution_lapsed" },
      }),
    );
    return true;
  }

  private log(at: IsoDateTime, actor: UserId, action: string, detail?: string): void {
    this.props.timeline.push({ at, actor, action, detail });
    this.touch();
  }

  private basePayload() {
    return {
      referralId: this.id,
      number: this.props.number,
      partnerId: this.props.partnerId,
      companyName: this.props.company.name,
    };
  }
}
