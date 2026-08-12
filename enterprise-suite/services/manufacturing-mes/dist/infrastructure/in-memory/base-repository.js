/**
 * Tenant-scoped in-memory store. Keys are `${tenantId}::${id}` so a lookup
 * with the wrong tenant can never return another tenant's aggregate — the
 * same guarantee a Postgres adapter gets from `WHERE tenant_id = $1`.
 */
export class InMemoryStore {
    rows = new Map();
    key(tenantId, id) {
        return `${tenantId}::${id}`;
    }
    set(entity) {
        this.rows.set(this.key(entity.tenantId, entity.id), entity);
    }
    get(tenantId, id) {
        return this.rows.get(this.key(tenantId, id)) ?? null;
    }
    allForTenant(tenantId) {
        const prefix = `${tenantId}::`;
        const result = [];
        for (const [key, value] of this.rows) {
            if (key.startsWith(prefix))
                result.push(value);
        }
        return result;
    }
    clear() {
        this.rows.clear();
    }
}
//# sourceMappingURL=base-repository.js.map