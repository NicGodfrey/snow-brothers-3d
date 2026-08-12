import { AggregateRoot, DomainError, Entity, envelope, nowIso, } from "@enterprise-suite/shared-kernel";
import { addMonthsClamped, compareDates } from "./common.js";
import { HcmEvents } from "./events.js";
// ---------------------------------------------------------------------------
// Skill catalog
// ---------------------------------------------------------------------------
export const PROFICIENCY_LEVELS = [1, 2, 3, 4, 5];
export const PROFICIENCY_LABELS = {
    1: "novice",
    2: "advanced_beginner",
    3: "competent",
    4: "proficient",
    5: "expert",
};
const CODE_RE = /^[a-z][a-z0-9_-]{1,47}$/;
export class Skill extends Entity {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static define(tenantId, input) {
        const code = input.code.trim().toLowerCase();
        if (!CODE_RE.test(code)) {
            throw new DomainError(`Invalid skill code "${input.code}"`, "INVALID_SKILL_CODE");
        }
        if (!input.name.trim())
            throw new DomainError("Skill name is required", "INVALID_SKILL_NAME");
        return new Skill(tenantId, {
            code,
            name: input.name.trim(),
            category: input.category?.trim().toLowerCase() || "general",
        });
    }
    get code() {
        return this.props.code;
    }
    get name() {
        return this.props.name;
    }
    get category() {
        return this.props.category;
    }
}
export class EmployeeSkill extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static assess(tenantId, input) {
        EmployeeSkill.validateLevel(input.level);
        const assessment = {
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
    static validateLevel(level) {
        if (!PROFICIENCY_LEVELS.includes(level)) {
            throw new DomainError(`Proficiency level must be 1-5, got ${level}`, "INVALID_PROFICIENCY");
        }
    }
    get employeeId() {
        return this.props.employeeId;
    }
    get skillId() {
        return this.props.skillId;
    }
    get currentLevel() {
        return this.props.currentLevel;
    }
    get history() {
        return this.props.history;
    }
    reassess(input) {
        EmployeeSkill.validateLevel(input.level);
        const assessment = {
            level: input.level,
            assessedBy: input.assessedBy,
            assessedAt: nowIso(),
            notes: input.notes,
        };
        this.props.history.push(assessment);
        this.props.currentLevel = input.level;
        this.raiseAssessed(assessment);
    }
    raiseAssessed(assessment) {
        this.raise(envelope({
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
        }));
    }
}
export class Certification extends Entity {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static define(tenantId, input) {
        const code = input.code.trim().toLowerCase();
        if (!CODE_RE.test(code)) {
            throw new DomainError(`Invalid certification code "${input.code}"`, "INVALID_CERT_CODE");
        }
        if (!input.name.trim())
            throw new DomainError("Certification name is required", "INVALID_CERT_NAME");
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
    get code() {
        return this.props.code;
    }
    get name() {
        return this.props.name;
    }
    get issuingBody() {
        return this.props.issuingBody;
    }
    get validityMonths() {
        return this.props.validityMonths;
    }
}
export class EmployeeCertification extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static grant(tenantId, input) {
        const expiresAt = input.certification.validityMonths !== undefined
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
        granted.raise(envelope({
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
        }));
        return granted;
    }
    get employeeId() {
        return this.props.employeeId;
    }
    get certificationId() {
        return this.props.certificationId;
    }
    get status() {
        return this.props.status;
    }
    get issuedAt() {
        return this.props.issuedAt;
    }
    get expiresAt() {
        return this.props.expiresAt;
    }
    /** True when active and expiring on or before the given horizon date. */
    expiresBy(horizon) {
        return (this.props.status === "active" &&
            this.props.expiresAt !== undefined &&
            compareDates(this.props.expiresAt, horizon) <= 0);
    }
    /** Transitions to expired when past the expiry date. Returns true if it fired. */
    refreshExpiry(asOf) {
        if (this.props.status !== "active" || !this.props.expiresAt)
            return false;
        if (compareDates(asOf, this.props.expiresAt) <= 0)
            return false;
        this.props.status = "expired";
        this.raise(envelope({
            eventType: HcmEvents.CertificationExpired,
            aggregateType: "EmployeeCertification",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                employeeId: this.props.employeeId,
                certificationId: this.props.certificationId,
                expiredAt: this.props.expiresAt,
            },
        }));
        return true;
    }
    revoke(note) {
        if (this.props.status !== "active") {
            throw new DomainError(`Cannot revoke a ${this.props.status} certification`, "INVALID_STATUS_TRANSITION", 409);
        }
        if (!note.trim()) {
            throw new DomainError("A revocation must include a note", "REVOCATION_NOTE_REQUIRED");
        }
        this.props.status = "revoked";
        this.props.revocationNote = note.trim();
        this.raise(envelope({
            eventType: HcmEvents.CertificationRevoked,
            aggregateType: "EmployeeCertification",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                employeeId: this.props.employeeId,
                certificationId: this.props.certificationId,
                note: this.props.revocationNote,
            },
        }));
    }
}
//# sourceMappingURL=skills.js.map