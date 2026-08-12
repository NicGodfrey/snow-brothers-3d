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
import { ForbiddenError, NotFoundError, roleCode, } from "@enterprise-suite/shared-kernel";
import { NonConformanceReport, } from "../domain/ncr.js";
import { documentSeries } from "./ports.js";
const QUALITY_MANAGER = roleCode("quality-manager");
export class NcrService {
    ncrs;
    outbox;
    numbers;
    capaService;
    supplierQuality;
    constructor(ncrs, outbox, numbers, capaService, supplierQuality) {
        this.ncrs = ncrs;
        this.outbox = outbox;
        this.numbers = numbers;
        this.capaService = capaService;
        this.supplierQuality = supplierQuality;
    }
    async flush(ncr) {
        await this.ncrs.save(ncr);
        await this.outbox.append(ncr.pullEvents());
    }
    async createNcr(ctx, cmd, options) {
        const ncrNumber = await this.numbers.next(ctx.tenantId, documentSeries.ncr);
        const ncr = NonConformanceReport.create(ctx.tenantId, { ncrNumber, ...cmd });
        if (options?.autoSubmit) {
            ncr.submit();
        }
        await this.flush(ncr);
        if (ncr.status === "open" &&
            ncr.linkage.supplierId &&
            (options?.recordSupplierEvent ?? true)) {
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
    async submit(ctx, ncrId) {
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
    async startContainment(ctx, ncrId) {
        const ncr = await this.getNcr(ctx, ncrId);
        ncr.startContainment();
        await this.flush(ncr);
        return ncr;
    }
    async addContainmentAction(ctx, ncrId, input) {
        const ncr = await this.getNcr(ctx, ncrId);
        const action = ncr.addContainmentAction({ ...input, owner: ctx.userId });
        await this.flush(ncr);
        return { ncr, action };
    }
    async completeContainmentAction(ctx, ncrId, actionId, note) {
        const ncr = await this.getNcr(ctx, ncrId);
        const action = ncr.completeContainmentAction(actionId, note);
        await this.flush(ncr);
        return { ncr, action };
    }
    async moveToDisposition(ctx, ncrId) {
        const ncr = await this.getNcr(ctx, ncrId);
        ncr.moveToDisposition();
        await this.flush(ncr);
        return ncr;
    }
    async recordDisposition(ctx, ncrId, input) {
        const ncr = await this.getNcr(ctx, ncrId);
        ncr.recordDisposition({ ...input, decidedBy: ctx.userId });
        await this.flush(ncr);
        return ncr;
    }
    async approveDisposition(ctx, ncrId) {
        if (!ctx.roles.includes(QUALITY_MANAGER)) {
            throw new ForbiddenError("Disposition approval requires the 'quality-manager' role");
        }
        const ncr = await this.getNcr(ctx, ncrId);
        ncr.approveDisposition(ctx.userId);
        await this.flush(ncr);
        return ncr;
    }
    async escalateToCapa(ctx, ncrId, cmd) {
        const ncr = await this.getNcr(ctx, ncrId);
        const capa = await this.capaService.createCapa(ctx, {
            type: cmd?.type ?? "corrective",
            title: cmd?.title ?? `CAPA for ${ncr.ncrNumber}: ${ncr.title}`,
            description: cmd?.description ??
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
    async close(ctx, ncrId, note) {
        const ncr = await this.getNcr(ctx, ncrId);
        ncr.close(ctx.userId, note);
        await this.flush(ncr);
        return ncr;
    }
    async cancel(ctx, ncrId, reason) {
        const ncr = await this.getNcr(ctx, ncrId);
        ncr.cancel(ctx.userId, reason);
        await this.flush(ncr);
        return ncr;
    }
    async getNcr(ctx, ncrId) {
        const ncr = await this.ncrs.findById(ctx.tenantId, ncrId);
        if (!ncr)
            throw new NotFoundError("NCR", ncrId);
        return ncr;
    }
    async listNcrs(ctx, filter) {
        return this.ncrs.list(ctx.tenantId, filter);
    }
}
//# sourceMappingURL=ncr-service.js.map