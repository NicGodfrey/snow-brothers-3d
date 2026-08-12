import {
  paginate,
  type EventEnvelope,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantId,
  type Ulid,
  nowIso,
} from "@enterprise-suite/shared-kernel";
import type { AttributeDefinitionRecord, AttributeSetRecord } from "../../domain/attribute.js";
import type { Bom } from "../../domain/bom.js";
import type { CategoryRecord } from "../../domain/category.js";
import type { Eco } from "../../domain/eco.js";
import type { Product } from "../../domain/product.js";
import type { UnitOfMeasure } from "../../domain/uom.js";
import type {
  AttributeDefinitionRepository,
  AttributeSetRepository,
  BomRepository,
  CategoryRepository,
  Clock,
  EcoFilter,
  EcoRepository,
  OutboxPort,
  ProductFilter,
  ProductRepository,
  UomRepository,
} from "../../application/ports.js";

/**
 * In-memory adapters. Aggregates are stored by reference (single-process
 * semantics); tenant isolation is structural — every map is keyed by tenant
 * first, so a missing tenant can never leak another tenant's data.
 */

class TenantKeyedStore<T> {
  private readonly byTenant = new Map<TenantId, Map<Ulid, T>>();

  private bucket(tenantId: TenantId): Map<Ulid, T> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    return bucket;
  }

  get(tenantId: TenantId, id: Ulid): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  set(tenantId: TenantId, id: Ulid, value: T): void {
    this.bucket(tenantId).set(id, value);
  }

  values(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }
}

export class InMemoryProductRepository implements ProductRepository {
  private readonly store = new TenantKeyedStore<Product>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Product | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<Product | undefined> {
    const normalized = code.trim().toUpperCase();
    return this.store.values(tenantId).find((p) => p.code === normalized);
  }

  async bySku(tenantId: TenantId, sku: string): Promise<Product | undefined> {
    const normalized = sku.trim().toUpperCase();
    return this.store
      .values(tenantId)
      .find((p) => p.sku === normalized || p.variants.some((v) => v.sku === normalized));
  }

  async list(tenantId: TenantId, filter: ProductFilter, page: PageRequest): Promise<Page<Product>> {
    const search = filter.search?.trim().toLowerCase();
    const matches = this.store
      .values(tenantId)
      .filter((p) => (filter.lifecycle ? p.lifecycle === filter.lifecycle : true))
      .filter((p) => (filter.type ? p.type === filter.type : true))
      .filter((p) => (filter.categoryId ? p.categoryId === filter.categoryId : true))
      .filter((p) =>
        search ? p.code.toLowerCase().includes(search) || p.name.toLowerCase().includes(search) : true,
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Product[]> {
    return this.store.values(tenantId);
  }

  async save(product: Product): Promise<void> {
    this.store.set(product.tenantId, product.id, product);
  }
}

export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly store = new TenantKeyedStore<CategoryRecord>();

  async byId(tenantId: TenantId, id: Ulid): Promise<CategoryRecord | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<CategoryRecord | undefined> {
    const normalized = code.trim().toLowerCase();
    return this.store.values(tenantId).find((c) => c.code === normalized);
  }

  async all(tenantId: TenantId): Promise<readonly CategoryRecord[]> {
    return this.store.values(tenantId);
  }

  async save(record: CategoryRecord): Promise<void> {
    this.store.set(record.tenantId, record.id, record);
  }
}

export class InMemoryAttributeDefinitionRepository implements AttributeDefinitionRepository {
  private readonly store = new TenantKeyedStore<AttributeDefinitionRecord>();

  async byId(tenantId: TenantId, id: Ulid): Promise<AttributeDefinitionRecord | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<AttributeDefinitionRecord | undefined> {
    return this.store.values(tenantId).find((d) => d.code === code.trim().toLowerCase());
  }

  async byCodes(
    tenantId: TenantId,
    codes: readonly string[],
  ): Promise<Map<string, AttributeDefinitionRecord>> {
    const wanted = new Set(codes.map((c) => c.trim().toLowerCase()));
    const found = new Map<string, AttributeDefinitionRecord>();
    for (const def of this.store.values(tenantId)) {
      if (wanted.has(def.code)) found.set(def.code, def);
    }
    return found;
  }

  async all(tenantId: TenantId): Promise<readonly AttributeDefinitionRecord[]> {
    return this.store.values(tenantId);
  }

