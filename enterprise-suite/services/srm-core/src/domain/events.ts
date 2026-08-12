import type { IsoDateTime, Money, Ulid, UserId } from "@enterprise-suite/shared-kernel";
import type { DateOnly } from "./dates.js";

/**
 * Domain event catalog for the SRM bounded context.
 *
 * Types are namespaced `srm.<aggregate>.<event>` and versioned through the
 * envelope's `schemaVersion`. Payloads carry enough denormalised context
 * (supplier code, period code, severity) that downstream consumers —
 * procurement, finance, reporting — never need a synchronous read-back.
 */

export const SrmEventTypes = {
  SupplierRegistered: "srm.supplier.registered",
  SupplierProfileUpdated: "srm.supplier.profile-updated",
  SupplierStatusChanged: "srm.supplier.status-changed",
  SupplierClassified: "srm.supplier.classified",
  SupplierSiteAdded: "srm.supplier.site-added",
  SupplierSiteUpdated: "srm.supplier.site-updated",
  SupplierSiteDeactivated: "srm.supplier.site-deactivated",
  SupplierContactAdded: "srm.supplier.contact-added",
  SupplierContactRemoved: "srm.supplier.contact-removed",
  SupplierCategoryApproved: "srm.supplier.category-approved",
  SupplierCategoryRestricted: "srm.supplier.category-restricted",
  SupplierBankAccountAdded: "srm.supplier.bank-account-added",
  SupplierBankAccountVerified: "srm.supplier.bank-account-verified",

  CategoryCreated: "srm.category.created",
  CategoryUpdated: "srm.category.updated",
  CategoryMoved: "srm.category.moved",

  OnboardingStarted: "srm.onboarding.started",
  OnboardingStepCompleted: "srm.onboarding.step-completed",
  OnboardingStepWaived: "srm.onboarding.step-waived",
  OnboardingDocumentReceived: "srm.onboarding.document-received",
  OnboardingDocumentVerified: "srm.onboarding.document-verified",
  OnboardingDocumentRejected: "srm.onboarding.document-rejected",
  OnboardingSubmitted: "srm.onboarding.submitted",
  OnboardingApprovalRecorded: "srm.onboarding.approval-recorded",
  OnboardingApproved: "srm.onboarding.approved",
  OnboardingRejected: "srm.onboarding.rejected",
  OnboardingWithdrawn: "srm.onboarding.withdrawn",

  CertificationRecorded: "srm.certification.recorded",
  CertificationVerified: "srm.certification.verified",
  CertificationRejected: "srm.certification.rejected",
  CertificationRenewed: "srm.certification.renewed",
  CertificationExpiring: "srm.certification.expiring",
  CertificationExpired: "srm.certification.expired",
  CertificationRevoked: "srm.certification.revoked",

  QualificationScheduled: "srm.qualification.scheduled",
  QualificationStarted: "srm.qualification.started",
  QualificationSectionScored: "srm.qualification.section-scored",
  QualificationFindingRaised: "srm.qualification.finding-raised",
  QualificationFindingClosed: "srm.qualification.finding-closed",
  QualificationCompleted: "srm.qualification.completed",
  QualificationExpired: "srm.qualification.expired",
  QualificationWithdrawn: "srm.qualification.withdrawn",

  KpiDefinitionCreated: "srm.kpi-definition.created",
  KpiDefinitionUpdated: "srm.kpi-definition.updated",
  ScorecardOpened: "srm.scorecard.opened",
  ScorecardMeasurementRecorded: "srm.scorecard.measurement-recorded",
  ScorecardPublished: "srm.scorecard.published",
  ScorecardDisputed: "srm.scorecard.disputed",
  ScorecardDisputeResolved: "srm.scorecard.dispute-resolved",
  ScorecardImprovementRequired: "srm.scorecard.improvement-required",
  ScorecardActionCompleted: "srm.scorecard.action-completed",
  ScorecardClosed: "srm.scorecard.closed",

  ContractDrafted: "srm.contract.drafted",
  ContractSentForSignature: "srm.contract.sent-for-signature",
  ContractSigned: "srm.contract.signed",
  ContractActivated: "srm.contract.activated",
  ContractAmended: "srm.contract.amended",
  ContractPriceLineAdded: "srm.contract.price-line-added",
  ContractRenewed: "srm.contract.renewed",
  ContractExpiring: "srm.contract.expiring",
  ContractExpired: "srm.contract.expired",
  ContractTerminated: "srm.contract.terminated",
  ContractSuperseded: "srm.contract.superseded",

  SlaCommitmentAdded: "srm.sla.commitment-added",
  SlaBreachRecorded: "srm.sla.breach-recorded",
  SlaCreditIssued: "srm.sla.credit-issued",
  SlaBreachWaived: "srm.sla.breach-waived",

  RiskFlagRaised: "srm.risk.flag-raised",
  RiskFlagMitigated: "srm.risk.flag-mitigated",
  RiskFlagAccepted: "srm.risk.flag-accepted",
  RiskFlagClosed: "srm.risk.flag-closed",
  RiskTierChanged: "srm.risk.tier-changed",
  HoldPlaced: "srm.hold.placed",
  HoldReleased: "srm.hold.released",
  HoldExpired: "srm.hold.expired",
} as const;

export type SrmEventType = (typeof SrmEventTypes)[keyof typeof SrmEventTypes];

export interface SupplierRef {
  readonly supplierId: Ulid;
  readonly supplierCode: string;
}

export interface SupplierRegisteredPayload extends SupplierRef {
  readonly legalName: string;
  readonly countryCode: string;
  readonly status: string;
}

export interface SupplierStatusChangedPayload extends SupplierRef {
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
  readonly changedBy: UserId;
}

