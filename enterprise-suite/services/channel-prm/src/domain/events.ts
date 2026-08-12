import type { IsoDateTime, Money, Ulid, UserId } from "@enterprise-suite/shared-kernel";
import type { CustomerKey } from "./territory.js";
import type { ChannelStage } from "./stages.js";
import type { PartnerTier } from "./partner.js";

/**
 * Domain event catalog for the channel PRM bounded context.
 *
 * Types are namespaced `prm.<aggregate>.<event>`; payloads carry enough for a
 * consumer (sales-erp opportunity sync, partner portal notifications,
 * reporting cubes, commission runs) to act without reading back. Anything a
 * consumer must not guess — protection dates, adjudicated outcomes, money —
 * is on the payload explicitly.
 */

export const ChannelEventTypes = {
  PartnerRegistered: "prm.partner.registered",
  PartnerTierChanged: "prm.partner.tier-changed",
  PartnerStatusChanged: "prm.partner.status-changed",
  PartnerAuthorizationsChanged: "prm.partner.authorizations-changed",

  DealRegistrationCreated: "prm.deal-registration.created",
  DealRegistrationSubmitted: "prm.deal-registration.submitted",
  DealRegistrationReviewStarted: "prm.deal-registration.review-started",
  DealRegistrationApproved: "prm.deal-registration.approved",
  DealRegistrationRejected: "prm.deal-registration.rejected",
  DealRegistrationWithdrawn: "prm.deal-registration.withdrawn",
  DealRegistrationForecastUpdated: "prm.deal-registration.forecast-updated",
  DealRegistrationProtectionExtended: "prm.deal-registration.protection-extended",
  DealRegistrationProtectionTruncated: "prm.deal-registration.protection-truncated",
  DealRegistrationProtectionExpiring: "prm.deal-registration.protection-expiring",
  DealRegistrationExpired: "prm.deal-registration.expired",
  DealRegistrationWon: "prm.deal-registration.won",
  DealRegistrationLost: "prm.deal-registration.lost",
  DealRegistrationQuoteLinked: "prm.deal-registration.quote-linked",
  DealRegistrationOrderLinked: "prm.deal-registration.order-linked",

  ReferralSubmitted: "prm.referral.submitted",
  ReferralAccepted: "prm.referral.accepted",
  ReferralRejected: "prm.referral.rejected",
  ReferralConverted: "prm.referral.converted",
  ReferralExpired: "prm.referral.expired",
  ReferralWon: "prm.referral.won",
  ReferralLost: "prm.referral.lost",
  ReferralCommissionAccrued: "prm.referral.commission-accrued",
  ReferralCommissionApproved: "prm.referral.commission-approved",
  ReferralCommissionPaid: "prm.referral.commission-paid",

  ChannelQuoteCreated: "prm.channel-quote.created",
  ChannelQuoteSubmitted: "prm.channel-quote.submitted",
  ChannelQuoteApproved: "prm.channel-quote.approved",
  ChannelQuoteRejected: "prm.channel-quote.rejected",
  ChannelQuoteSuperseded: "prm.channel-quote.superseded",
  ChannelQuoteExpired: "prm.channel-quote.expired",
  ChannelQuoteOrdered: "prm.channel-quote.ordered",

  ChannelOrderPlaced: "prm.channel-order.placed",
  ChannelOrderInvoiced: "prm.channel-order.invoiced",
  ChannelOrderFulfilled: "prm.channel-order.fulfilled",
  ChannelOrderCancelled: "prm.channel-order.cancelled",

  ConflictRaised: "prm.conflict.raised",
  ConflictEvidenceAdded: "prm.conflict.evidence-added",
  ConflictEscalated: "prm.conflict.escalated",
  ConflictResolved: "prm.conflict.resolved",
  ConflictWithdrawn: "prm.conflict.withdrawn",
} as const;

export type ChannelEventType = (typeof ChannelEventTypes)[keyof typeof ChannelEventTypes];

export interface PartnerRegisteredPayload {
  readonly partnerId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly tier: PartnerTier;
  readonly type: string;
  readonly territories: readonly string[];
  readonly productLines: readonly string[];
}

export interface PartnerTierChangedPayload {
  readonly partnerId: Ulid;
  readonly code: string;
  readonly from: PartnerTier;
  readonly to: PartnerTier;
  readonly reason?: string;
}

export interface PartnerStatusChangedPayload {
  readonly partnerId: Ulid;
  readonly code: string;
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
}

export interface PartnerAuthorizationsChangedPayload {
  readonly partnerId: Ulid;
  readonly code: string;
  readonly territories: readonly string[];
  readonly productLines: readonly string[];
}

export interface DealRegistrationBasePayload {
  readonly registrationId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly customerKey: CustomerKey;
}

