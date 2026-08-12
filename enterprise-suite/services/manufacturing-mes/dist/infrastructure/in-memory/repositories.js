import { InMemoryStore } from "./base-repository.js";
export class InMemoryWorkCenterRepository {
    store = new InMemoryStore();
    async save(workCenter) {
        this.store.set(workCenter);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findByCode(tenantId, code) {
        return this.store.allForTenant(tenantId).find((wc) => wc.code === code) ?? null;
    }
    async list(tenantId) {
        return this.store.allForTenant(tenantId);
    }
}
export class InMemoryShiftTemplateRepository {
    store = new InMemoryStore();
    async save(template) {
        this.store.set(template);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findByCode(tenantId, code) {
        return this.store.allForTenant(tenantId).find((t) => t.code === code) ?? null;
    }
    async list(tenantId) {
        return this.store.allForTenant(tenantId);
    }
}
export class InMemoryCapacityCalendarRepository {
    store = new InMemoryStore();
    async save(calendar) {
        this.store.set(calendar);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findByCode(tenantId, code) {
        return this.store.allForTenant(tenantId).find((c) => c.code === code) ?? null;
    }
    async list(tenantId) {
        return this.store.allForTenant(tenantId);
    }
}
export class InMemoryRoutingRepository {
    store = new InMemoryStore();
    async save(routing) {
        this.store.set(routing);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findBySkuRevision(tenantId, sku, revision) {
        return (this.store
            .allForTenant(tenantId)
            .find((r) => r.sku === sku && r.revision === revision) ?? null);
    }
    async findReleasedForSku(tenantId, sku) {
        const released = this.store
            .allForTenant(tenantId)
            .filter((r) => r.sku === sku && r.status === "RELEASED")
            .sort((a, b) => (b.toJSON().releasedAt ?? "").localeCompare(a.toJSON().releasedAt ?? ""));
        return released[0] ?? null;
    }
    async list(tenantId, filter) {
        return this.store.allForTenant(tenantId).filter((r) => {
            if (filter?.sku && r.sku !== filter.sku.toUpperCase())
                return false;
            if (filter?.status && r.status !== filter.status)
                return false;
            return true;
        });
    }
}
export class InMemoryWorkOrderRepository {
    store = new InMemoryStore();
    sequences = new Map();
    async save(workOrder) {
        this.store.set(workOrder);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findByOrderNumber(tenantId, orderNumber) {
        return (this.store.allForTenant(tenantId).find((wo) => wo.orderNumber === orderNumber) ?? null);
    }
    async list(tenantId, filter) {
        return this.store.allForTenant(tenantId).filter((wo) => {
            if (filter?.status && wo.status !== filter.status)
                return false;
            if (filter?.sku && wo.sku !== filter.sku.toUpperCase())
                return false;
            if (filter?.dueBefore && wo.dueDate >= filter.dueBefore)
                return false;
            return true;
        });
    }
    async nextOrderNumber(tenantId) {
        const next = (this.sequences.get(tenantId) ?? 0) + 1;
        this.sequences.set(tenantId, next);
        return `WO-${String(next).padStart(6, "0")}`;
    }
}
export class InMemoryMaterialIssueRepository {
    store = new InMemoryStore();
    async save(doc) {
        this.store.set(doc);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async listByWorkOrder(tenantId, workOrderId) {
        return this.store
            .allForTenant(tenantId)
            .filter((doc) => doc.workOrderRef === workOrderId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
}
export class InMemoryProductionReceiptRepository {
    store = new InMemoryStore();
    async save(doc) {
        this.store.set(doc);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async listByWorkOrder(tenantId, workOrderId) {
        return this.store
            .allForTenant(tenantId)
            .filter((doc) => doc.workOrderRef === workOrderId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
}
export class InMemoryScrapRecordRepository {
    store = new InMemoryStore();
    async save(record) {
        this.store.set(record);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async listByWorkOrder(tenantId, workOrderId) {
        return this.store
            .allForTenant(tenantId)
            .filter((record) => record.workOrderRef === workOrderId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    async list(tenantId, filter) {
        return this.store
            .allForTenant(tenantId)
            .filter((record) => !filter?.reasonCode || record.reasonCode === filter.reasonCode)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
}
//# sourceMappingURL=repositories.js.map