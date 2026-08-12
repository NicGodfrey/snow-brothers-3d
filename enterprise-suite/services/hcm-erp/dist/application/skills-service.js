import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { addDays } from "../domain/common.js";
import { Certification, EmployeeCertification, EmployeeSkill, Skill, } from "../domain/skills.js";
export class SkillsService {
    skills;
    employeeSkills;
    certifications;
    employeeCertifications;
    employees;
    outbox;
    clock;
    constructor(skills, employeeSkills, certifications, employeeCertifications, employees, outbox, clock) {
        this.skills = skills;
        this.employeeSkills = employeeSkills;
        this.certifications = certifications;
        this.employeeCertifications = employeeCertifications;
        this.employees = employees;
        this.outbox = outbox;
        this.clock = clock;
    }
    // ---------------------------------------------------------------- skills
    defineSkill(tenantId, input) {
        if (this.skills.findByCode(tenantId, input.code.trim().toLowerCase())) {
            throw new ConflictError(`Skill code already exists: ${input.code}`);
        }
        const skill = Skill.define(tenantId, input);
        this.skills.save(skill);
        return skill;
    }
    listSkills(tenantId) {
        return this.skills.listByTenant(tenantId);
    }
    /** Creates or updates the employee's proficiency for a skill (upsert with history). */
    assessSkill(tenantId, input) {
        this.requireEmployedEmployee(tenantId, input.employeeId);
        const skill = this.skills.findByCode(tenantId, input.skillCode.trim().toLowerCase());
        if (!skill)
            throw new NotFoundError("Skill", input.skillCode);
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
    listEmployeeSkills(tenantId, employeeId) {
        return this.employeeSkills.listByEmployee(tenantId, employeeId);
    }
    /** Everyone holding a skill at or above the requested level — staffing queries. */
    findQualified(tenantId, skillCode, minLevel) {
        const skill = this.skills.findByCode(tenantId, skillCode.trim().toLowerCase());
        if (!skill)
            throw new NotFoundError("Skill", skillCode);
        return this.employeeSkills
            .listBySkill(tenantId, skill.id)
            .filter((es) => es.currentLevel >= minLevel)
            .sort((a, b) => b.currentLevel - a.currentLevel);
    }
    // -------------------------------------------------------- certifications
    defineCertification(tenantId, input) {
        if (this.certifications.findByCode(tenantId, input.code.trim().toLowerCase())) {
            throw new ConflictError(`Certification code already exists: ${input.code}`);
        }
        const certification = Certification.define(tenantId, input);
        this.certifications.save(certification);
        return certification;
    }
    listCertifications(tenantId) {
        return this.certifications.listByTenant(tenantId);
    }
    grantCertification(tenantId, input) {
        this.requireEmployedEmployee(tenantId, input.employeeId);
        const certification = this.certifications.findByCode(tenantId, input.certificationCode.trim().toLowerCase());
        if (!certification)
            throw new NotFoundError("Certification", input.certificationCode);
        const activeGrant = this.employeeCertifications.findActiveGrant(tenantId, input.employeeId, certification.id);
        if (activeGrant) {
            throw new ConflictError(`Employee already holds an active "${certification.code}" certification (expires ${activeGrant.expiresAt ?? "never"})`);
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
    listEmployeeCertifications(tenantId, employeeId) {
        return this.employeeCertifications.listByEmployee(tenantId, employeeId);
    }
    revokeCertification(tenantId, grantId, note) {
        const grant = this.employeeCertifications.findById(tenantId, grantId);
        if (!grant)
            throw new NotFoundError("EmployeeCertification", grantId);
        grant.revoke(note);
        this.employeeCertifications.save(grant);
        this.outbox.append(grant.pullEvents());
        return grant;
    }
    /** Compliance query: active grants expiring within `withinDays` of today. */
    listExpiring(tenantId, withinDays) {
        const horizon = addDays(this.clock.today(), withinDays);
        return this.employeeCertifications
            .listByTenant(tenantId)
            .filter((grant) => grant.expiresBy(horizon))
            .sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1));
    }
    /** Scheduled sweep: expires overdue grants and emits events. Returns count. */
    refreshExpirations(tenantId, asOf) {
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
    requireEmployedEmployee(tenantId, employeeId) {
        const employee = this.employees.findById(tenantId, employeeId);
        if (!employee)
            throw new NotFoundError("Employee", employeeId);
        if (!employee.isEmployed()) {
            throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
        }
    }
}
//# sourceMappingURL=skills-service.js.map