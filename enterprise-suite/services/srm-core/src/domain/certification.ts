import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { nonEmpty } from "./common.js";
import type { DiversityFlag } from "./common.js";
import { compareDates, daysBetween, type DateOnly } from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { SrmEventTypes } from "./events.js";

/**
 * Supplier certification (ISO 9001, insurance cover, tax forms, diversity
 * certificates, ...).
 *
 *   pending_verification -> valid -> expired -> valid (renewal)
 *                        \-> rejected      \-> revoked
 *
 * A certificate is a *dated claim by a third party*, so the aggregate keeps
 * the paper trail — who verified it, the renewal chain, why it was revoked —
 * and never silently mutates dates. Expiry is not a stored transition that can
 * drift: `expiryStateOn(date)` derives it, and the nightly sweep in
 * QualificationService turns the derived state into an `expired` event plus a
 * compliance hold exactly once.
 */

export type CertificationType =
  | "iso9001"
  | "iso14001"
  | "iso45001"
  | "iso27001"
  | "iatf16949"
  | "as9100"
  | "soc2_type2"
  | "cyber_essentials"
  | "fda_registration"
  | "ce_marking"
  | "rohs"
  | "reach"
  | "conflict_minerals"
  | "fsc_chain_of_custody"
  | "sa8000"
  | "ecovadis"
  | "brc_food"
  | "haccp"
  | "code_of_conduct"
  | "gdpr_dpa"
  | "insurance_liability"
  | "insurance_workers_comp"
  | "tax_form"
  | "ubo_declaration"
  | "small_business_cert"
  | "women_owned_cert"
  | "minority_owned_cert"
  | "veteran_owned_cert";

export const CERTIFICATION_TYPES: readonly CertificationType[] = [
  "iso9001",
  "iso14001",
  "iso45001",
  "iso27001",
  "iatf16949",
  "as9100",
  "soc2_type2",
  "cyber_essentials",
  "fda_registration",
  "ce_marking",
  "rohs",
  "reach",
  "conflict_minerals",
  "fsc_chain_of_custody",
  "sa8000",
  "ecovadis",
  "brc_food",
  "haccp",
  "code_of_conduct",
  "gdpr_dpa",
  "insurance_liability",
  "insurance_workers_comp",
  "tax_form",
  "ubo_declaration",
  "small_business_cert",
  "women_owned_cert",
  "minority_owned_cert",
  "veteran_owned_cert",
];

