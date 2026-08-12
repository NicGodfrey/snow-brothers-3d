import type { IsoDateTime, Money, Ulid, UserId } from "@enterprise-suite/shared-kernel";

/**
 * Domain event catalog for the PRM bounded context.
 *
 * Types are namespaced `prm.<aggregate>.<event>` and versioned through the
 * envelope's schemaVersion. Payloads are self-contained: a consumer
 * (channel-prm for deal registration, finance for MDF payouts, reporting for
 * partner scorecards) can act on the event without reading back into PRM.
 */

export const PrmEventTypes = {
  PartnerRegistered: "prm.partner.registered",
  PartnerProfileUpdated: "prm.partner.profile-updated",
  PartnerContactAdded: "prm.partner.contact-added",
  PartnerContactRemoved: "prm.partner.contact-removed",
  PartnerApplicationSubmitted: "prm.partner.application-submitted",
  PartnerReviewStarted: "prm.partner.review-started",
  PartnerApproved: "prm.partner.approved",
  PartnerRejected: "prm.partner.rejected",
  PartnerActivated: "prm.partner.activated",
  PartnerSuspended: "prm.partner.suspended",
  PartnerReinstated: "prm.partner.reinstated",
  PartnerTerminated: "prm.partner.terminated",
  PartnerTierAssigned: "prm.partner.tier-assigned",
  PartnerPerformanceRecorded: "prm.partner.performance-recorded",

  TierDefinitionCreated: "prm.tier-definition.created",
  TierDefinitionUpdated: "prm.tier-definition.updated",

  ContractDrafted: "prm.contract.drafted",
  ContractTermsAmended: "prm.contract.terms-amended",
  ContractSentForSignature: "prm.contract.sent-for-signature",
  ContractSigned: "prm.contract.signed",
  ContractActivated: "prm.contract.activated",
  ContractRenewed: "prm.contract.renewed",
  ContractExpired: "prm.contract.expired",
  ContractTerminated: "prm.contract.terminated",
  ContractObligationRecorded: "prm.contract.obligation-recorded",
  ContractBreachFlagged: "prm.contract.breach-flagged",

  MdfBudgetCreated: "prm.mdf-budget.created",
  MdfBudgetOpened: "prm.mdf-budget.opened",
  MdfBudgetClosed: "prm.mdf-budget.closed",
  MdfBudgetToppedUp: "prm.mdf-budget.topped-up",
  MdfAllocationCreated: "prm.mdf-budget.allocation-created",
  MdfAllocationAdjusted: "prm.mdf-budget.allocation-adjusted",
  MdfFundsCommitted: "prm.mdf-budget.funds-committed",
  MdfCommitmentReleased: "prm.mdf-budget.commitment-released",
  MdfFundsPaid: "prm.mdf-budget.funds-paid",

  MdfRequestCreated: "prm.mdf-request.created",
  MdfRequestSubmitted: "prm.mdf-request.submitted",
  MdfRequestApproved: "prm.mdf-request.approved",
  MdfRequestRejected: "prm.mdf-request.rejected",
  MdfRequestCancelled: "prm.mdf-request.cancelled",
  MdfRequestClosed: "prm.mdf-request.closed",

  MdfClaimCreated: "prm.mdf-claim.created",
  MdfClaimSubmitted: "prm.mdf-claim.submitted",
  MdfClaimReviewStarted: "prm.mdf-claim.review-started",
  MdfClaimApproved: "prm.mdf-claim.approved",
  MdfClaimRejected: "prm.mdf-claim.rejected",
  MdfClaimPaid: "prm.mdf-claim.paid",

  CourseCreated: "prm.course.created",
  CourseRetired: "prm.course.retired",
  CertificationDefinitionCreated: "prm.certification-definition.created",
  EnrollmentCreated: "prm.enrollment.created",
  EnrollmentAttemptRecorded: "prm.enrollment.attempt-recorded",
  EnrollmentCompleted: "prm.enrollment.completed",
  EnrollmentFailed: "prm.enrollment.failed",
  EnrollmentWithdrawn: "prm.enrollment.withdrawn",
  CertificationAwarded: "prm.certification.awarded",
  CertificationRenewed: "prm.certification.renewed",
  CertificationExpired: "prm.certification.expired",
  CertificationRevoked: "prm.certification.revoked",

  PortalUserInvited: "prm.portal-user.invited",
  PortalUserActivated: "prm.portal-user.activated",
  PortalUserRolesChanged: "prm.portal-user.roles-changed",
  PortalUserDisabled: "prm.portal-user.disabled",
  PortalUserReenabled: "prm.portal-user.reenabled",
  EntitlementDefinitionCreated: "prm.entitlement-definition.created",
  EntitlementGranted: "prm.entitlement.granted",
  EntitlementRevoked: "prm.entitlement.revoked",
} as const;

