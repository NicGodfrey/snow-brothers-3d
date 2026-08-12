import { AggregateRoot, Entity, type IsoDateTime, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "./common.js";
export declare const PROFICIENCY_LEVELS: readonly [1, 2, 3, 4, 5];
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];
export declare const PROFICIENCY_LABELS: Record<ProficiencyLevel, string>;
export interface SkillProps {
    code: string;
    name: string;
    category: string;
}
export declare class Skill extends Entity<SkillProps> {
    private constructor();
    static define(tenantId: TenantId, input: {
        code: string;
        name: string;
        category?: string;
    }): Skill;
    get code(): string;
    get name(): string;
    get category(): string;
}
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
export declare class EmployeeSkill extends AggregateRoot<EmployeeSkillProps> {
    private constructor();
    static assess(tenantId: TenantId, input: {
        employeeId: Ulid;
        skillId: Ulid;
        level: ProficiencyLevel;
        assessedBy: Ulid;
        notes?: string;
    }): EmployeeSkill;
    private static validateLevel;
    get employeeId(): Ulid;
    get skillId(): Ulid;
    get currentLevel(): ProficiencyLevel;
    get history(): readonly SkillAssessment[];
    reassess(input: {
        level: ProficiencyLevel;
        assessedBy: Ulid;
        notes?: string;
    }): void;
    private raiseAssessed;
}
export interface CertificationProps {
    code: string;
    name: string;
    issuingBody: string;
    /** Undefined means the certification never expires. */
    validityMonths?: number;
}
export declare class Certification extends Entity<CertificationProps> {
    private constructor();
    static define(tenantId: TenantId, input: {
        code: string;
        name: string;
        issuingBody: string;
        validityMonths?: number;
    }): Certification;
    get code(): string;
    get name(): string;
    get issuingBody(): string;
    get validityMonths(): number | undefined;
}
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
export declare class EmployeeCertification extends AggregateRoot<EmployeeCertificationProps> {
    private constructor();
    static grant(tenantId: TenantId, input: {
        employeeId: Ulid;
        certification: Certification;
        issuedAt: IsoDate;
        credentialRef?: string;
    }): EmployeeCertification;
    get employeeId(): Ulid;
    get certificationId(): Ulid;
    get status(): EmployeeCertificationStatus;
    get issuedAt(): IsoDate;
    get expiresAt(): IsoDate | undefined;
    /** True when active and expiring on or before the given horizon date. */
    expiresBy(horizon: IsoDate): boolean;
    /** Transitions to expired when past the expiry date. Returns true if it fired. */
    refreshExpiry(asOf: IsoDate): boolean;
    revoke(note: string): void;
}
//# sourceMappingURL=skills.d.ts.map