/**
 * Audit use-cases: template authoring, audit planning/execution/scoring.
 *
 * Cross-aggregate policies:
 *  - linking a finding to an NCR/CAPA validates that the target exists in
 *    this tenant
 *  - completing a supplier audit with major non-conformities records a
 *    supplier quality event ("audit-finding") for the SRM scorecard
 */
import {
  DomainError,
  NotFoundError,
  userId,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  Audit,
  AuditChecklistTemplate,
  type AnswerType,
  type AuditResult,
  type AuditStatus,
  type AuditType,
  type Auditee,
  type FindingClassification,
  type ItemAnswer,
} from "../domain/audit.js";
import type {
  AuditRepository,
  AuditTemplateRepository,
  CapaRepository,
  NcrRepository,
} from "../domain/repositories.js";
import { documentSeries, type NumberSeries, type Outbox } from "./ports.js";
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

export class AuditService {
  constructor(
    private readonly templates: AuditTemplateRepository,
    private readonly audits: AuditRepository,
    private readonly ncrs: NcrRepository,
    private readonly capas: CapaRepository,
    private readonly outbox: Outbox,
    private readonly numbers: NumberSeries,
    private readonly supplierQuality: SupplierQualityService,
  ) {}

  private async flushTemplate(template: AuditChecklistTemplate): Promise<void> {
    await this.templates.save(template);
    await this.outbox.append(template.pullEvents());
  }

  private async flushAudit(audit: Audit): Promise<void> {
    await this.audits.save(audit);
    await this.outbox.append(audit.pullEvents());
  }

  // --- Templates -----------------------------------------------------------

  async createTemplate(ctx: TenantContext, cmd: CreateTemplateCommand): Promise<AuditChecklistTemplate> {
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

  async addTemplateSection(ctx: TenantContext, templateId: Ulid, title: string) {
    const template = await this.getTemplate(ctx, templateId);
    const section = template.addSection(title);
    await this.flushTemplate(template);
    return { template, section };
  }

  async addTemplateItem(
    ctx: TenantContext,
    templateId: Ulid,
    sectionId: Ulid,
    input: { question: string; answerType: AnswerType; guidance?: string; requirementRef?: string; weight?: number },
  ) {
    const template = await this.getTemplate(ctx, templateId);
    const item = template.addItem(sectionId, input);
    await this.flushTemplate(template);
    return { template, item };
  }

  async activateTemplate(ctx: TenantContext, templateId: Ulid): Promise<AuditChecklistTemplate> {
    const template = await this.getTemplate(ctx, templateId);
    template.activate();
    await this.flushTemplate(template);
    return template;
  }

  async getTemplate(ctx: TenantContext, templateId: Ulid): Promise<AuditChecklistTemplate> {
    const template = await this.templates.findById(ctx.tenantId, templateId);
    if (!template) throw new NotFoundError("AuditChecklistTemplate", templateId);
    return template;
  }

  async listTemplates(ctx: TenantContext): Promise<AuditChecklistTemplate[]> {
    return this.templates.list(ctx.tenantId);
  }

  // --- Audits --------------------------------------------------------------

  async planAudit(ctx: TenantContext, cmd: PlanAuditCommand): Promise<Audit> {
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

  async startAudit(ctx: TenantContext, auditId: Ulid): Promise<Audit> {
    const audit = await this.getAudit(ctx, auditId);
    audit.start();
    await this.flushAudit(audit);
    return audit;
  }

  async answerItem(
    ctx: TenantContext,
    auditId: Ulid,
    itemId: Ulid,
    answer: ItemAnswer,
    details?: { evidence?: string; comment?: string },
  ): Promise<Audit> {
    const audit = await this.getAudit(ctx, auditId);
    audit.answerItem(itemId, answer, ctx.userId, details);
    await this.flushAudit(audit);
    return audit;
  }

  async recordFinding(
    ctx: TenantContext,
    auditId: Ulid,
    input: {
      classification: FindingClassification;
      description: string;
      itemId?: Ulid;
      requirementRef?: string;
    },
  ) {
    const audit = await this.getAudit(ctx, auditId);
    const finding = audit.recordFinding({ ...input, recordedBy: ctx.userId });
    await this.flushAudit(audit);
    return { audit, finding };
  }

  async linkFinding(
    ctx: TenantContext,
    auditId: Ulid,
    findingId: Ulid,
    link: { ncrId?: Ulid; capaId?: Ulid },
  ) {
    if (link.ncrId) {
      const ncr = await this.ncrs.findById(ctx.tenantId, link.ncrId);
      if (!ncr) throw new NotFoundError("NCR", link.ncrId);
    }
    if (link.capaId) {
      const capa = await this.capas.findById(ctx.tenantId, link.capaId);
      if (!capa) throw new NotFoundError("CAPA", link.capaId);
    }
    const audit = await this.getAudit(ctx, auditId);
    const finding = audit.linkFinding(findingId, link);
    await this.flushAudit(audit);
    return { audit, finding };
  }

  async moveToReview(ctx: TenantContext, auditId: Ulid): Promise<Audit> {
    const audit = await this.getAudit(ctx, auditId);
    audit.moveToReview();
    await this.flushAudit(audit);
    return audit;
  }

  async completeAudit(ctx: TenantContext, auditId: Ulid, summary?: string): Promise<{ audit: Audit; result: AuditResult }> {
    const audit = await this.getAudit(ctx, auditId);
    const result = audit.complete(summary);
    await this.flushAudit(audit);

    const majorNcCount = audit.findings.filter((f) => f.classification === "major-nc").length;
    if (audit.auditType === "supplier" && audit.auditee.supplierId && majorNcCount > 0) {
      await this.supplierQuality.recordEvent(ctx, {
        supplierId: audit.auditee.supplierId,
        eventType: "audit-finding",
        severity: "major",
        description:
          `Supplier audit ${audit.auditNumber} completed with ${majorNcCount} major ` +
          `non-conformit${majorNcCount === 1 ? "y" : "ies"} (score ${result.scorePercent}%, ${result.outcome})`,
        linkage: { auditId: audit.id },
      });
    }
    return { audit, result };
  }

  async closeAudit(ctx: TenantContext, auditId: Ulid): Promise<Audit> {
    const audit = await this.getAudit(ctx, auditId);
    audit.close();
    await this.flushAudit(audit);
    return audit;
  }

  async cancelAudit(ctx: TenantContext, auditId: Ulid, reason: string): Promise<Audit> {
    const audit = await this.getAudit(ctx, auditId);
    audit.cancel(reason);
    await this.flushAudit(audit);
    return audit;
  }

  async getAudit(ctx: TenantContext, auditId: Ulid): Promise<Audit> {
    const audit = await this.audits.findById(ctx.tenantId, auditId);
    if (!audit) throw new NotFoundError("Audit", auditId);
    return audit;
  }

  async listAudits(
    ctx: TenantContext,
    filter?: { status?: AuditStatus; auditType?: AuditType; supplierId?: string },
  ): Promise<Audit[]> {
    return this.audits.list(ctx.tenantId, filter);
  }
}
