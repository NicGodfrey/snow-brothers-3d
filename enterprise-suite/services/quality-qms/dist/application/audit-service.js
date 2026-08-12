/**
 * Audit use-cases: template authoring, audit planning/execution/scoring.
 *
 * Cross-aggregate policies:
 *  - linking a finding to an NCR/CAPA validates that the target exists in
 *    this tenant
 *  - completing a supplier audit with major non-conformities records a
 *    supplier quality event ("audit-finding") for the SRM scorecard
 */
import { DomainError, NotFoundError, userId, } from "@enterprise-suite/shared-kernel";
import { Audit, AuditChecklistTemplate, } from "../domain/audit.js";
import { documentSeries } from "./ports.js";
export class AuditService {
    templates;
    audits;
    ncrs;
    capas;
    outbox;
    numbers;
    supplierQuality;
    constructor(templates, audits, ncrs, capas, outbox, numbers, supplierQuality) {
        this.templates = templates;
        this.audits = audits;
        this.ncrs = ncrs;
        this.capas = capas;
        this.outbox = outbox;
        this.numbers = numbers;
        this.supplierQuality = supplierQuality;
    }
    async flushTemplate(template) {
        await this.templates.save(template);
        await this.outbox.append(template.pullEvents());
    }
    async flushAudit(audit) {
        await this.audits.save(audit);
        await this.outbox.append(audit.pullEvents());
    }
    // --- Templates -----------------------------------------------------------
    async createTemplate(ctx, cmd) {
        const existing = await this.templates.findByCode(ctx.tenantId, cmd.code.trim().toUpperCase());
        if (existing) {
            throw new DomainError(`Template code '${cmd.code}' already exists`, "CONFLICT", 409);
        }
        const template = AuditChecklistTemplate.create(ctx.tenantId, cmd);
        for (const sectionInput of cmd.sections ?? []) {
            const section = template.addSection(sectionInput.title);
            for (const item of sectionInput.items) {
                template.addItem(section.id, item);
            }
        }
        await this.flushTemplate(template);
        return template;
    }
    async addTemplateSection(ctx, templateId, title) {
        const template = await this.getTemplate(ctx, templateId);
        const section = template.addSection(title);
        await this.flushTemplate(template);
        return { template, section };
    }
    async addTemplateItem(ctx, templateId, sectionId, input) {
        const template = await this.getTemplate(ctx, templateId);
        const item = template.addItem(sectionId, input);
        await this.flushTemplate(template);
        return { template, item };
    }
    async activateTemplate(ctx, templateId) {
        const template = await this.getTemplate(ctx, templateId);
        template.activate();
        await this.flushTemplate(template);
        return template;
    }
    async getTemplate(ctx, templateId) {
        const template = await this.templates.findById(ctx.tenantId, templateId);
        if (!template)
            throw new NotFoundError("AuditChecklistTemplate", templateId);
        return template;
    }
    async listTemplates(ctx) {
        return this.templates.list(ctx.tenantId);
    }
    // --- Audits --------------------------------------------------------------
    async planAudit(ctx, cmd) {
        const template = await this.getTemplate(ctx, cmd.templateId);
        const auditNumber = await this.numbers.next(ctx.tenantId, documentSeries.audit);
        const audit = Audit.plan(ctx.tenantId, {
            auditNumber,
            auditType: cmd.auditType,
            template,
            scope: cmd.scope,
            auditee: cmd.auditee,
            leadAuditor: ctx.userId,
            auditors: (cmd.auditors ?? []).map(userId),
            plannedFrom: cmd.plannedFrom,
            plannedTo: cmd.plannedTo,
        });
        await this.flushAudit(audit);
        return audit;
    }
    async startAudit(ctx, auditId) {
        const audit = await this.getAudit(ctx, auditId);
        audit.start();
        await this.flushAudit(audit);
        return audit;
    }
    async answerItem(ctx, auditId, itemId, answer, details) {
        const audit = await this.getAudit(ctx, auditId);
        audit.answerItem(itemId, answer, ctx.userId, details);
        await this.flushAudit(audit);
        return audit;
    }
    async recordFinding(ctx, auditId, input) {
        const audit = await this.getAudit(ctx, auditId);
        const finding = audit.recordFinding({ ...input, recordedBy: ctx.userId });
        await this.flushAudit(audit);
        return { audit, finding };
    }
    async linkFinding(ctx, auditId, findingId, link) {
        if (link.ncrId) {
            const ncr = await this.ncrs.findById(ctx.tenantId, link.ncrId);
            if (!ncr)
                throw new NotFoundError("NCR", link.ncrId);
        }
        if (link.capaId) {
            const capa = await this.capas.findById(ctx.tenantId, link.capaId);
            if (!capa)
                throw new NotFoundError("CAPA", link.capaId);
        }
        const audit = await this.getAudit(ctx, auditId);
        const finding = audit.linkFinding(findingId, link);
        await this.flushAudit(audit);
        return { audit, finding };
    }
    async moveToReview(ctx, auditId) {
        const audit = await this.getAudit(ctx, auditId);
        audit.moveToReview();
        await this.flushAudit(audit);
        return audit;
    }
    async completeAudit(ctx, auditId, summary) {
        const audit = await this.getAudit(ctx, auditId);
        const result = audit.complete(summary);
        await this.flushAudit(audit);
        const majorNcCount = audit.findings.filter((f) => f.classification === "major-nc").length;
        if (audit.auditType === "supplier" && audit.auditee.supplierId && majorNcCount > 0) {
            await this.supplierQuality.recordEvent(ctx, {
                supplierId: audit.auditee.supplierId,
                eventType: "audit-finding",
                severity: "major",
                description: `Supplier audit ${audit.auditNumber} completed with ${majorNcCount} major ` +
                    `non-conformit${majorNcCount === 1 ? "y" : "ies"} (score ${result.scorePercent}%, ${result.outcome})`,
                linkage: { auditId: audit.id },
            });
        }
        return { audit, result };
    }
    async closeAudit(ctx, auditId) {
        const audit = await this.getAudit(ctx, auditId);
        audit.close();
        await this.flushAudit(audit);
        return audit;
    }
    async cancelAudit(ctx, auditId, reason) {
        const audit = await this.getAudit(ctx, auditId);
        audit.cancel(reason);
        await this.flushAudit(audit);
        return audit;
    }
    async getAudit(ctx, auditId) {
        const audit = await this.audits.findById(ctx.tenantId, auditId);
        if (!audit)
            throw new NotFoundError("Audit", auditId);
        return audit;
    }
    async listAudits(ctx, filter) {
        return this.audits.list(ctx.tenantId, filter);
    }
}
//# sourceMappingURL=audit-service.js.map