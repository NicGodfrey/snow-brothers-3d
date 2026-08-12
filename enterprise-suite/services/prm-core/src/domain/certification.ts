import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { addDays, addMonths, isAfter, isBefore, parseIso } from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { PrmEventTypes } from "./events.js";
import type { CertificationLevel } from "./training.js";

/**
 * An awarded certification held by one partner individual.
 *
 *   active → expired          (validity elapsed, swept by the service)
 *   active → active           (renewed inside the renewal window)
 *   active/expired → revoked  (compliance action, terminal)
 *
 * Certifications are the currency of the tier program, so the aggregate keeps
 * the full renewal history and the evidence (enrollment ids) each award was
 * based on rather than just a boolean.
 */

export type CertificationStatus = "active" | "expired" | "revoked";

export const CERTIFICATION_STATUSES: readonly CertificationStatus[] = ["active", "expired", "revoked"];

export interface CertificationRenewal {
  readonly renewedAt: IsoDateTime;
  readonly previousExpiresAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly renewedBy: UserId;
  readonly evidenceEnrollmentIds: readonly Ulid[];
}

export interface CertificationProps {
  certificationCode: string;
  level: CertificationLevel;
  partnerId: Ulid;
  portalUserId: Ulid;
  status: CertificationStatus;
  awardedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  awardedBy: UserId;
  evidenceEnrollmentIds: Ulid[];
  renewals: CertificationRenewal[];
  expiredAt?: IsoDateTime;
  revokedAt?: IsoDateTime;
  revokedBy?: UserId;
  revocationReason?: string;
}

export interface AwardCertificationInput {
  readonly certificationCode: string;
  readonly level: CertificationLevel;
  readonly partnerId: Ulid;
  readonly portalUserId: Ulid;
  readonly at: IsoDateTime;
  readonly by: UserId;
  readonly validityMonths: number;
  readonly evidenceEnrollmentIds: readonly Ulid[];
}

export class Certification extends AggregateRoot<CertificationProps> {
  static award(tenantId: TenantId, input: AwardCertificationInput): Certification {
    if (!Number.isInteger(input.validityMonths) || input.validityMonths < 1) {
      throw ValidationError.single("validityMonths", "must be a positive integer");
    }
    const awardedAt = parseIso(input.at, "at");
    const certification = new Certification(tenantId, {
      certificationCode: input.certificationCode.trim().toLowerCase(),
      level: input.level,
      partnerId: input.partnerId,
      portalUserId: input.portalUserId,
      status: "active",
      awardedAt,
      expiresAt: addMonths(awardedAt, input.validityMonths),
      awardedBy: input.by,
      evidenceEnrollmentIds: [...input.evidenceEnrollmentIds],
      renewals: [],
    });
    certification.raise(certification.certificationEvent(PrmEventTypes.CertificationAwarded));
    return certification;
  }

