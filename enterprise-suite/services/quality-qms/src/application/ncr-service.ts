/**
 * NCR use-cases: creation, containment, disposition (with four-eyes
 * approval), closure, and escalation to CAPA.
 *
 * Cross-aggregate policies here:
 *  - opening a supplier-linked NCR records a supplier quality event
 *    ("ncr-issued") unless the caller suppresses it (the lot service does,
 *    because it records a richer "incoming-inspection-failure" itself)
 *  - approval of dispositions requires the "quality-manager" role
 *  - escalation creates the CAPA, links both directions, and copies
 *    linkage (supplier, audit) onto the CAPA source
 */
import {
  ForbiddenError,
  NotFoundError,
  roleCode,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { CapaCase, CapaPriority, CapaType, RiskRating } from "../domain/capa.js";
import {
  NonConformanceReport,
  type DispositionType,
  type NcrLinkage,
  type NcrSeverity,
  type NcrSource,
  type NcrStatus,
} from "../domain/ncr.js";
import type { NcrRepository } from "../domain/repositories.js";
import type { CapaService } from "./capa-service.js";
import { documentSeries, type NumberSeries, type Outbox } from "./ports.js";
import type { SupplierQualityService } from "./supplier-quality-service.js";

const QUALITY_MANAGER = roleCode("quality-manager");

export interface CreateNcrCommand {
  title: string;
  description: string;
  source: NcrSource;
  severity: NcrSeverity;
  defectCode?: string;
  quantityAffected?: number;
  uom?: string;
  materialCode?: string;
  linkage?: NcrLinkage;
}

export interface EscalateToCapaCommand {
  type?: CapaType;
  title?: string;
  description?: string;
  priority?: CapaPriority;
  riskRating?: RiskRating;
}

export class NcrService {
  constructor(
    private readonly ncrs: NcrRepository,
    private readonly outbox: Outbox,
    private readonly numbers: NumberSeries,
    private readonly capaService: CapaService,
    private readonly supplierQuality: SupplierQualityService,
  ) {}

  private async flush(ncr: NonConformanceReport): Promise<void> {
    await this.ncrs.save(ncr);
    await this.outbox.append(ncr.pullEvents());
  }

  async createNcr(
    ctx: TenantContext,
    cmd: CreateNcrCommand,
    options?: { autoSubmit?: boolean; recordSupplierEvent?: boolean },
  ): Promise<NonConformanceReport> {
    const ncrNumber = await this.numbers.next(ctx.tenantId, documentSeries.ncr);
    const ncr = NonConformanceReport.create(ctx.tenantId, { ncrNumber, ...cmd });
    if (options?.autoSubmit) {
      ncr.submit();
    }
    await this.flush(ncr);

    if (
      ncr.status === "open" &&
      ncr.linkage.supplierId &&
      (options?.recordSupplierEvent ?? true)
    ) {
      await this.supplierQuality.recordEvent(ctx, {
        supplierId: ncr.linkage.supplierId,
        eventType: "ncr-issued",
        severity: ncr.severity,
        description: `NCR ${ncr.ncrNumber} opened: ${ncr.title}`,
        linkage: {
          ncrId: ncr.id,
          inspectionLotId: ncr.linkage.inspectionLotId,
          purchaseOrderRef: ncr.linkage.purchaseOrderRef,
          materialCode: ncr.materialCode,
        },
      });
    }
    return ncr;
  }

  async submit(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport> {
    const ncr = await this.getNcr(ctx, ncrId);
    ncr.submit();
    await this.flush(ncr);
    if (ncr.linkage.supplierId) {
      await this.supplierQuality.recordEvent(ctx, {
        supplierId: ncr.linkage.supplierId,
        eventType: "ncr-issued",
        severity: ncr.severity,
        description: `NCR ${ncr.ncrNumber} opened: ${ncr.title}`,
        linkage: { ncrId: ncr.id, inspectionLotId: ncr.linkage.inspectionLotId },
      });
    }
    return ncr;
  }

  async startContainment(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport> {
    const ncr = await this.getNcr(ctx, ncrId);
    ncr.startContainment();
    await this.flush(ncr);
    return ncr;
  }

  async addContainmentAction(
    ctx: TenantContext,
    ncrId: Ulid,
    input: { description: string; dueAt: IsoDateTime },
  ) {
    const ncr = await this.getNcr(ctx, ncrId);
    const action = ncr.addContainmentAction({ ...input, owner: ctx.userId });
    await this.flush(ncr);
    return { ncr, action };
  }

  async completeContainmentAction(ctx: TenantContext, ncrId: Ulid, actionId: Ulid, note?: string) {
    const ncr = await this.getNcr(ctx, ncrId);
    const action = ncr.completeContainmentAction(actionId, note);
    await this.flush(ncr);
    return { ncr, action };
  }

  async moveToDisposition(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport> {
    const ncr = await this.getNcr(ctx, ncrId);
    ncr.moveToDisposition();
    await this.flush(ncr);
    return ncr;
  }

  async recordDisposition(
    ctx: TenantContext,
    ncrId: Ulid,
    input: { type: DispositionType; justification: string },
  ): Promise<NonConformanceReport> {
    const ncr = await this.getNcr(ctx, ncrId);
    ncr.recordDisposition({ ...input, decidedBy: ctx.userId });
    await this.flush(ncr);
    return ncr;
  }

  async approveDisposition(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport> {
    if (!ctx.roles.includes(QUALITY_MANAGER)) {
      throw new ForbiddenError("Disposition approval requires the 'quality-manager' role");
    }
    const ncr = await this.getNcr(ctx, ncrId);
    ncr.approveDisposition(ctx.userId);
    await this.flush(ncr);
    return ncr;
  }

  async escalateToCapa(
    ctx: TenantContext,
    ncrId: Ulid,
    cmd?: EscalateToCapaCommand,
  ): Promise<{ ncr: NonConformanceReport; capa: CapaCase }> {
    const ncr = await this.getNcr(ctx, ncrId);
    const capa = await this.capaService.createCapa(ctx, {
      type: cmd?.type ?? "corrective",
      title: cmd?.title ?? `CAPA for ${ncr.ncrNumber}: ${ncr.title}`,
      description:
        cmd?.description ??
        `Escalated from NCR ${ncr.ncrNumber} (severity ${ncr.severity}).\n${ncr.description}`,
      priority: cmd?.priority ?? (ncr.severity === "critical" ? "urgent" : "high"),
      riskRating: cmd?.riskRating,
      source: {
        ncrIds: [ncr.id],
        supplierId: ncr.linkage.supplierId,
        auditId: ncr.linkage.auditId,
        customerRef: ncr.linkage.customerRef,
      },
    });
    ncr.linkCapa(capa.id);
    await this.flush(ncr);
    return { ncr, capa };
  }

  async close(ctx: TenantContext, ncrId: Ulid, note?: string): Promise<NonConformanceReport> {
    const ncr = await this.getNcr(ctx, ncrId);
    ncr.close(ctx.userId, note);
    await this.flush(ncr);
    return ncr;
  }

  async cancel(ctx: TenantContext, ncrId: Ulid, reason: string): Promise<NonConformanceReport> {
    const ncr = await this.getNcr(ctx, ncrId);
    ncr.cancel(ctx.userId, reason);
    await this.flush(ncr);
    return ncr;
  }

  async getNcr(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport> {
    const ncr = await this.ncrs.findById(ctx.tenantId, ncrId);
    if (!ncr) throw new NotFoundError("NCR", ncrId);
    return ncr;
  }

  async listNcrs(
    ctx: TenantContext,
    filter?: { status?: NcrStatus; severity?: NcrSeverity; supplierId?: string; inspectionLotId?: Ulid },
  ): Promise<NonConformanceReport[]> {
    return this.ncrs.list(ctx.tenantId, filter);
  }
}
