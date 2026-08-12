import {
  AggregateRoot,
  DomainError,
  Entity,
  envelope,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { addMonthsClamped, compareDates, type IsoDate } from "./common.js";
import { HcmEvents } from "./events.js";

// ---------------------------------------------------------------------------
// Skill catalog
// ---------------------------------------------------------------------------

export const PROFICIENCY_LEVELS = [1, 2, 3, 4, 5] as const;
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  1: "novice",
  2: "advanced_beginner",
  3: "competent",
  4: "proficient",
  5: "expert",
};

const CODE_RE = /^[a-z][a-z0-9_-]{1,47}$/;

export interface SkillProps {
  code: string;
  name: string;
  category: string;
}

export class Skill extends Entity<SkillProps> {
  private constructor(tenantId: TenantId, props: SkillProps) {
    super(tenantId, props);
  }

  static define(tenantId: TenantId, input: { code: string; name: string; category?: string }): Skill {
    const code = input.code.trim().toLowerCase();
    if (!CODE_RE.test(code)) {
      throw new DomainError(`Invalid skill code "${input.code}"`, "INVALID_SKILL_CODE");
    }
    if (!input.name.trim()) throw new DomainError("Skill name is required", "INVALID_SKILL_NAME");
    return new Skill(tenantId, {
      code,
      name: input.name.trim(),
      category: input.category?.trim().toLowerCase() || "general",
    });
  }

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get category(): string {
    return this.props.category;
  }
}

// ---------------------------------------------------------------------------
// EmployeeSkill — one employee's assessed proficiency, with history
// ---------------------------------------------------------------------------

export interface SkillAssessment {
  readonly level: ProficiencyLevel;
  readonly assessedBy: Ulid;
  readonly assessedAt: IsoDateTime;
  readonly notes?: string;
}

export interface EmployeeSkillProps {
  employeeId: Ulid;
  skillId: Ulid;
  currentLevel: ProficiencyLevel;
  history: SkillAssessment[];
}

export class EmployeeSkill extends AggregateRoot<EmployeeSkillProps> {
  private constructor(tenantId: TenantId, props: EmployeeSkillProps) {
    super(tenantId, props);
  }

  static assess(
    tenantId: TenantId,
    input: { employeeId: Ulid; skillId: Ulid; level: ProficiencyLevel; assessedBy: Ulid; notes?: string },
  ): EmployeeSkill {
    EmployeeSkill.validateLevel(input.level);
    const assessment: SkillAssessment = {
      level: input.level,
      assessedBy: input.assessedBy,
      assessedAt: nowIso(),
      notes: input.notes,
    };
    const skill = new EmployeeSkill(tenantId, {
      employeeId: input.employeeId,
      skillId: input.skillId,
      currentLevel: input.level,
      history: [assessment],
    });
    skill.raiseAssessed(assessment);
    return skill;
  }

