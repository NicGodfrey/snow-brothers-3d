/**
 * In-memory repository implementations (identity-map style). Tenant scoping
 * is enforced on every read; a Postgres implementation would translate the
 * same interfaces to SQL against the tables in /migrations.
 */
import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { Audit, AuditChecklistTemplate, AuditStatus, AuditType } from "../../domain/audit.js";
import type { CapaCase, CapaStatus } from "../../domain/capa.js";
import type { InspectionLot, LotStatus } from "../../domain/inspection-lot.js";
import type { InspectionPlan, LotOrigin, PlanStatus } from "../../domain/inspection-plan.js";
import type { NcrSeverity, NcrStatus, NonConformanceReport } from "../../domain/ncr.js";
import type { AuditRepository, AuditTemplateRepository, CapaRepository, InspectionLotRepository, InspectionPlanRepository, NcrRepository, SupplierQualityEventRepository } from "../../domain/repositories.js";
import type { SupplierEventStatus, SupplierQualityEvent } from "../../domain/supplier-quality.js";
declare abstract class InMemoryStore<T extends {
    id: Ulid;
    tenantId: TenantId;
}> {
    protected readonly byId: Map<Ulid, T>;
    save(entity: T): Promise<void>;
    findById(tenantId: TenantId, id: Ulid): Promise<T | null>;
    protected inTenant(tenantId: TenantId): T[];
}
export declare class InMemoryInspectionPlanRepository extends InMemoryStore<InspectionPlan> implements InspectionPlanRepository {
    findActiveByPlanCode(tenantId: TenantId, planCode: string): Promise<InspectionPlan | null>;
    findActiveForMaterial(tenantId: TenantId, materialCode: string): Promise<InspectionPlan[]>;
    list(tenantId: TenantId, filter?: {
        status?: PlanStatus;
        materialCode?: string;
    }): Promise<InspectionPlan[]>;
}
export declare class InMemoryInspectionLotRepository extends InMemoryStore<InspectionLot> implements InspectionLotRepository {
    findByLotNumber(tenantId: TenantId, lotNumber: string): Promise<InspectionLot | null>;
    list(tenantId: TenantId, filter?: {
        status?: LotStatus;
        origin?: LotOrigin;
        supplierId?: string;
        materialCode?: string;
    }): Promise<InspectionLot[]>;
}
export declare class InMemoryNcrRepository extends InMemoryStore<NonConformanceReport> implements NcrRepository {
    findByNumber(tenantId: TenantId, ncrNumber: string): Promise<NonConformanceReport | null>;
    list(tenantId: TenantId, filter?: {
        status?: NcrStatus;
        severity?: NcrSeverity;
        supplierId?: string;
        inspectionLotId?: Ulid;
    }): Promise<NonConformanceReport[]>;
}
export declare class InMemoryCapaRepository extends InMemoryStore<CapaCase> implements CapaRepository {
    findByNumber(tenantId: TenantId, capaNumber: string): Promise<CapaCase | null>;
    list(tenantId: TenantId, filter?: {
        status?: CapaStatus;
        ncrId?: Ulid;
    }): Promise<CapaCase[]>;
}
export declare class InMemorySupplierQualityEventRepository extends InMemoryStore<SupplierQualityEvent> implements SupplierQualityEventRepository {
    listBySupplier(tenantId: TenantId, supplierId: string): Promise<SupplierQualityEvent[]>;
    list(tenantId: TenantId, filter?: {
        status?: SupplierEventStatus;
        supplierId?: string;
    }): Promise<SupplierQualityEvent[]>;
}
export declare class InMemoryAuditTemplateRepository extends InMemoryStore<AuditChecklistTemplate> implements AuditTemplateRepository {
    findByCode(tenantId: TenantId, code: string): Promise<AuditChecklistTemplate | null>;
    list(tenantId: TenantId): Promise<AuditChecklistTemplate[]>;
}
export declare class InMemoryAuditRepository extends InMemoryStore<Audit> implements AuditRepository {
    list(tenantId: TenantId, filter?: {
        status?: AuditStatus;
        auditType?: AuditType;
        supplierId?: string;
    }): Promise<Audit[]>;
}
export {};
//# sourceMappingURL=repositories.d.ts.map