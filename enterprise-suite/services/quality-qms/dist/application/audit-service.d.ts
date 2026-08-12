/**
 * Audit use-cases: template authoring, audit planning/execution/scoring.
 *
 * Cross-aggregate policies:
 *  - linking a finding to an NCR/CAPA validates that the target exists in
 *    this tenant
 *  - completing a supplier audit with major non-conformities records a
 *    supplier quality event ("audit-finding") for the SRM scorecard
 */
import { type IsoDateTime, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { Audit, AuditChecklistTemplate, type AnswerType, type AuditResult, type AuditStatus, type AuditType, type Auditee, type FindingClassification, type ItemAnswer } from "../domain/audit.js";
import type { AuditRepository, AuditTemplateRepository, CapaRepository, NcrRepository } from "../domain/repositories.js";
import { type NumberSeries, type Outbox } from "./ports.js";
import type { SupplierQualityService } from "./supplier-quality-service.js";
export interface CreateTemplateCommand {
    code: string;
    title: string;
    standard?: string;
    sections?: {
        title: string;
        items: {
            question: string;
            answerType: AnswerType;
            guidance?: string;
            requirementRef?: string;
            weight?: number;
        }[];
    }[];
}
export interface PlanAuditCommand {
    templateId: Ulid;
    auditType: AuditType;
    scope: string;
    auditee: Auditee;
    auditors?: string[];
    plannedFrom: IsoDateTime;
    plannedTo: IsoDateTime;
}
export declare class AuditService {
    private readonly templates;
    private readonly audits;
    private readonly ncrs;
    private readonly capas;
    private readonly outbox;
    private readonly numbers;
    private readonly supplierQuality;
    constructor(templates: AuditTemplateRepository, audits: AuditRepository, ncrs: NcrRepository, capas: CapaRepository, outbox: Outbox, numbers: NumberSeries, supplierQuality: SupplierQualityService);
    private flushTemplate;
    private flushAudit;
    createTemplate(ctx: TenantContext, cmd: CreateTemplateCommand): Promise<AuditChecklistTemplate>;
    addTemplateSection(ctx: TenantContext, templateId: Ulid, title: string): Promise<{
        template: AuditChecklistTemplate;
        section: import("../domain/audit.js").ChecklistSection;
    }>;
    addTemplateItem(ctx: TenantContext, templateId: Ulid, sectionId: Ulid, input: {
        question: string;
        answerType: AnswerType;
        guidance?: string;
        requirementRef?: string;
        weight?: number;
    }): Promise<{
        template: AuditChecklistTemplate;
        item: import("../domain/audit.js").ChecklistItem;
    }>;
    activateTemplate(ctx: TenantContext, templateId: Ulid): Promise<AuditChecklistTemplate>;
    getTemplate(ctx: TenantContext, templateId: Ulid): Promise<AuditChecklistTemplate>;
    listTemplates(ctx: TenantContext): Promise<AuditChecklistTemplate[]>;
    planAudit(ctx: TenantContext, cmd: PlanAuditCommand): Promise<Audit>;
    startAudit(ctx: TenantContext, auditId: Ulid): Promise<Audit>;
    answerItem(ctx: TenantContext, auditId: Ulid, itemId: Ulid, answer: ItemAnswer, details?: {
        evidence?: string;
        comment?: string;
    }): Promise<Audit>;
    recordFinding(ctx: TenantContext, auditId: Ulid, input: {
        classification: FindingClassification;
        description: string;
        itemId?: Ulid;
        requirementRef?: string;
    }): Promise<{
        audit: Audit;
        finding: import("../domain/audit.js").AuditFinding;
    }>;
    linkFinding(ctx: TenantContext, auditId: Ulid, findingId: Ulid, link: {
        ncrId?: Ulid;
        capaId?: Ulid;
    }): Promise<{
        audit: Audit;
        finding: import("../domain/audit.js").AuditFinding;
    }>;
    moveToReview(ctx: TenantContext, auditId: Ulid): Promise<Audit>;
    completeAudit(ctx: TenantContext, auditId: Ulid, summary?: string): Promise<{
        audit: Audit;
        result: AuditResult;
    }>;
    closeAudit(ctx: TenantContext, auditId: Ulid): Promise<Audit>;
    cancelAudit(ctx: TenantContext, auditId: Ulid, reason: string): Promise<Audit>;
    getAudit(ctx: TenantContext, auditId: Ulid): Promise<Audit>;
    listAudits(ctx: TenantContext, filter?: {
        status?: AuditStatus;
        auditType?: AuditType;
        supplierId?: string;
    }): Promise<Audit[]>;
}
//# sourceMappingURL=audit-service.d.ts.map