  private static validateLevel(level: number): void {
    if (!PROFICIENCY_LEVELS.includes(level as ProficiencyLevel)) {
      throw new DomainError(`Proficiency level must be 1-5, got ${level}`, "INVALID_PROFICIENCY");
    }
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get skillId(): Ulid {
    return this.props.skillId;
  }
  get currentLevel(): ProficiencyLevel {
    return this.props.currentLevel;
  }
  get history(): readonly SkillAssessment[] {
    return this.props.history;
  }

  reassess(input: { level: ProficiencyLevel; assessedBy: Ulid; notes?: string }): void {
    EmployeeSkill.validateLevel(input.level);
    const assessment: SkillAssessment = {
      level: input.level,
      assessedBy: input.assessedBy,
      assessedAt: nowIso(),
      notes: input.notes,
    };
    this.props.history.push(assessment);
    this.props.currentLevel = input.level;
    this.raiseAssessed(assessment);
  }

  private raiseAssessed(assessment: SkillAssessment): void {
    this.raise(
      envelope({
        eventType: HcmEvents.SkillAssessed,
        aggregateType: "EmployeeSkill",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          skillId: this.props.skillId,
          level: assessment.level,
          label: PROFICIENCY_LABELS[assessment.level],
          assessedBy: assessment.assessedBy,
        },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Certification catalog
// ---------------------------------------------------------------------------

export interface CertificationProps {
  code: string;
  name: string;
  issuingBody: string;
  /** Undefined means the certification never expires. */
  validityMonths?: number;
}

export class Certification extends Entity<CertificationProps> {
  private constructor(tenantId: TenantId, props: CertificationProps) {
    super(tenantId, props);
  }

  static define(
    tenantId: TenantId,
    input: { code: string; name: string; issuingBody: string; validityMonths?: number },
  ): Certification {
    const code = input.code.trim().toLowerCase();
    if (!CODE_RE.test(code)) {
      throw new DomainError(`Invalid certification code "${input.code}"`, "INVALID_CERT_CODE");
    }
    if (!input.name.trim()) throw new DomainError("Certification name is required", "INVALID_CERT_NAME");
    if (input.validityMonths !== undefined && (input.validityMonths <= 0 || input.validityMonths > 240)) {
      throw new DomainError("Validity months must be in (0, 240]", "INVALID_VALIDITY");
    }
    return new Certification(tenantId, {
      code,
      name: input.name.trim(),
      issuingBody: input.issuingBody.trim() || "unknown",
      validityMonths: input.validityMonths,
    });
  }

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get issuingBody(): string {
    return this.props.issuingBody;
  }
  get validityMonths(): number | undefined {
    return this.props.validityMonths;
  }
}

// ---------------------------------------------------------------------------
// EmployeeCertification — a granted credential with an expiry lifecycle
// ---------------------------------------------------------------------------

export type EmployeeCertificationStatus = "active" | "expired" | "revoked";

export interface EmployeeCertificationProps {
  employeeId: Ulid;
  certificationId: Ulid;
  issuedAt: IsoDate;
  expiresAt?: IsoDate;
  credentialRef?: string;
  status: EmployeeCertificationStatus;
  revocationNote?: string;
}

export class EmployeeCertification extends AggregateRoot<EmployeeCertificationProps> {
  private constructor(tenantId: TenantId, props: EmployeeCertificationProps) {
    super(tenantId, props);
  }

  static grant(
    tenantId: TenantId,
    input: {
      employeeId: Ulid;
      certification: Certification;
      issuedAt: IsoDate;
      credentialRef?: string;
    },
  ): EmployeeCertification {
    const expiresAt =
      input.certification.validityMonths !== undefined
        ? addMonthsClamped(input.issuedAt, input.certification.validityMonths)
        : undefined;
    const granted = new EmployeeCertification(tenantId, {
      employeeId: input.employeeId,
      certificationId: input.certification.id,
      issuedAt: input.issuedAt,
      expiresAt,
      credentialRef: input.credentialRef?.trim() || undefined,
      status: "active",
    });
    granted.raise(
      envelope({
        eventType: HcmEvents.CertificationGranted,
        aggregateType: "EmployeeCertification",
        aggregateId: granted.id,
        tenantId,
        payload: {
          employeeId: input.employeeId,
          certificationId: input.certification.id,
          certificationCode: input.certification.code,
          issuedAt: input.issuedAt,
          expiresAt,
        },
      }),
    );
    return granted;
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get certificationId(): Ulid {
    return this.props.certificationId;
  }
  get status(): EmployeeCertificationStatus {
    return this.props.status;
  }
  get issuedAt(): IsoDate {
    return this.props.issuedAt;
  }
  get expiresAt(): IsoDate | undefined {
    return this.props.expiresAt;
  }

  /** True when active and expiring on or before the given horizon date. */
  expiresBy(horizon: IsoDate): boolean {
    return (
      this.props.status === "active" &&
      this.props.expiresAt !== undefined &&
      compareDates(this.props.expiresAt, horizon) <= 0
    );
  }

  /** Transitions to expired when past the expiry date. Returns true if it fired. */
  refreshExpiry(asOf: IsoDate): boolean {
    if (this.props.status !== "active" || !this.props.expiresAt) return false;
    if (compareDates(asOf, this.props.expiresAt) <= 0) return false;
    this.props.status = "expired";
    this.raise(
      envelope({
        eventType: HcmEvents.CertificationExpired,
        aggregateType: "EmployeeCertification",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          certificationId: this.props.certificationId,
          expiredAt: this.props.expiresAt,
        },
      }),
    );
    return true;
  }

  revoke(note: string): void {
    if (this.props.status !== "active") {
      throw new DomainError(`Cannot revoke a ${this.props.status} certification`, "INVALID_STATUS_TRANSITION", 409);
    }
    if (!note.trim()) {
      throw new DomainError("A revocation must include a note", "REVOCATION_NOTE_REQUIRED");
    }
    this.props.status = "revoked";
    this.props.revocationNote = note.trim();
    this.raise(
      envelope({
        eventType: HcmEvents.CertificationRevoked,
        aggregateType: "EmployeeCertification",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          certificationId: this.props.certificationId,
          note: this.props.revocationNote,
        },
      }),
    );
  }
}
