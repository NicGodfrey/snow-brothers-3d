import { NotFoundError, type TenantId, type Ulid } from "../../kernel/index.js";
import type { Repository } from "../../application/ports.js";

interface Identified {
  readonly id: Ulid;
  readonly tenantId: TenantId;
}

/**
 * Tenant-scoped in-memory store. Lookups always require the tenant so one
 * tenant can never read another tenant's aggregates, mirroring the row-level
 * scoping the Postgres implementation will enforce.
 */
export class InMemoryRepository<T extends Identified> implements Repository<T> {
  protected readonly byTenant = new Map<string, Map<string, T>>();

  constructor(private readonly resourceName: string) {}

  save(entity: T): void {
    const tenantKey = entity.tenantId as unknown as string;
    let bucket = this.byTenant.get(tenantKey);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantKey, bucket);
    }
    bucket.set(entity.id as unknown as string, entity);
  }

  findById(tenantId: TenantId, id: Ulid): T | undefined {
    return this.byTenant.get(tenantId as unknown as string)?.get(id as unknown as string);
  }

  getById(tenantId: TenantId, id: Ulid): T {
    const found = this.findById(tenantId, id);
    if (!found) throw new NotFoundError(this.resourceName, id as unknown as string);
    return found;
  }

  listByTenant(tenantId: TenantId): T[] {
    const bucket = this.byTenant.get(tenantId as unknown as string);
    return bucket ? [...bucket.values()] : [];
  }
}