export interface DealRegistrationCreatedPayload extends DealRegistrationBasePayload {
  readonly customerName: string;
  readonly country: string;
  readonly productLines: readonly string[];
  readonly estimatedValue: Money;
  readonly expectedCloseDate: IsoDateTime;
  readonly source: string;
}

export interface DealRegistrationApprovedPayload extends DealRegistrationBasePayload {
  readonly approvedBy: UserId;
  readonly protectionStartsAt: IsoDateTime;
  readonly protectionEndsAt: IsoDateTime;
  readonly protectionDays: number;
  readonly discountBps: number;
  readonly autoApproved: boolean;
}

export interface DealRegistrationRejectedPayload extends DealRegistrationBasePayload {
  readonly rejectedBy: UserId;
  readonly reasonCode: string;
  readonly notes?: string;
}

export interface DealRegistrationProtectionChangedPayload extends DealRegistrationBasePayload {
  readonly previousEndsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly days: number;
  readonly reason: string;
  readonly grantedBy: UserId;
}

export interface DealRegistrationProtectionExpiringPayload extends DealRegistrationBasePayload {
  readonly endsAt: IsoDateTime;
  readonly remainingDays: number;
  readonly stage: ChannelStage;
}

export interface DealRegistrationForecastUpdatedPayload extends DealRegistrationBasePayload {
  readonly stage: ChannelStage;
  readonly previousStage: ChannelStage;
  readonly probability: number;
  readonly estimatedValue: Money;
  readonly expectedCloseDate: IsoDateTime;
}

export interface DealRegistrationClosedPayload extends DealRegistrationBasePayload {
  readonly closedBy: UserId;
  readonly value: Money;
  readonly reason?: string;
  readonly competitor?: string;
  readonly cycleDays: number;
}

export interface DealRegistrationLinkPayload extends DealRegistrationBasePayload {
  readonly linkedId: Ulid;
  readonly linkedNumber: string;
  readonly value?: Money;
}

export interface ReferralBasePayload {
  readonly referralId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly companyName: string;
}

export interface ReferralSubmittedPayload extends ReferralBasePayload {
  readonly customerKey: CustomerKey;
  readonly productLines: readonly string[];
  readonly estimatedValue?: Money;
  readonly contactEmail: string;
}

export interface ReferralAcceptedPayload extends ReferralBasePayload {
  readonly acceptedBy: UserId;
  readonly attributionEndsAt: IsoDateTime;
  readonly commissionBps: number;
}

export interface ReferralConvertedPayload extends ReferralBasePayload {
  readonly registrationId?: Ulid;
  readonly opportunityRef?: string;
}

export interface ReferralOutcomePayload extends ReferralBasePayload {
  readonly value?: Money;
  readonly reason?: string;
}

export interface ReferralCommissionPayload extends ReferralBasePayload {
  readonly commissionBps: number;
  readonly basis: Money;
  readonly amount: Money;
  readonly status: string;
}

export interface ChannelQuoteBasePayload {
  readonly quoteId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly registrationId?: Ulid;
}

export interface ChannelQuoteSubmittedPayload extends ChannelQuoteBasePayload {
  readonly listTotal: Money;
  readonly requestedTotal: Money;
  readonly requestedDiscountBps: number;
  readonly validUntil: IsoDateTime;
  readonly requiresApproval: boolean;
}

export interface ChannelQuoteDecisionPayload extends ChannelQuoteBasePayload {
  readonly decidedBy: UserId;
  readonly approvedTotal?: Money;
  readonly approvedDiscountBps?: number;
  readonly reason?: string;
  readonly salesQuoteRef?: string;
}

export interface ChannelOrderPayload {
  readonly orderId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly registrationId?: Ulid;
  readonly channelQuoteId?: Ulid;
  readonly salesOrderRef: string;
  readonly netValue: Money;
  readonly sourceType: string;
  readonly orderedAt: IsoDateTime;
}

export interface ConflictBasePayload {
  readonly conflictId: Ulid;
  readonly number: string;
  readonly kind: string;
  readonly customerKey: CustomerKey;
  readonly claimantRegistrationId: Ulid;
  readonly incumbentRegistrationId?: Ulid;
}

export interface ConflictRaisedPayload extends ConflictBasePayload {
  readonly overlappingProductLines: readonly string[];
  readonly overlapDays: number;
  readonly recommendedOutcome: string;
  readonly slaDueAt: IsoDateTime;
}

export interface ConflictResolvedPayload extends ConflictBasePayload {
  readonly outcome: string;
  readonly decidedBy: UserId;
  readonly rationale: string;
  readonly awardedRegistrationId?: Ulid;
  readonly splitBps?: number;
  readonly resolutionDays: number;
}