export type PrmEventType = (typeof PrmEventTypes)[keyof typeof PrmEventTypes];

export interface PartnerIdentityPayload {
  readonly partnerId: Ulid;
  readonly number: string;
  readonly legalName: string;
}

export interface PartnerRegisteredPayload extends PartnerIdentityPayload {
  readonly type: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly parentPartnerId?: Ulid;
}

export interface PartnerStatusChangedPayload extends PartnerIdentityPayload {
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
  readonly actor?: UserId;
}

export interface PartnerTierAssignedPayload extends PartnerIdentityPayload {
  readonly fromTierCode?: string;
  readonly toTierCode: string;
  readonly toTierRank: number;
  readonly direction: "upgrade" | "downgrade" | "initial";
  readonly reason: string;
  readonly effectiveAt: IsoDateTime;
}

export interface PartnerPerformanceRecordedPayload {
  readonly partnerId: Ulid;
  readonly period: string;
  readonly bookedRevenue: Money;
  readonly dealsRegistered: number;
  readonly dealsWon: number;
}

export interface ContractIdentityPayload {
  readonly contractId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly type: string;
}

export interface ContractActivatedPayload extends ContractIdentityPayload {
  readonly effectiveFrom: IsoDateTime;
  readonly effectiveTo: IsoDateTime;
  readonly autoRenew: boolean;
  readonly baseDiscountBps: number;
  readonly mdfEligible: boolean;
}

export interface ContractRenewedPayload extends ContractIdentityPayload {
  readonly previousEffectiveTo: IsoDateTime;
  readonly effectiveTo: IsoDateTime;
  readonly renewalCount: number;
}

export interface ContractTerminatedPayload extends ContractIdentityPayload {
  readonly reason: string;
  readonly terminatedAt: IsoDateTime;
  readonly noticeDays: number;
}

export interface MdfBudgetPayload {
  readonly budgetId: Ulid;
  readonly code: string;
  readonly period: string;
  readonly total: Money;
}

export interface MdfAllocationPayload {
  readonly budgetId: Ulid;
  readonly allocationId: Ulid;
  readonly partnerId: Ulid;
  readonly amount: Money;
  readonly budgetAvailable: Money;
}

export interface MdfLedgerPayload {
  readonly budgetId: Ulid;
  readonly allocationId: Ulid;
  readonly partnerId: Ulid;
  readonly amount: Money;
  readonly reference: Ulid;
  readonly allocationAvailable: Money;
}

export interface MdfRequestPayload {
  readonly requestId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly budgetId: Ulid;
  readonly activityType: string;
  readonly requestedAmount: Money;
}

export interface MdfRequestApprovedPayload extends MdfRequestPayload {
  readonly approvedAmount: Money;
  readonly approvedBy: UserId;
  readonly claimDeadline: IsoDateTime;
}

export interface MdfClaimPayload {
  readonly claimId: Ulid;
  readonly number: string;
  readonly requestId: Ulid;
  readonly partnerId: Ulid;
  readonly claimedAmount: Money;
}

export interface MdfClaimApprovedPayload extends MdfClaimPayload {
  readonly approvedAmount: Money;
  readonly approvedBy: UserId;
  readonly shortPayReason?: string;
}

export interface MdfClaimPaidPayload extends MdfClaimPayload {
  readonly paidAmount: Money;
  readonly paymentReference: string;
  readonly paidAt: IsoDateTime;
}

export interface EnrollmentPayload {
  readonly enrollmentId: Ulid;
  readonly partnerId: Ulid;
  readonly portalUserId: Ulid;
  readonly courseCode: string;
}

export interface EnrollmentAttemptPayload extends EnrollmentPayload {
  readonly attempt: number;
  readonly score: number;
  readonly passed: boolean;
  readonly attemptsRemaining: number;
}

export interface CertificationPayload {
  readonly certificationId: Ulid;
  readonly certificationCode: string;
  readonly partnerId: Ulid;
  readonly portalUserId: Ulid;
  readonly awardedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export interface CertificationRevokedPayload {
  readonly certificationId: Ulid;
  readonly certificationCode: string;
  readonly partnerId: Ulid;
  readonly portalUserId: Ulid;
  readonly reason: string;
}

export interface PortalUserPayload {
  readonly portalUserId: Ulid;
  readonly partnerId: Ulid;
  readonly email: string;
  readonly roles: readonly string[];
}

export interface EntitlementGrantPayload {
  readonly grantId: Ulid;
  readonly entitlementCode: string;
  readonly subject: "partner" | "user";
  readonly subjectId: Ulid;
  readonly effect: "allow" | "deny";
  readonly reason: string;
}
