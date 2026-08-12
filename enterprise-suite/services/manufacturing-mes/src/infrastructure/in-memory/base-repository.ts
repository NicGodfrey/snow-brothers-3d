import type { Entity } from "@enterprise-suite/shared-kernel";
import type { TenantId } from "@enterprise-suite/shared-kernel";

/**
 * Tenant-scoped in-memory store. Keys are `${tenantId}::${id}` so a lookup
 * with the wrong tenant can never return another tenant's aggregate — the
 * same guarantee a Postgres adapter gets from `WHERE tenant_id = $1`.
 */
export class InMemoryStore<T extends Entity<object>> {
  private readonly rows = new Map<string, T>();

  private key(tenantId: TenantId, id: string): string {
    return `${tenantId}::${id}`;
  }

  set(entity: T): void {
    this.rows.set(this.key(entity.tenantId, entity.id), entity);
  }

  get(tenantId: TenantId, id: string): T | null {
    return this.rows.get(this.key(tenantId, id)) ?? null;
  }

  allForTenant(tenantId: TenantId): T[] {
    const prefix = `${tenantId}::`;
    const result: T[] = [];
    for (const [key, value] of this.rows) {
      if (key.startsWith(prefix)) result.push(value);
    }
    return result;
  }

  clear(): void {
    this.rows.clear();
  }
}
