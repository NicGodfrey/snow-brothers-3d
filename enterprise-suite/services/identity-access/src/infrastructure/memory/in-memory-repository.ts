import { NotFoundError, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";

export interface TenantScoped {
  readonly id: Ulid;
  readonly tenantId: TenantId;
}

/**
 * Base for the in-memory repositories: a per-tenant map keyed by aggregate id, plus a
 * global id index for the few lookups that arrive without a tenant (a presented session
 * token, an API key prefix). Aggregates are stored by reference, matching the behaviour
 * of an identity-mapped ORM session; the SQL implementations will re-hydrate instead.
 */
export abstract class InMemoryRepository<T extends TenantScoped> {
  protected readonly byTenant = new Map<string, Map<string, T>>();
  protected readonly globalIndex = new Map<string, T>();

  constructor(protected readonly resourceName: string) {}

  save(entity: T): void {
    const bucket = this.bucket(entity.tenantId);
    bucket.set(entity.id, entity);
    this.globalIndex.set(entity.id, entity);
    this.onSaved(entity);
  }

  byId(tenantId: TenantId, id: Ulid): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  byIdAnyTenant(id: Ulid): T | undefined {
    return this.globalIndex.get(id);
  }

  require(tenantId: TenantId, id: Ulid): T {
    const found = this.byId(tenantId, id);
    if (!found) throw new NotFoundError(this.resourceName, id);
    return found;
  }

  list(tenantId: TenantId): readonly T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }

  all(): readonly T[] {
    return [...this.globalIndex.values()];
  }

  delete(tenantId: TenantId, id: Ulid): void {
    const removed = this.byTenant.get(tenantId)?.get(id);
    this.byTenant.get(tenantId)?.delete(id);
    this.globalIndex.delete(id);
    if (removed) this.onDeleted(removed);
  }

  count(tenantId: TenantId): number {
    return this.byTenant.get(tenantId)?.size ?? 0;
  }

  clear(): void {
    this.byTenant.clear();
    this.globalIndex.clear();
  }

  protected bucket(tenantId: TenantId): Map<string, T> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map<string, T>();
      this.byTenant.set(tenantId, bucket);
    }
    return bucket;
  }

  /** Hook for subclasses that maintain secondary indexes. */
  protected onSaved(_entity: T): void {}

  protected onDeleted(_entity: T): void {}
}

/** Stable sort helper used by the repositories to keep listings deterministic. */
export function sortBy<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}
