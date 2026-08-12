import { DomainError } from "@enterprise-suite/shared-kernel";
import { asObject, optionalNumber, optionalString, optionalUlid, requireEnum, requireIsoDate, requireObjectArray, requireString, requireUlid, ulidParam, } from "../validation.js";
const AUDIT_TYPES = ["internal", "supplier", "process", "certification"];
const AUDIT_STATUSES = [
    "planned", "in-progress", "review", "completed", "closed", "cancelled",
];
const ANSWER_TYPES = ["conformity", "score", "yes-no"];
function parseAnswer(obj) {
    const kind = requireEnum(obj, "kind", ANSWER_TYPES);
    switch (kind) {
        case "conformity":
            return {
                kind,
                value: requireEnum(obj, "value", ["conform", "minor-nc", "major-nc", "not-applicable"]),
            };
        case "score": {
            const value = optionalNumber(obj, "value");
            if (value === undefined)
                throw new DomainError("'value' is required for score answers", "VALIDATION");
            return { kind, value };
        }
        case "yes-no":
            return { kind, value: requireEnum(obj, "value", ["yes", "no", "not-applicable"]) };
    }
}
export function registerAuditRoutes(router, audits) {
    // --- Templates -----------------------------------------------------------
    router.post("/audit-templates", async ({ ctx, body }) => {
        const obj = asObject(body);
        const sectionsRaw = obj["sections"] ? requireObjectArray(obj, "sections") : undefined;
        const template = await audits.createTemplate(ctx, {
            code: requireString(obj, "code"),
            title: requireString(obj, "title"),
            standard: optionalString(obj, "standard"),
            sections: sectionsRaw?.map((s) => ({
                title: requireString(s, "title"),
                items: requireObjectArray(s, "items").map((i) => ({
                    question: requireString(i, "question"),
                    answerType: requireEnum(i, "answerType", ANSWER_TYPES),
                    guidance: optionalString(i, "guidance"),
                    requirementRef: optionalString(i, "requirementRef"),
                    weight: optionalNumber(i, "weight"),
                })),
            })),
        });
        return { status: 201, body: template.toJSON() };
    });
    router.get("/audit-templates", async ({ ctx }) => {
        const items = await audits.listTemplates(ctx);
        return { body: { items: items.map((t) => t.toJSON()), total: items.length } };
    });
    router.get("/audit-templates/:id", async ({ ctx, params }) => {
        const template = await audits.getTemplate(ctx, ulidParam(params, "id"));
        return { body: template.toJSON() };
    });
    router.post("/audit-templates/:id/sections", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        const { template, section } = await audits.addTemplateSection(ctx, ulidParam(params, "id"), requireString(obj, "title"));
        return { status: 201, body: { template: template.toJSON(), section } };
    });
    router.post("/audit-templates/:id/sections/:sectionId/items", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        const { template, item } = await audits.addTemplateItem(ctx, ulidParam(params, "id"), ulidParam(params, "sectionId"), {
            question: requireString(obj, "question"),
            answerType: requireEnum(obj, "answerType", ANSWER_TYPES),
            guidance: optionalString(obj, "guidance"),
            requirementRef: optionalString(obj, "requirementRef"),
            weight: optionalNumber(obj, "weight"),
        });
        return { status: 201, body: { template: template.toJSON(), item } };
    });
    router.post("/audit-templates/:id/activate", async ({ ctx, params }) => {
        return { body: (await audits.activateTemplate(ctx, ulidParam(params, "id"))).toJSON() };
    });
    // --- Audits --------------------------------------------------------------
    router.post("/audits", async ({ ctx, body }) => {
        const obj = asObject(body);
        const auditeeRaw = asObject(obj["auditee"], "auditee");
        const auditorsRaw = obj["auditors"];
        const audit = await audits.planAudit(ctx, {
            templateId: requireUlid(obj, "templateId"),
            auditType: requireEnum(obj, "auditType", AUDIT_TYPES),
            scope: requireString(obj, "scope"),
            auditee: {
                site: optionalString(auditeeRaw, "site"),
                department: optionalString(auditeeRaw, "department"),
                supplierId: optionalString(auditeeRaw, "supplierId"),
            },
            auditors: Array.isArray(auditorsRaw) ? auditorsRaw.map(String) : undefined,
            plannedFrom: requireIsoDate(obj, "plannedFrom"),
            plannedTo: requireIsoDate(obj, "plannedTo"),
        });
        return { status: 201, body: audit.toJSON() };
    });
    router.get("/audits", async ({ ctx, query }) => {
        const status = query.get("status");
        const auditType = query.get("auditType");
        const items = await audits.listAudits(ctx, {
            status: status && AUDIT_STATUSES.includes(status) ? status : undefined,
            auditType: auditType && AUDIT_TYPES.includes(auditType) ? auditType : undefined,
            supplierId: query.get("supplierId") ?? undefined,
        });
        return { body: { items: items.map((a) => a.toJSON()), total: items.length } };
    });
    router.get("/audits/:id", async ({ ctx, params }) => {
        return { body: (await audits.getAudit(ctx, ulidParam(params, "id"))).toJSON() };
    });
    router.post("/audits/:id/start", async ({ ctx, params }) => {
        return { body: (await audits.startAudit(ctx, ulidParam(params, "id"))).toJSON() };
    });
    router.post("/audits/:id/responses", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        const answer = parseAnswer(asObject(obj["answer"], "answer"));
        const audit = await audits.answerItem(ctx, ulidParam(params, "id"), requireUlid(obj, "itemId"), answer, {
            evidence: optionalString(obj, "evidence"),
            comment: optionalString(obj, "comment"),
        });
        return { status: 201, body: audit.toJSON() };
    });
    router.post("/audits/:id/findings", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        const { audit, finding } = await audits.recordFinding(ctx, ulidParam(params, "id"), {
            classification: requireEnum(obj, "classification", ["observation", "ofi", "minor-nc", "major-nc"]),
            description: requireString(obj, "description"),
            itemId: optionalUlid(obj, "itemId"),
            requirementRef: optionalString(obj, "requirementRef"),
        });
        return { status: 201, body: { audit: audit.toJSON(), finding } };
    });
    router.post("/audits/:id/findings/:findingId/link", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        const { audit, finding } = await audits.linkFinding(ctx, ulidParam(params, "id"), ulidParam(params, "findingId"), { ncrId: optionalUlid(obj, "ncrId"), capaId: optionalUlid(obj, "capaId") });
        return { body: { audit: audit.toJSON(), finding } };
    });
    router.post("/audits/:id/review", async ({ ctx, params }) => {
        return { body: (await audits.moveToReview(ctx, ulidParam(params, "id"))).toJSON() };
    });
    router.post("/audits/:id/complete", async ({ ctx, params, body }) => {
        const obj = body === undefined ? {} : asObject(body);
        const { audit, result } = await audits.completeAudit(ctx, ulidParam(params, "id"), optionalString(obj, "summary"));
        return { body: { audit: audit.toJSON(), result } };
    });
    router.post("/audits/:id/close", async ({ ctx, params }) => {
        return { body: (await audits.closeAudit(ctx, ulidParam(params, "id"))).toJSON() };
    });
    router.post("/audits/:id/cancel", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        return {
            body: (await audits.cancelAudit(ctx, ulidParam(params, "id"), requireString(obj, "reason"))).toJSON(),
        };
    });
}
//# sourceMappingURL=audit-routes.js.map