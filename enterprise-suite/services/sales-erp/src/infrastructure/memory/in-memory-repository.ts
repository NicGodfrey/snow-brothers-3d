import { JsonTenantStore, reviveEntity } from "@enterprise-suite/shared-kernel";
import { NotFoundError, type TenantId, type Ulid } from "../../kernel/index.js";
import type { Repository } from "../../application/ports.js";

interface Identified {
  readonly id: Ulid;
  readonly tenantId: TenantId;
}

/**
 * Tenant-scoped in-memory store with optional JSON file backing. Lookups
 * always require the tenant so one tenant can never read another tenant's
 * aggregates. Nested line entities lose class methods after JSON round-trip,
 * so persistence is opt-in via PERSISTENCE_SALES=1.
 */
export class InMemoryRepository<T extends Identified> implements Repository<T> {
  private readonly store: JsonTenantStore<T>;

  constructor(
    private readonly resourceName: string,
    prototype?: object,
  ) {
    this.store = new JsonTenantStore<T>({
      service: "sales-erp",
      name: resourceName,
      revive: (raw) =>
        prototype ? reviveEntity<T>(prototype, raw) : (raw as T),
      enabled: process.env.PERSISTENCE_SALES === "1",
    });
  }

  get isEmpty(): boolean {
    return this.store.isEmpty();
  }

  flush(): void {
    this.store.flush();
  }

  save(entity: T): void {
    this.store.set(entity.tenantId as unknown as string, entity.id as unknown as string, entity);
  }

  findById(tenantId: TenantId, id: Ulid): T | undefined {
    return this.store.get(tenantId as unknown as string, id as unknown as string);
  }

  getById(tenantId: TenantId, id: Ulid): T {
    const found = this.findById(tenantId, id);
    if (!found) throw new NotFoundError(this.resourceName, id as unknown as string);
    return found;
  }

  listByTenant(tenantId: TenantId): T[] {
    return this.store.values(tenantId as unknown as string);
  }
}
