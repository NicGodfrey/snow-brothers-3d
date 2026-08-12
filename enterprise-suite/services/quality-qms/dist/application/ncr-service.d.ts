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
import { type IsoDateTime, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { CapaCase, CapaPriority, CapaType, RiskRating } from "../domain/capa.js";
import { NonConformanceReport, type DispositionType, type NcrLinkage, type NcrSeverity, type NcrSource, type NcrStatus } from "../domain/ncr.js";
import type { NcrRepository } from "../domain/repositories.js";
import type { CapaService } from "./capa-service.js";
import { type NumberSeries, type Outbox } from "./ports.js";
import type { SupplierQualityService } from "./supplier-quality-service.js";
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
export declare class NcrService {
    private readonly ncrs;
    private readonly outbox;
    private readonly numbers;
    private readonly capaService;
    private readonly supplierQuality;
    constructor(ncrs: NcrRepository, outbox: Outbox, numbers: NumberSeries, capaService: CapaService, supplierQuality: SupplierQualityService);
    private flush;
    createNcr(ctx: TenantContext, cmd: CreateNcrCommand, options?: {
        autoSubmit?: boolean;
        recordSupplierEvent?: boolean;
    }): Promise<NonConformanceReport>;
    submit(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport>;
    startContainment(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport>;
    addContainmentAction(ctx: TenantContext, ncrId: Ulid, input: {
        description: string;
        dueAt: IsoDateTime;
    }): Promise<{
        ncr: NonConformanceReport;
        action: import("../domain/ncr.js").ContainmentAction;
    }>;
    completeContainmentAction(ctx: TenantContext, ncrId: Ulid, actionId: Ulid, note?: string): Promise<{
        ncr: NonConformanceReport;
        action: import("../domain/ncr.js").ContainmentAction;
    }>;
    moveToDisposition(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport>;
    recordDisposition(ctx: TenantContext, ncrId: Ulid, input: {
        type: DispositionType;
        justification: string;
    }): Promise<NonConformanceReport>;
    approveDisposition(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport>;
    escalateToCapa(ctx: TenantContext, ncrId: Ulid, cmd?: EscalateToCapaCommand): Promise<{
        ncr: NonConformanceReport;
        capa: CapaCase;
    }>;
    close(ctx: TenantContext, ncrId: Ulid, note?: string): Promise<NonConformanceReport>;
    cancel(ctx: TenantContext, ncrId: Ulid, reason: string): Promise<NonConformanceReport>;
    getNcr(ctx: TenantContext, ncrId: Ulid): Promise<NonConformanceReport>;
    listNcrs(ctx: TenantContext, filter?: {
        status?: NcrStatus;
        severity?: NcrSeverity;
        supplierId?: string;
        inspectionLotId?: Ulid;
    }): Promise<NonConformanceReport[]>;
}
//# sourceMappingURL=ncr-service.d.ts.map