  async save(record: AttributeDefinitionRecord): Promise<void> {
    this.store.set(record.tenantId, record.id, record);
  }
}

export class InMemoryAttributeSetRepository implements AttributeSetRepository {
  private readonly store = new TenantKeyedStore<AttributeSetRecord>();

  async byId(tenantId: TenantId, id: Ulid): Promise<AttributeSetRecord | undefined> {
    return this.store.get(tenantId, id);
  }

  async byName(tenantId: TenantId, name: string): Promise<AttributeSetRecord | undefined> {
    const normalized = name.trim().toLowerCase();
    return this.store.values(tenantId).find((s) => s.name.toLowerCase() === normalized);
  }

  async all(tenantId: TenantId): Promise<readonly AttributeSetRecord[]> {
    return this.store.values(tenantId);
  }

  async save(record: AttributeSetRecord): Promise<void> {
    this.store.set(record.tenantId, record.id, record);
  }
}

export class InMemoryUomRepository implements UomRepository {
  private readonly byTenant = new Map<TenantId, Map<string, UnitOfMeasure>>();

  async byCode(tenantId: TenantId, code: string): Promise<UnitOfMeasure | undefined> {
    return this.byTenant.get(tenantId)?.get(code.trim().toUpperCase());
  }

  async all(tenantId: TenantId): Promise<readonly UnitOfMeasure[]> {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }

  async save(tenantId: TenantId, unit: UnitOfMeasure): Promise<void> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    bucket.set(unit.code, unit);
  }
}

export class InMemoryBomRepository implements BomRepository {
  private readonly store = new TenantKeyedStore<Bom>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Bom | undefined> {
    return this.store.get(tenantId, id);
  }

  async byProductId(tenantId: TenantId, productId: Ulid): Promise<Bom | undefined> {
    return this.store.values(tenantId).find((b) => b.productId === productId);
  }

  async referencingComponent(tenantId: TenantId, componentProductId: Ulid): Promise<readonly Bom[]> {
    return this.store
      .values(tenantId)
      .filter((b) =>
        b.revisions.some((r) => r.lines.some((l) => l.componentProductId === componentProductId)),
      );
  }

  async all(tenantId: TenantId): Promise<readonly Bom[]> {
    return this.store.values(tenantId);
  }

  async save(bom: Bom): Promise<void> {
    this.store.set(bom.tenantId, bom.id, bom);
  }
}

export class InMemoryEcoRepository implements EcoRepository {
  private readonly store = new TenantKeyedStore<Eco>();
  private readonly sequences = new Map<TenantId, number>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Eco | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<Eco | undefined> {
    return this.store.values(tenantId).find((e) => e.number === number);
  }

  async list(tenantId: TenantId, filter: EcoFilter, page: PageRequest): Promise<Page<Eco>> {
    const matches = this.store
      .values(tenantId)
      .filter((e) => (filter.status ? e.status === filter.status : true))
      .filter((e) => (filter.productId ? e.affectedProductIds().includes(filter.productId) : true))
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async nextSequence(tenantId: TenantId): Promise<number> {
    const next = (this.sequences.get(tenantId) ?? 0) + 1;
    this.sequences.set(tenantId, next);
    return next;
  }

  async save(eco: Eco): Promise<void> {
    this.store.set(eco.tenantId, eco.id, eco);
  }
}

export type OutboxSubscriber = (event: EventEnvelope) => void;

/**
 * In-memory stand-in for a transactional outbox: events are appended to a
 * log and fanned out to subscribers synchronously. `entries` keeps the full
 * history so tests and the demo /events endpoint can inspect what happened.
 */
export class InMemoryOutbox implements OutboxPort {
  private readonly log: EventEnvelope[] = [];
  private readonly subscribers: OutboxSubscriber[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      this.log.push(event);
      for (const subscriber of this.subscribers) subscriber(event);
    }
  }

  subscribe(subscriber: OutboxSubscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  entries(tenantId?: TenantId): readonly EventEnvelope[] {
    return tenantId ? this.log.filter((e) => e.tenantId === tenantId) : [...this.log];
  }
}

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }
}

/** Deterministic clock for tests: starts at a fixed instant, ticks manually. */
export class FixedClock implements Clock {
  private current: number;

  constructor(startIso = "2026-01-01T00:00:00.000Z") {
    this.current = Date.parse(startIso);
  }

  now(): IsoDateTime {
    return new Date(this.current).toISOString() as IsoDateTime;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}
