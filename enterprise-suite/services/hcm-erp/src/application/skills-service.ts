import {
  ConflictError,
  NotFoundError,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { addDays, type IsoDate } from "../domain/common.js";
import {
  Certification,
  EmployeeCertification,
  EmployeeSkill,
  Skill,
  type ProficiencyLevel,
} from "../domain/skills.js";
import type {
  CertificationRepository,
  Clock,
  EmployeeCertificationRepository,
  EmployeeRepository,
  EmployeeSkillRepository,
  EventOutbox,
  SkillRepository,
} from "./ports.js";

export class SkillsService {
  constructor(
    private readonly skills: SkillRepository,
    private readonly employeeSkills: EmployeeSkillRepository,
    private readonly certifications: CertificationRepository,
    private readonly employeeCertifications: EmployeeCertificationRepository,
    private readonly employees: EmployeeRepository,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------- skills

  defineSkill(tenantId: TenantId, input: { code: string; name: string; category?: string }): Skill {
    if (this.skills.findByCode(tenantId, input.code.trim().toLowerCase())) {
      throw new ConflictError(`Skill code already exists: ${input.code}`);
    }
    const skill = Skill.define(tenantId, input);
    this.skills.save(skill);
    return skill;
  }

  listSkills(tenantId: TenantId): Skill[] {
    return this.skills.listByTenant(tenantId);
  }

  /** Creates or updates the employee's proficiency for a skill (upsert with history). */
  assessSkill(
    tenantId: TenantId,
    input: {
      employeeId: Ulid;
      skillCode: string;
      level: ProficiencyLevel;
      assessedBy: Ulid;
      notes?: string;
    },
  ): EmployeeSkill {
    this.requireEmployedEmployee(tenantId, input.employeeId);
    const skill = this.skills.findByCode(tenantId, input.skillCode.trim().toLowerCase());
    if (!skill) throw new NotFoundError("Skill", input.skillCode);

    const existing = this.employeeSkills.find(tenantId, input.employeeId, skill.id);
    if (existing) {
      existing.reassess({ level: input.level, assessedBy: input.assessedBy, notes: input.notes });
      this.employeeSkills.save(existing);
      this.outbox.append(existing.pullEvents());
      return existing;
    }
    const assessed = EmployeeSkill.assess(tenantId, {
      employeeId: input.employeeId,
      skillId: skill.id,
      level: input.level,
      assessedBy: input.assessedBy,
      notes: input.notes,
    });
    this.employeeSkills.save(assessed);
    this.outbox.append(assessed.pullEvents());
    return assessed;
  }

  listEmployeeSkills(tenantId: TenantId, employeeId: Ulid): EmployeeSkill[] {
    return this.employeeSkills.listByEmployee(tenantId, employeeId);
  }

  /** Everyone holding a skill at or above the requested level — staffing queries. */
  findQualified(tenantId: TenantId, skillCode: string, minLevel: ProficiencyLevel): EmployeeSkill[] {
    const skill = this.skills.findByCode(tenantId, skillCode.trim().toLowerCase());
    if (!skill) throw new NotFoundError("Skill", skillCode);
    return this.employeeSkills
      .listBySkill(tenantId, skill.id)
      .filter((es) => es.currentLevel >= minLevel)
      .sort((a, b) => b.currentLevel - a.currentLevel);
  }

  // -------------------------------------------------------- certifications

  defineCertification(
    tenantId: TenantId,
    input: { code: string; name: string; issuingBody: string; validityMonths?: number },
  ): Certification {
    if (this.certifications.findByCode(tenantId, input.code.trim().toLowerCase())) {
      throw new ConflictError(`Certification code already exists: ${input.code}`);
    }
    const certification = Certification.define(tenantId, input);
    this.certifications.save(certification);
    return certification;
  }

  listCertifications(tenantId: TenantId): Certification[] {
    return this.certifications.listByTenant(tenantId);
  }

  grantCertification(
    tenantId: TenantId,
    input: { employeeId: Ulid; certificationCode: string; issuedAt: IsoDate; credentialRef?: string },
  ): EmployeeCertification {
    this.requireEmployedEmployee(tenantId, input.employeeId);
    const certification = this.certifications.findByCode(
      tenantId,
      input.certificationCode.trim().toLowerCase(),
    );
    if (!certification) throw new NotFoundError("Certification", input.certificationCode);
    const activeGrant = this.employeeCertifications.findActiveGrant(
      tenantId,
      input.employeeId,
      certification.id,
    );
    if (activeGrant) {
      throw new ConflictError(
        `Employee already holds an active "${certification.code}" certification (expires ${activeGrant.expiresAt ?? "never"})`,
      );
    }
    const granted = EmployeeCertification.grant(tenantId, {
      employeeId: input.employeeId,
      certification,
      issuedAt: input.issuedAt,
      credentialRef: input.credentialRef,
    });
    this.employeeCertifications.save(granted);
    this.outbox.append(granted.pullEvents());
    return granted;
  }

  listEmployeeCertifications(tenantId: TenantId, employeeId: Ulid): EmployeeCertification[] {
    return this.employeeCertifications.listByEmployee(tenantId, employeeId);
  }

  revokeCertification(tenantId: TenantId, grantId: Ulid, note: string): EmployeeCertification {
    const grant = this.employeeCertifications.findById(tenantId, grantId);
    if (!grant) throw new NotFoundError("EmployeeCertification", grantId);
    grant.revoke(note);
    this.employeeCertifications.save(grant);
    this.outbox.append(grant.pullEvents());
    return grant;
  }

  /** Compliance query: active grants expiring within `withinDays` of today. */
  listExpiring(tenantId: TenantId, withinDays: number): EmployeeCertification[] {
    const horizon = addDays(this.clock.today(), withinDays);
    return this.employeeCertifications
      .listByTenant(tenantId)
      .filter((grant) => grant.expiresBy(horizon))
      .sort((a, b) => (a.expiresAt! < b.expiresAt! ? -1 : 1));
  }

  /** Scheduled sweep: expires overdue grants and emits events. Returns count. */
  refreshExpirations(tenantId: TenantId, asOf?: IsoDate): number {
    const effectiveAsOf = asOf ?? this.clock.today();
    let expired = 0;
    for (const grant of this.employeeCertifications.listByTenant(tenantId)) {
      if (grant.refreshExpiry(effectiveAsOf)) {
        this.employeeCertifications.save(grant);
        this.outbox.append(grant.pullEvents());
        expired += 1;
      }
    }
    return expired;
  }

  private requireEmployedEmployee(tenantId: TenantId, employeeId: Ulid): void {
    const employee = this.employees.findById(tenantId, employeeId);
    if (!employee) throw new NotFoundError("Employee", employeeId);
    if (!employee.isEmployed()) {
      throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
    }
  }
}
