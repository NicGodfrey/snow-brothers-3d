/**
 * Repository ports (hexagonal). Implementations live in infrastructure.
 * All lookups are tenant-scoped; returning null means "not found in this
 * tenant" — cross-tenant reads are structurally impossible through these
 * interfaces.
 */
import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { Audit, AuditChecklistTemplate, AuditStatus, AuditType } from "./audit.js";
import type { CapaCase, CapaStatus } from "./capa.js";
import type { InspectionLot, LotStatus } from "./inspection-lot.js";
import type { InspectionPlan, LotOrigin, PlanStatus } from "./inspection-plan.js";
import type { NcrSeverity, NcrStatus, NonConformanceReport } from "./ncr.js";
import type { SupplierEventStatus, SupplierQualityEvent } from "./supplier-quality.js";
export interface InspectionPlanRepository {
    save(plan: InspectionPlan): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<InspectionPlan | null>;
    findActiveByPlanCode(tenantId: TenantId, planCode: string): Promise<InspectionPlan | null>;
    findActiveForMaterial(tenantId: TenantId, materialCode: string): Promise<InspectionPlan[]>;
    list(tenantId: TenantId, filter?: {
        status?: PlanStatus;
        materialCode?: string;
    }): Promise<InspectionPlan[]>;
}
export interface InspectionLotRepository {
    save(lot: InspectionLot): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<InspectionLot | null>;
    findByLotNumber(tenantId: TenantId, lotNumber: string): Promise<InspectionLot | null>;
    list(tenantId: TenantId, filter?: {
        status?: LotStatus;
        origin?: LotOrigin;
        supplierId?: string;
        materialCode?: string;
    }): Promise<InspectionLot[]>;
}
export interface NcrRepository {
    save(ncr: NonConformanceReport): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<NonConformanceReport | null>;
    findByNumber(tenantId: TenantId, ncrNumber: string): Promise<NonConformanceReport | null>;
    list(tenantId: TenantId, filter?: {
        status?: NcrStatus;
        severity?: NcrSeverity;
        supplierId?: string;
        inspectionLotId?: Ulid;
    }): Promise<NonConformanceReport[]>;
}
export interface CapaRepository {
    save(capa: CapaCase): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<CapaCase | null>;
    findByNumber(tenantId: TenantId, capaNumber: string): Promise<CapaCase | null>;
    list(tenantId: TenantId, filter?: {
        status?: CapaStatus;
        ncrId?: Ulid;
    }): Promise<CapaCase[]>;
}
export interface SupplierQualityEventRepository {
    save(event: SupplierQualityEvent): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<SupplierQualityEvent | null>;
    listBySupplier(tenantId: TenantId, supplierId: string): Promise<SupplierQualityEvent[]>;
    list(tenantId: TenantId, filter?: {
        status?: SupplierEventStatus;
        supplierId?: string;
    }): Promise<SupplierQualityEvent[]>;
}
export interface AuditTemplateRepository {
    save(template: AuditChecklistTemplate): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<AuditChecklistTemplate | null>;
    findByCode(tenantId: TenantId, code: string): Promise<AuditChecklistTemplate | null>;
    list(tenantId: TenantId): Promise<AuditChecklistTemplate[]>;
}
export interface AuditRepository {
    save(audit: Audit): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<Audit | null>;
    list(tenantId: TenantId, filter?: {
        status?: AuditStatus;
        auditType?: AuditType;
        supplierId?: string;
    }): Promise<Audit[]>;
}
//# sourceMappingURL=repositories.d.ts.map