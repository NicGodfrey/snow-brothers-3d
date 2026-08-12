import type { Entity } from "@enterprise-suite/shared-kernel";
import type { TenantId } from "@enterprise-suite/shared-kernel";
/**
 * Tenant-scoped in-memory store. Keys are `${tenantId}::${id}` so a lookup
 * with the wrong tenant can never return another tenant's aggregate — the
 * same guarantee a Postgres adapter gets from `WHERE tenant_id = $1`.
 */
export declare class InMemoryStore<T extends Entity<object>> {
    private readonly rows;
    private key;
    set(entity: T): void;
    get(tenantId: TenantId, id: string): T | null;
    allForTenant(tenantId: TenantId): T[];
    clear(): void;
}
//# sourceMappingURL=base-repository.d.ts.map