  static fromSnapshot(snapshot: EntityProps & CertificationProps): Certification {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Certification(
      tenantId,
      {
        ...props,
        evidenceEnrollmentIds: [...props.evidenceEnrollmentIds],
        renewals: [...props.renewals],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  get certificationCode(): string {
    return this.props.certificationCode;
  }
  get level(): CertificationLevel {
    return this.props.level;
  }
  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get portalUserId(): Ulid {
    return this.props.portalUserId;
  }
  get status(): CertificationStatus {
    return this.props.status;
  }
  get awardedAt(): IsoDateTime {
    return this.props.awardedAt;
  }
  get expiresAt(): IsoDateTime {
    return this.props.expiresAt;
  }
  get renewals(): readonly CertificationRenewal[] {
    return this.props.renewals;
  }
  get revocationReason(): string | undefined {
    return this.props.revocationReason;
  }

  isActiveAt(at: IsoDateTime): boolean {
    return this.props.status === "active" && isBefore(at, this.props.expiresAt);
  }

  /** True inside `renewalWindowDays` before expiry (or already past expiry). */
  isRenewableAt(at: IsoDateTime, renewalWindowDays: number): boolean {
    if (this.props.status === "revoked") return false;
    const windowOpens = addDays(this.props.expiresAt, -renewalWindowDays);
    return !isBefore(at, windowOpens);
  }

  daysUntilExpiry(at: IsoDateTime): number {
    return Math.ceil((Date.parse(this.props.expiresAt) - Date.parse(at)) / (24 * 60 * 60 * 1000));
  }

  /**
   * Extends validity. Renewing early keeps the original anniversary (the new
   * expiry is measured from the old one) so partners are not penalised for
   * recertifying ahead of time; renewing after expiry restarts from today.
   */
  renew(input: {
    readonly at: IsoDateTime;
    readonly by: UserId;
    readonly validityMonths: number;
    readonly renewalWindowDays: number;
    readonly evidenceEnrollmentIds: readonly Ulid[];
  }): CertificationRenewal {
    if (this.props.status === "revoked") {
      throw new InvalidStateError(`Certification ${this.props.certificationCode} was revoked and cannot be renewed`);
    }
    const at = parseIso(input.at, "at");
    if (!this.isRenewableAt(at, input.renewalWindowDays)) {
      throw new InvalidStateError(
        `Certification ${this.props.certificationCode} can only be renewed within ` +
          `${input.renewalWindowDays} days of ${this.props.expiresAt}`,
        { expiresAt: this.props.expiresAt, at },
      );
    }
    const base = isAfter(at, this.props.expiresAt) ? at : this.props.expiresAt;
    const renewal: CertificationRenewal = {
      renewedAt: at,
      previousExpiresAt: this.props.expiresAt,
      expiresAt: addMonths(base, input.validityMonths),
      renewedBy: input.by,
      evidenceEnrollmentIds: [...input.evidenceEnrollmentIds],
    };
    this.props.renewals.push(renewal);
    this.props.expiresAt = renewal.expiresAt;
    this.props.status = "active";
    this.props.expiredAt = undefined;
    this.props.evidenceEnrollmentIds = [
      ...new Set([...this.props.evidenceEnrollmentIds, ...input.evidenceEnrollmentIds]),
    ];
    this.raise(this.certificationEvent(PrmEventTypes.CertificationRenewed));
    return renewal;
  }

  /** Marks the certification expired once its validity has elapsed. */
  expireIfDue(at: IsoDateTime): boolean {
    if (this.props.status !== "active") return false;
    if (isBefore(at, this.props.expiresAt)) return false;
    this.props.status = "expired";
    this.props.expiredAt = parseIso(at, "at");
    this.raise(this.certificationEvent(PrmEventTypes.CertificationExpired));
    return true;
  }

  revoke(input: { readonly at: IsoDateTime; readonly by: UserId; readonly reason: string }): void {
    if (this.props.status === "revoked") {
      throw new InvalidStateError(`Certification ${this.props.certificationCode} is already revoked`);
    }
    if (input.reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.status = "revoked";
    this.props.revokedAt = parseIso(input.at, "at");
    this.props.revokedBy = input.by;
    this.props.revocationReason = input.reason.trim();
    this.raise(
      envelope({
        eventType: PrmEventTypes.CertificationRevoked,
        aggregateType: "Certification",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          certificationId: this.id,
          certificationCode: this.props.certificationCode,
          partnerId: this.props.partnerId,
          portalUserId: this.props.portalUserId,
          reason: this.props.revocationReason,
        },
      }),
    );
  }

  private certificationEvent(eventType: string) {
    return envelope({
      eventType,
      aggregateType: "Certification",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        certificationId: this.id,
        certificationCode: this.props.certificationCode,
        partnerId: this.props.partnerId,
        portalUserId: this.props.portalUserId,
        awardedAt: this.props.awardedAt,
        expiresAt: this.props.expiresAt,
      },
    });
  }
}

export interface PartnerCertificationSummary {
  readonly partnerId: Ulid;
  /** Distinct individuals holding at least one active certification. */
  readonly certifiedIndividuals: number;
  readonly activeCertificationCodes: readonly string[];
  readonly countsByCode: Readonly<Record<string, number>>;
  readonly expiringWithin90Days: number;
}

/** Rolls individual certifications up to the partner facts the tier engine needs. */
export function summarizeCertifications(
  partnerId: Ulid,
  certifications: readonly Certification[],
  at: IsoDateTime,
): PartnerCertificationSummary {
  const active = certifications.filter((c) => c.partnerId === partnerId && c.isActiveAt(at));
  const countsByCode: Record<string, number> = {};
  const individuals = new Set<Ulid>();
  let expiring = 0;
  for (const certification of active) {
    countsByCode[certification.certificationCode] = (countsByCode[certification.certificationCode] ?? 0) + 1;
    individuals.add(certification.portalUserId);
    if (certification.daysUntilExpiry(at) <= 90) expiring += 1;
  }
  return {
    partnerId,
    certifiedIndividuals: individuals.size,
    activeCertificationCodes: Object.keys(countsByCode).sort(),
    countsByCode,
    expiringWithin90Days: expiring,
  };
}