export function isCertificationType(value: string): value is CertificationType {
  return (CERTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * Self-declared diversity flags stay "declared" until the matching
 * certificate is verified; spend reporting only counts verified ones.
 */
export const DIVERSITY_CERTIFICATION: Readonly<Partial<Record<DiversityFlag, CertificationType>>> = {
  small_business: "small_business_cert",
  women_owned: "women_owned_cert",
  minority_owned: "minority_owned_cert",
  veteran_owned: "veteran_owned_cert",
};

export type CertificationStatus = "pending_verification" | "valid" | "expired" | "revoked" | "rejected";

export type CertificationExpiryState = "valid" | "expiring" | "expired";

/** Default window in which a still-valid certificate is flagged for renewal. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 60;

export interface CertificationRenewal {
  readonly certificateNumber: string;
  readonly issuedOn: DateOnly;
  readonly expiresOn: DateOnly;
  readonly recordedAt: IsoDateTime;
  readonly recordedBy: UserId;
}

export interface CertificationProps {
  supplierId: Ulid;
  /** Denormalised so event consumers never need a supplier read-back. */
  supplierCode: string;
  type: CertificationType;
  issuer: string;
  certificateNumber: string;
  scope?: string;
  issuedOn: DateOnly;
  expiresOn: DateOnly;
  status: CertificationStatus;
  /** Empty means the certificate covers the whole supplier. */
  siteIds: Ulid[];
  documentRef?: string;
  verifiedBy?: UserId;
  verifiedAt?: IsoDateTime;
  rejectedReason?: string;
  revokedReason?: string;
  revokedAt?: IsoDateTime;
  /** Set once the expiry sweep has emitted the warning, so it fires once. */
  expiryWarnedAt?: IsoDateTime;
  renewals: CertificationRenewal[];
}

export interface RecordCertificationInput {
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly type: CertificationType;
  readonly issuer: string;
  readonly certificateNumber: string;
  readonly issuedOn: DateOnly;
  readonly expiresOn: DateOnly;
  readonly scope?: string;
  readonly siteIds?: readonly Ulid[];
  readonly documentRef?: string;
}

export class Certification extends AggregateRoot<CertificationProps> {
  static record(tenantId: TenantId, input: RecordCertificationInput): Certification {
    if (!isCertificationType(input.type)) {
      throw ValidationError.single("type", `unknown certification type "${input.type}"`);
    }
    if (compareDates(input.expiresOn, input.issuedOn) <= 0) {
      throw ValidationError.single("expiresOn", "must be after issuedOn");
    }
    const certification = new Certification(tenantId, {
      supplierId: input.supplierId,
      supplierCode: input.supplierCode,
      type: input.type,
      issuer: nonEmpty(input.issuer, "issuer"),
      certificateNumber: nonEmpty(input.certificateNumber, "certificateNumber", 64),
      scope: input.scope?.trim() || undefined,
      issuedOn: input.issuedOn,
      expiresOn: input.expiresOn,
      status: "pending_verification",
      siteIds: [...(input.siteIds ?? [])],
      documentRef: input.documentRef?.trim() || undefined,
      renewals: [],
    });
    certification.emit(SrmEventTypes.CertificationRecorded);
    return certification;
  }

  static fromSnapshot(snapshot: EntityProps & CertificationProps): Certification {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Certification(
      tenantId,
      { ...props, siteIds: [...props.siteIds], renewals: [...props.renewals] },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get supplierCode(): string {
    return this.props.supplierCode;
  }
  get type(): CertificationType {
    return this.props.type;
  }
  get status(): CertificationStatus {
    return this.props.status;
  }
  get certificateNumber(): string {
    return this.props.certificateNumber;
  }
  get issuedOn(): DateOnly {
    return this.props.issuedOn;
  }
  get expiresOn(): DateOnly {
    return this.props.expiresOn;
  }
  get siteIds(): readonly Ulid[] {
    return this.props.siteIds;
  }
  get renewals(): readonly CertificationRenewal[] {
    return this.props.renewals;
  }
  get expiryWarned(): boolean {
    return this.props.expiryWarnedAt !== undefined;
  }

  coversSite(siteId: Ulid): boolean {
    return this.props.siteIds.length === 0 || this.props.siteIds.includes(siteId);
  }

  daysToExpiry(asOf: DateOnly): number {
    return daysBetween(asOf, this.props.expiresOn);
  }

  /** Derived expiry state; `expiring` uses the caller's warning window. */
  expiryStateOn(asOf: DateOnly, warningDays = DEFAULT_EXPIRY_WARNING_DAYS): CertificationExpiryState {
    const remaining = this.daysToExpiry(asOf);
    if (remaining < 0) return "expired";
    return remaining <= warningDays ? "expiring" : "valid";
  }

  /** Effective for compliance decisions: verified, unrevoked and in-window. */
  isEffectiveOn(asOf: DateOnly): boolean {
    if (this.props.status !== "valid" && this.props.status !== "expired") return false;
    return compareDates(asOf, this.props.issuedOn) >= 0 && compareDates(asOf, this.props.expiresOn) <= 0;
  }

  // --- commands ------------------------------------------------------------

  verify(by: UserId, at: IsoDateTime, asOf: DateOnly): void {
    if (this.props.status !== "pending_verification") {
      throw new InvalidStateError(
        `Certificate ${this.props.certificateNumber} is ${this.props.status}; only pending certificates can be verified`,
      );
    }
    if (compareDates(this.props.expiresOn, asOf) < 0) {
      throw new InvalidStateError(
        `Certificate ${this.props.certificateNumber} expired on ${this.props.expiresOn}; record a renewal instead`,
      );
    }
    this.props.status = "valid";
    this.props.verifiedBy = by;
    this.props.verifiedAt = at;
    this.emit(SrmEventTypes.CertificationVerified, { daysToExpiry: this.daysToExpiry(asOf) });
  }

  reject(reason: string, at: IsoDateTime): void {
    if (this.props.status !== "pending_verification") {
      throw new InvalidStateError(
        `Certificate ${this.props.certificateNumber} is ${this.props.status}; only pending certificates can be rejected`,
      );
    }
    this.props.status = "rejected";
    this.props.rejectedReason = nonEmpty(reason, "reason", 500);
    this.props.verifiedAt = at;
    this.emit(SrmEventTypes.CertificationRejected, { reason: this.props.rejectedReason });
  }

  /**
   * Records a fresh certificate for the same type. The renewal must extend
   * the coverage; re-issuing an equal or earlier expiry is a data-entry error
   * that would silently shorten compliance coverage.
   */
  renew(
    input: { certificateNumber: string; issuedOn: DateOnly; expiresOn: DateOnly; documentRef?: string },
    by: UserId,
    at: IsoDateTime,
  ): void {
    if (this.props.status === "revoked" || this.props.status === "rejected") {
      throw new InvalidStateError(
        `Certificate ${this.props.certificateNumber} is ${this.props.status} and cannot be renewed`,
      );
    }
    if (compareDates(input.expiresOn, input.issuedOn) <= 0) {
      throw ValidationError.single("expiresOn", "must be after issuedOn");
    }
    if (compareDates(input.expiresOn, this.props.expiresOn) <= 0) {
      throw ValidationError.single(
        "expiresOn",
        `renewal must extend beyond the current expiry ${this.props.expiresOn}`,
      );
    }
    this.props.renewals.push({
      certificateNumber: this.props.certificateNumber,
      issuedOn: this.props.issuedOn,
      expiresOn: this.props.expiresOn,
      recordedAt: at,
      recordedBy: by,
    });
    this.props.certificateNumber = nonEmpty(input.certificateNumber, "certificateNumber", 64);
    this.props.issuedOn = input.issuedOn;
    this.props.expiresOn = input.expiresOn;
    this.props.documentRef = input.documentRef?.trim() || this.props.documentRef;
    this.props.status = "valid";
    this.props.verifiedBy = by;
    this.props.verifiedAt = at;
    this.props.expiryWarnedAt = undefined;
    this.emit(SrmEventTypes.CertificationRenewed);
  }

  /** Third party pulled the certificate — harsher than expiry, no grace. */
  revoke(reason: string, at: IsoDateTime): void {
    if (this.props.status === "revoked") {
      throw new InvalidStateError(`Certificate ${this.props.certificateNumber} is already revoked`);
    }
    this.props.status = "revoked";
    this.props.revokedReason = nonEmpty(reason, "reason", 500);
    this.props.revokedAt = at;
    this.emit(SrmEventTypes.CertificationRevoked, { reason: this.props.revokedReason });
  }

  /** Sweep hook: emits the warning once, returns whether it fired. */
  warnExpiring(asOf: DateOnly, at: IsoDateTime, warningDays = DEFAULT_EXPIRY_WARNING_DAYS): boolean {
    if (this.props.status !== "valid") return false;
    if (this.props.expiryWarnedAt !== undefined) return false;
    if (this.expiryStateOn(asOf, warningDays) !== "expiring") return false;
    this.props.expiryWarnedAt = at;
    this.emit(SrmEventTypes.CertificationExpiring, { daysToExpiry: this.daysToExpiry(asOf) });
    return true;
  }

  /** Sweep hook: flips valid -> expired once the window has closed. */
  expireIfDue(asOf: DateOnly): boolean {
    if (this.props.status !== "valid") return false;
    if (compareDates(this.props.expiresOn, asOf) >= 0) return false;
    this.props.status = "expired";
    this.emit(SrmEventTypes.CertificationExpired, { daysToExpiry: this.daysToExpiry(asOf) });
    return true;
  }

  private emit(eventType: string, extra: Record<string, unknown> = {}): void {
    this.raise(
      envelope({
        eventType,
        aggregateType: "Certification",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          certificationId: this.id,
          supplierId: this.props.supplierId,
          supplierCode: this.props.supplierCode,
          type: this.props.type,
          certificateNumber: this.props.certificateNumber,
          status: this.props.status,
          issuedOn: this.props.issuedOn,
          expiresOn: this.props.expiresOn,
          ...extra,
        },
      }),
    );
  }
}