export interface SupplierClassifiedPayload extends SupplierRef {
  readonly from: string;
  readonly to: string;
  readonly rationale?: string;
}

export interface SupplierSitePayload extends SupplierRef {
  readonly siteId: Ulid;
  readonly siteCode: string;
  readonly siteType: string;
  readonly countryCode: string;
  readonly isPrimary: boolean;
}

export interface SupplierContactPayload extends SupplierRef {
  readonly contactId: Ulid;
  readonly email: string;
  readonly role: string;
}

export interface SupplierCategoryPayload extends SupplierRef {
  readonly categoryId: Ulid;
  readonly categoryCode: string;
  readonly approvalStatus: string;
  readonly note?: string;
}

export interface SupplierBankAccountPayload extends SupplierRef {
  readonly accountId: Ulid;
  readonly currency: string;
  /** Never the full account number — only the masked tail. */
  readonly maskedNumber: string;
  readonly verificationStatus: string;
}

export interface OnboardingPayload extends SupplierRef {
  readonly caseId: Ulid;
  readonly caseNumber: string;
  readonly status: string;
}

export interface OnboardingStepPayload extends OnboardingPayload {
  readonly stepCode: string;
  readonly stepType: string;
  readonly actor: UserId;
  readonly reason?: string;
}

export interface OnboardingDocumentPayload extends OnboardingPayload {
  readonly documentCode: string;
  readonly status: string;
  readonly expiresOn?: DateOnly;
  readonly reason?: string;
}

export interface OnboardingDecisionPayload extends OnboardingPayload {
  readonly decidedBy: UserId;
  readonly decision: "approved" | "rejected";
  readonly approvalsRecorded: number;
  readonly approvalsRequired: number;
  readonly riskScore: number;
  readonly comment?: string;
}

export interface CertificationPayload extends SupplierRef {
  readonly certificationId: Ulid;
  readonly type: string;
  readonly certificateNumber: string;
  readonly status: string;
  readonly issuedOn?: DateOnly;
  readonly expiresOn?: DateOnly;
  readonly daysToExpiry?: number;
  readonly reason?: string;
}

export interface QualificationPayload extends SupplierRef {
  readonly qualificationId: Ulid;
  readonly reference: string;
  readonly type: string;
  readonly method: string;
  readonly status: string;
  readonly categoryId?: Ulid;
}

export interface QualificationCompletedPayload extends QualificationPayload {
  readonly outcome: string;
  readonly score: number;
  readonly validUntil?: DateOnly;
  readonly openFindings: number;
  readonly conductedBy: UserId;
}

export interface QualificationFindingPayload extends QualificationPayload {
  readonly findingId: Ulid;
  readonly severity: string;
  readonly section: string;
  readonly capaDueOn?: DateOnly;
}

export interface KpiDefinitionPayload {
  readonly kpiId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly direction: string;
  readonly weight: number;
}

export interface ScorecardPayload extends SupplierRef {
  readonly scorecardId: Ulid;
  readonly periodCode: string;
  readonly status: string;
}

export interface ScorecardMeasurementPayload extends ScorecardPayload {
  readonly kpiCode: string;
  readonly value: number;
  readonly score: number;
  readonly band: string;
  readonly source: string;
}

export interface ScorecardPublishedPayload extends ScorecardPayload {
  readonly score: number;
  readonly rating: string;
  readonly previousScore?: number;
  readonly delta?: number;
  readonly kpiCount: number;
  readonly redKpis: readonly string[];
  readonly publishedBy: UserId;
}

export interface ContractPayload extends SupplierRef {
  readonly contractId: Ulid;
  readonly contractNumber: string;
  readonly type: string;
  readonly status: string;
  readonly effectiveFrom?: DateOnly;
  readonly effectiveTo?: DateOnly;
}

export interface ContractAmendedPayload extends ContractPayload {
  readonly revision: number;
  readonly changeNote: string;
  readonly amendedBy: UserId;
}

export interface ContractRenewedPayload extends ContractPayload {
  readonly previousEffectiveTo: DateOnly;
  readonly renewalCount: number;
  readonly automatic: boolean;
}

export interface ContractTerminatedPayload extends ContractPayload {
  readonly reason: string;
  readonly terminationDate: DateOnly;
  readonly noticeWaived: boolean;
  readonly terminatedBy: UserId;
}

export interface SlaCommitmentPayload extends ContractPayload {
  readonly commitmentId: Ulid;
  readonly metric: string;
  readonly target: number;
  readonly unit: string;
}

export interface SlaBreachPayload extends ContractPayload {
  readonly breachId: Ulid;
  readonly commitmentId: Ulid;
  readonly metric: string;
  readonly periodCode: string;
  readonly target: number;
  readonly measured: number;
  readonly severity: string;
  readonly credit?: Money;
  readonly consecutiveBreaches: number;
}

export interface RiskFlagPayload extends SupplierRef {
  readonly flagId: Ulid;
  readonly category: string;
  readonly severity: string;
  readonly inherentScore: number;
  readonly residualScore?: number;
  readonly status: string;
  readonly source: string;
  readonly detectedOn: DateOnly;
}

export interface RiskTierChangedPayload extends SupplierRef {
  readonly from: string;
  readonly to: string;
  readonly score: number;
  readonly openFlags: number;
}

export interface HoldPayload extends SupplierRef {
  readonly holdId: Ulid;
  readonly holdType: string;
  readonly reasonCode: string;
  readonly scope: string;
  readonly categoryIds?: readonly Ulid[];
  readonly placedBy?: UserId;
  readonly releasedBy?: UserId;
  readonly note?: string;
  readonly expiresOn?: DateOnly;
  readonly occurredAt?: IsoDateTime;
}
