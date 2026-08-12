class InMemoryStore {
    byId = new Map();
    async save(entity) {
        this.byId.set(entity.id, entity);
    }
    async findById(tenantId, id) {
        const entity = this.byId.get(id);
        return entity && entity.tenantId === tenantId ? entity : null;
    }
    inTenant(tenantId) {
        return [...this.byId.values()].filter((e) => e.tenantId === tenantId);
    }
}
export class InMemoryInspectionPlanRepository extends InMemoryStore {
    async findActiveByPlanCode(tenantId, planCode) {
        return (this.inTenant(tenantId).find((p) => p.planCode === planCode && p.status === "active") ?? null);
    }
    async findActiveForMaterial(tenantId, materialCode) {
        return this.inTenant(tenantId).filter((p) => p.status === "active" && p.materialCode === materialCode);
    }
    async list(tenantId, filter) {
        return this.inTenant(tenantId).filter((p) => (!filter?.status || p.status === filter.status) &&
            (!filter?.materialCode || p.materialCode === filter.materialCode));
    }
}
export class InMemoryInspectionLotRepository extends InMemoryStore {
    async findByLotNumber(tenantId, lotNumber) {
        return this.inTenant(tenantId).find((l) => l.lotNumber === lotNumber) ?? null;
    }
    async list(tenantId, filter) {
        return this.inTenant(tenantId).filter((l) => (!filter?.status || l.status === filter.status) &&
            (!filter?.origin || l.origin === filter.origin) &&
            (!filter?.supplierId || l.linkage.supplierId === filter.supplierId) &&
            (!filter?.materialCode || l.materialCode === filter.materialCode));
    }
}
export class InMemoryNcrRepository extends InMemoryStore {
    async findByNumber(tenantId, ncrNumber) {
        return this.inTenant(tenantId).find((n) => n.ncrNumber === ncrNumber) ?? null;
    }
    async list(tenantId, filter) {
        return this.inTenant(tenantId).filter((n) => (!filter?.status || n.status === filter.status) &&
            (!filter?.severity || n.severity === filter.severity) &&
            (!filter?.supplierId || n.linkage.supplierId === filter.supplierId) &&
            (!filter?.inspectionLotId || n.linkage.inspectionLotId === filter.inspectionLotId));
    }
}
export class InMemoryCapaRepository extends InMemoryStore {
    async findByNumber(tenantId, capaNumber) {
        return this.inTenant(tenantId).find((c) => c.capaNumber === capaNumber) ?? null;
    }
    async list(tenantId, filter) {
        return this.inTenant(tenantId).filter((c) => (!filter?.status || c.status === filter.status) &&
            (!filter?.ncrId || c.source.ncrIds.includes(filter.ncrId)));
    }
}
export class InMemorySupplierQualityEventRepository extends InMemoryStore {
    async listBySupplier(tenantId, supplierId) {
        return this.inTenant(tenantId).filter((e) => e.supplierId === supplierId);
    }
    async list(tenantId, filter) {
        return this.inTenant(tenantId).filter((e) => (!filter?.status || e.status === filter.status) &&
            (!filter?.supplierId || e.supplierId === filter.supplierId));
    }
}
export class InMemoryAuditTemplateRepository extends InMemoryStore {
    async findByCode(tenantId, code) {
        return this.inTenant(tenantId).find((t) => t.code === code) ?? null;
    }
    async list(tenantId) {
        return this.inTenant(tenantId);
    }
}
export class InMemoryAuditRepository extends InMemoryStore {
    async list(tenantId, filter) {
        return this.inTenant(tenantId).filter((a) => (!filter?.status || a.status === filter.status) &&
            (!filter?.auditType || a.auditType === filter.auditType) &&
            (!filter?.supplierId || a.auditee.supplierId === filter.supplierId));
    }
}
//# sourceMappingURL=repositories.js.map