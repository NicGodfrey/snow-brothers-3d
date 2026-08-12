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
import type {
  AuditRepository,
  AuditTemplateRepository,
  CapaRepository,
  InspectionLotRepository,
  InspectionPlanRepository,
  NcrRepository,
  SupplierQualityEventRepository,
} from "../../domain/repositories.js";
import type { SupplierEventStatus, SupplierQualityEvent } from "../../domain/supplier-quality.js";

abstract class InMemoryStore<T extends { id: Ulid; tenantId: TenantId }> {
  protected readonly byId = new Map<Ulid, T>();

  async save(entity: T): Promise<void> {
    this.byId.set(entity.id, entity);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<T | null> {
    const entity = this.byId.get(id);
    return entity && entity.tenantId === tenantId ? entity : null;
  }

  protected inTenant(tenantId: TenantId): T[] {
    return [...this.byId.values()].filter((e) => e.tenantId === tenantId);
  }
}

export class InMemoryInspectionPlanRepository
  extends InMemoryStore<InspectionPlan>
  implements InspectionPlanRepository
{
  async findActiveByPlanCode(tenantId: TenantId, planCode: string): Promise<InspectionPlan | null> {
    return (
      this.inTenant(tenantId).find((p) => p.planCode === planCode && p.status === "active") ?? null
    );
  }

  async findActiveForMaterial(tenantId: TenantId, materialCode: string): Promise<InspectionPlan[]> {
    return this.inTenant(tenantId).filter(
      (p) => p.status === "active" && p.materialCode === materialCode,
    );
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: PlanStatus; materialCode?: string },
  ): Promise<InspectionPlan[]> {
    return this.inTenant(tenantId).filter(
      (p) =>
        (!filter?.status || p.status === filter.status) &&
        (!filter?.materialCode || p.materialCode === filter.materialCode),
    );
  }
}

export class InMemoryInspectionLotRepository
  extends InMemoryStore<InspectionLot>
  implements InspectionLotRepository
{
  async findByLotNumber(tenantId: TenantId, lotNumber: string): Promise<InspectionLot | null> {
    return this.inTenant(tenantId).find((l) => l.lotNumber === lotNumber) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: LotStatus; origin?: LotOrigin; supplierId?: string; materialCode?: string },
  ): Promise<InspectionLot[]> {
    return this.inTenant(tenantId).filter(
      (l) =>
        (!filter?.status || l.status === filter.status) &&
        (!filter?.origin || l.origin === filter.origin) &&
        (!filter?.supplierId || l.linkage.supplierId === filter.supplierId) &&
        (!filter?.materialCode || l.materialCode === filter.materialCode),
    );
  }
}

export class InMemoryNcrRepository
  extends InMemoryStore<NonConformanceReport>
  implements NcrRepository
{
  async findByNumber(tenantId: TenantId, ncrNumber: string): Promise<NonConformanceReport | null> {
    return this.inTenant(tenantId).find((n) => n.ncrNumber === ncrNumber) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: NcrStatus; severity?: NcrSeverity; supplierId?: string; inspectionLotId?: Ulid },
  ): Promise<NonConformanceReport[]> {
    return this.inTenant(tenantId).filter(
      (n) =>
        (!filter?.status || n.status === filter.status) &&
        (!filter?.severity || n.severity === filter.severity) &&
        (!filter?.supplierId || n.linkage.supplierId === filter.supplierId) &&
        (!filter?.inspectionLotId || n.linkage.inspectionLotId === filter.inspectionLotId),
    );
  }
}

export class InMemoryCapaRepository extends InMemoryStore<CapaCase> implements CapaRepository {
  async findByNumber(tenantId: TenantId, capaNumber: string): Promise<CapaCase | null> {
    return this.inTenant(tenantId).find((c) => c.capaNumber === capaNumber) ?? null;
  }

  async list(tenantId: TenantId, filter?: { status?: CapaStatus; ncrId?: Ulid }): Promise<CapaCase[]> {
    return this.inTenant(tenantId).filter(
      (c) =>
        (!filter?.status || c.status === filter.status) &&
        (!filter?.ncrId || c.source.ncrIds.includes(filter.ncrId)),
    );
  }
}

export class InMemorySupplierQualityEventRepository
  extends InMemoryStore<SupplierQualityEvent>
  implements SupplierQualityEventRepository
{
  async listBySupplier(tenantId: TenantId, supplierId: string): Promise<SupplierQualityEvent[]> {
    return this.inTenant(tenantId).filter((e) => e.supplierId === supplierId);
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: SupplierEventStatus; supplierId?: string },
  ): Promise<SupplierQualityEvent[]> {
    return this.inTenant(tenantId).filter(
      (e) =>
        (!filter?.status || e.status === filter.status) &&
        (!filter?.supplierId || e.supplierId === filter.supplierId),
    );
  }
}

export class InMemoryAuditTemplateRepository
  extends InMemoryStore<AuditChecklistTemplate>
  implements AuditTemplateRepository
{
  async findByCode(tenantId: TenantId, code: string): Promise<AuditChecklistTemplate | null> {
    return this.inTenant(tenantId).find((t) => t.code === code) ?? null;
  }

  async list(tenantId: TenantId): Promise<AuditChecklistTemplate[]> {
    return this.inTenant(tenantId);
  }
}

export class InMemoryAuditRepository extends InMemoryStore<Audit> implements AuditRepository {
  async list(
    tenantId: TenantId,
    filter?: { status?: AuditStatus; auditType?: AuditType; supplierId?: string },
  ): Promise<Audit[]> {
    return this.inTenant(tenantId).filter(
      (a) =>
        (!filter?.status || a.status === filter.status) &&
        (!filter?.auditType || a.auditType === filter.auditType) &&
        (!filter?.supplierId || a.auditee.supplierId === filter.supplierId),
    );
  }
}
