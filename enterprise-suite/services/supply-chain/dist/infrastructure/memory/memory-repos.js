/**
 * Tenant-partitioned in-memory store. Insertion order is preserved per
 * tenant, which the repos rely on for "latest" queries; the SQL migrations
 * define the equivalent (created_at, id) ordering for Postgres adapters.
 */
class TenantStore {
    byTenant = new Map();
    save(entity) {
        let bucket = this.byTenant.get(entity.tenantId);
        if (!bucket) {
            bucket = new Map();
            this.byTenant.set(entity.tenantId, bucket);
        }
        // Re-set to keep first-insert order stable (Map preserves original slot).
        bucket.set(entity.id, entity);
    }
    find(tenantId, id) {
        return this.byTenant.get(tenantId)?.get(id) ?? null;
    }
    delete(tenantId, id) {
        return this.byTenant.get(tenantId)?.delete(id) ?? false;
    }
    all(tenantId) {
        return [...(this.byTenant.get(tenantId)?.values() ?? [])];
    }
}
export class InMemoryPlanningItemRepository {
    store = new TenantStore();
    async save(item) {
        this.store.save(item);
    }
    async findById(tenantId, id) {
        return this.store.find(tenantId, id);
    }
    async findBySku(tenantId, sku) {
        return this.store.all(tenantId).find((item) => item.sku === sku) ?? null;
    }
    async listActive(tenantId) {
        return this.store.all(tenantId).filter((item) => item.active);
    }
    async listAll(tenantId) {
        return this.store.all(tenantId);
    }
}
export class InMemoryDemandForecastRepository {
    store = new TenantStore();
    async save(forecast) {
        this.store.save(forecast);
    }
    async findById(tenantId, id) {
        return this.store.find(tenantId, id);
    }
    async findPublished(tenantId, sku, location) {
        return (this.store
            .all(tenantId)
            .find((f) => f.status === "PUBLISHED" && f.sku === sku && f.location === location) ?? null);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId).filter((f) => (!filter?.sku || f.sku === filter.sku) &&
            (!filter?.location || f.location === filter.location) &&
            (!filter?.status || f.status === filter.status));
    }
}
export class InMemorySafetyStockPolicyRepository {
    store = new TenantStore();
    async save(policy) {
        this.store.save(policy);
    }
    async findById(tenantId, id) {
        return this.store.find(tenantId, id);
    }
    async list(tenantId) {
        return this.store.all(tenantId);
    }
}
export class InMemoryInventoryRepository {
    /** Keyed by tenant|sku|location; the natural key of the projection. */
    records = new Map();
    key(tenantId, sku, location) {
        return `${tenantId}|${sku}|${location}`;
    }
    async upsert(record) {
        this.records.set(this.key(record.tenantId, record.sku, record.location), record);
    }
    async find(tenantId, sku, location) {
        return this.records.get(this.key(tenantId, sku, location)) ?? null;
    }
    async list(tenantId, location) {
        return [...this.records.values()].filter((r) => r.tenantId === tenantId && (!location || r.location === location));
    }
}
export class InMemoryScheduledReceiptRepository {
    store = new TenantStore();
    async save(receipt) {
        this.store.save(receipt);
    }
    async delete(tenantId, id) {
        return this.store.delete(tenantId, id);
    }
    async listFor(tenantId, sku, location) {
        return this.store.all(tenantId).filter((r) => r.sku === sku && r.location === location);
    }
    async list(tenantId, location) {
        return this.store.all(tenantId).filter((r) => !location || r.location === location);
    }
}
export class InMemorySupplyPlanRepository {
    store = new TenantStore();
    async save(plan) {
        this.store.save(plan);
    }
    async findById(tenantId, id) {
        return this.store.find(tenantId, id);
    }
    async listByRun(tenantId, runId) {
        return this.store.all(tenantId).filter((p) => p.runId === runId);
    }
    async findLatestFor(tenantId, sku, location) {
        const matches = this.store.all(tenantId).filter((p) => p.sku === sku && p.location === location);
        return matches.at(-1) ?? null;
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId).filter((p) => (!filter?.sku || p.sku === filter.sku) && (!filter?.location || p.location === filter.location));
    }
}
export class InMemoryAllocationRepository {
    store = new TenantStore();
    async save(allocation) {
        this.store.save(allocation);
    }
    async findById(tenantId, id) {
        return this.store.find(tenantId, id);
    }
    async listActiveFor(tenantId, sku, location) {
        return this.store
            .all(tenantId)
            .filter((a) => a.status === "ACTIVE" && a.sku === sku && a.location === location);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId).filter((a) => (!filter?.sku || a.sku === filter.sku) &&
            (!filter?.location || a.location === filter.location) &&
            (!filter?.status || a.status === filter.status));
    }
}
export class InMemorySupplierCalendarRepository {
    store = new TenantStore();
    async save(calendar) {
        this.store.save(calendar);
    }
    async findById(tenantId, id) {
        return this.store.find(tenantId, id);
    }
    async findFor(tenantId, supplierId, sku) {
        const all = this.store.all(tenantId).filter((c) => c.supplierId === supplierId);
        return all.find((c) => c.sku === sku) ?? all.find((c) => c.sku === null) ?? null;
    }
    async list(tenantId, supplierId) {
        return this.store.all(tenantId).filter((c) => !supplierId || c.supplierId === supplierId);
    }
}
export class InMemoryPlanningRunRepository {
    store = new TenantStore();
    async save(run) {
        this.store.save(run);
    }
    async findById(tenantId, id) {
        return this.store.find(tenantId, id);
    }
    async list(tenantId) {
        return this.store.all(tenantId);
    }
}
//# sourceMappingURL=memory-repos.js.map