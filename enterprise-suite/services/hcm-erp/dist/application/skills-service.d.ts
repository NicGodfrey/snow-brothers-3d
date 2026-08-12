import { type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "../domain/common.js";
import { Certification, EmployeeCertification, EmployeeSkill, Skill, type ProficiencyLevel } from "../domain/skills.js";
import type { CertificationRepository, Clock, EmployeeCertificationRepository, EmployeeRepository, EmployeeSkillRepository, EventOutbox, SkillRepository } from "./ports.js";
export declare class SkillsService {
    private readonly skills;
    private readonly employeeSkills;
    private readonly certifications;
    private readonly employeeCertifications;
    private readonly employees;
    private readonly outbox;
    private readonly clock;
    constructor(skills: SkillRepository, employeeSkills: EmployeeSkillRepository, certifications: CertificationRepository, employeeCertifications: EmployeeCertificationRepository, employees: EmployeeRepository, outbox: EventOutbox, clock: Clock);
    defineSkill(tenantId: TenantId, input: {
        code: string;
        name: string;
        category?: string;
    }): Skill;
    listSkills(tenantId: TenantId): Skill[];
    /** Creates or updates the employee's proficiency for a skill (upsert with history). */
    assessSkill(tenantId: TenantId, input: {
        employeeId: Ulid;
        skillCode: string;
        level: ProficiencyLevel;
        assessedBy: Ulid;
        notes?: string;
    }): EmployeeSkill;
    listEmployeeSkills(tenantId: TenantId, employeeId: Ulid): EmployeeSkill[];
    /** Everyone holding a skill at or above the requested level — staffing queries. */
    findQualified(tenantId: TenantId, skillCode: string, minLevel: ProficiencyLevel): EmployeeSkill[];
    defineCertification(tenantId: TenantId, input: {
        code: string;
        name: string;
        issuingBody: string;
        validityMonths?: number;
    }): Certification;
    listCertifications(tenantId: TenantId): Certification[];
    grantCertification(tenantId: TenantId, input: {
        employeeId: Ulid;
        certificationCode: string;
        issuedAt: IsoDate;
        credentialRef?: string;
    }): EmployeeCertification;
    listEmployeeCertifications(tenantId: TenantId, employeeId: Ulid): EmployeeCertification[];
    revokeCertification(tenantId: TenantId, grantId: Ulid, note: string): EmployeeCertification;
    /** Compliance query: active grants expiring within `withinDays` of today. */
    listExpiring(tenantId: TenantId, withinDays: number): EmployeeCertification[];
    /** Scheduled sweep: expires overdue grants and emits events. Returns count. */
    refreshExpirations(tenantId: TenantId, asOf?: IsoDate): number;
    private requireEmployedEmployee;
}
//# sourceMappingURL=skills-service.d.ts.map