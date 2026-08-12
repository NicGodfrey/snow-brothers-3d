import { DomainError } from "@enterprise-suite/shared-kernel";
import { PROFICIENCY_LEVELS } from "../../domain/skills.js";
import { actorId, asRecord, dateField, int, optDateField, optInt, optStr, queryInt, requireRole, str, ulidParam, } from "../parse.js";
import { created, jsonOk } from "../router.js";
function proficiency(value) {
    if (!PROFICIENCY_LEVELS.includes(value)) {
        throw new DomainError(`Proficiency level must be 1-5, got ${value}`, "VALIDATION", 422);
    }
    return value;
}
export function registerSkillsRoutes(router, module) {
    const { skillsService } = module;
    router.post("/skills", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        const skill = skillsService.defineSkill(req.ctx.tenantId, {
            code: str(body, "code"),
            name: str(body, "name"),
            category: optStr(body, "category"),
        });
        return created(skill.toJSON());
    });
    router.get("/skills", (req) => jsonOk({ items: skillsService.listSkills(req.ctx.tenantId).map((s) => s.toJSON()) }));
    router.post("/employees/:id/skills", (req) => {
        requireRole(req.ctx, "hr_admin", "manager");
        const body = asRecord(req.body);
        const assessed = skillsService.assessSkill(req.ctx.tenantId, {
            employeeId: ulidParam(req.params, "id"),
            skillCode: str(body, "skillCode"),
            level: proficiency(int(body, "level")),
            assessedBy: actorId(req.ctx),
            notes: optStr(body, "notes"),
        });
        return created(assessed.toJSON());
    });
    router.get("/employees/:id/skills", (req) => jsonOk({
        items: skillsService
            .listEmployeeSkills(req.ctx.tenantId, ulidParam(req.params, "id"))
            .map((es) => es.toJSON()),
    }));
    router.get("/skills/:code/qualified", (req) => {
        const minLevel = proficiency(queryInt(req.query, "minLevel", 3));
        return jsonOk({
            items: skillsService
                .findQualified(req.ctx.tenantId, req.params.code, minLevel)
                .map((es) => es.toJSON()),
        });
    });
    // -------------------------------------------------------- certifications
    router.post("/certifications", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        const certification = skillsService.defineCertification(req.ctx.tenantId, {
            code: str(body, "code"),
            name: str(body, "name"),
            issuingBody: str(body, "issuingBody"),
            validityMonths: optInt(body, "validityMonths"),
        });
        return created(certification.toJSON());
    });
    router.get("/certifications", (req) => jsonOk({ items: skillsService.listCertifications(req.ctx.tenantId).map((c) => c.toJSON()) }));
    router.post("/employees/:id/certifications", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        const grant = skillsService.grantCertification(req.ctx.tenantId, {
            employeeId: ulidParam(req.params, "id"),
            certificationCode: str(body, "certificationCode"),
            issuedAt: dateField(body, "issuedAt"),
            credentialRef: optStr(body, "credentialRef"),
        });
        return created(grant.toJSON());
    });
    router.get("/employees/:id/certifications", (req) => jsonOk({
        items: skillsService
            .listEmployeeCertifications(req.ctx.tenantId, ulidParam(req.params, "id"))
            .map((g) => g.toJSON()),
    }));
    router.post("/employee-certifications/:id/revoke", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        return jsonOk(skillsService
            .revokeCertification(req.ctx.tenantId, ulidParam(req.params, "id"), str(body, "note"))
            .toJSON());
    });
    router.get("/certifications-expiring", (req) => {
        const withinDays = queryInt(req.query, "withinDays", 90);
        return jsonOk({
            items: skillsService.listExpiring(req.ctx.tenantId, withinDays).map((g) => g.toJSON()),
        });
    });
    router.post("/certifications/refresh-expirations", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body ?? {});
        const expiredCount = skillsService.refreshExpirations(req.ctx.tenantId, optDateField(body, "asOf"));
        return jsonOk({ expiredCount });
    });
}
//# sourceMappingURL=skills-routes.js.map