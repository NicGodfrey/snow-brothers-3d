import type {
  EventEnvelope,
  IsoDateTime,
  Page,
  PageRequest,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { AttributeDefinitionRecord, AttributeSetRecord } from "../domain/attribute.js";
import type { Bom } from "../domain/bom.js";
import type { CategoryRecord } from "../domain/category.js";
import type { Eco, EcoStatus } from "../domain/eco.js";
import type { LifecycleState } from "../domain/lifecycle.js";
import type { Product, ProductType } from "../domain/product.js";
import type { UnitOfMeasure } from "../domain/uom.js";

/**
 * Ports the application layer depends on. In-memory implementations live in
 * infrastructure/memory; a Postgres adapter can implement the same contracts
 * later without touching services.
 */

export interface ProductFilter {
  readonly lifecycle?: LifecycleState;
  readonly type?: ProductType;
  readonly categoryId?: Ulid;
  /** Case-insensitive substring match on code or name. */
  readonly search?: string;
}

export interface ProductRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Product | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<Product | undefined>;
  /** Resolves a base-product SKU or a variant SKU. */
  bySku(tenantId: TenantId, sku: string): Promise<Product | undefined>;
  list(tenantId: TenantId, filter: ProductFilter, page: PageRequest): Promise<Page<Product>>;
  /** Full tenant catalog, used to build explosion/costing read models. */
  all(tenantId: TenantId): Promise<readonly Product[]>;
  save(product: Product): Promise<void>;
}

export interface CategoryRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<CategoryRecord | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<CategoryRecord | undefined>;
  all(tenantId: TenantId): Promise<readonly CategoryRecord[]>;
  save(record: CategoryRecord): Promise<void>;
}

export interface AttributeDefinitionRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<AttributeDefinitionRecord | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<AttributeDefinitionRecord | undefined>;
  byCodes(tenantId: TenantId, codes: readonly string[]): Promise<Map<string, AttributeDefinitionRecord>>;
  all(tenantId: TenantId): Promise<readonly AttributeDefinitionRecord[]>;
  save(record: AttributeDefinitionRecord): Promise<void>;
}

export interface AttributeSetRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<AttributeSetRecord | undefined>;
  byName(tenantId: TenantId, name: string): Promise<AttributeSetRecord | undefined>;
  all(tenantId: TenantId): Promise<readonly AttributeSetRecord[]>;
  save(record: AttributeSetRecord): Promise<void>;
}

export interface UomRepository {
  byCode(tenantId: TenantId, code: string): Promise<UnitOfMeasure | undefined>;
  all(tenantId: TenantId): Promise<readonly UnitOfMeasure[]>;
  save(tenantId: TenantId, unit: UnitOfMeasure): Promise<void>;
}

export interface BomRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Bom | undefined>;
  byProductId(tenantId: TenantId, productId: Ulid): Promise<Bom | undefined>;
  /** Boms with any revision referencing the given component. */
  referencingComponent(tenantId: TenantId, componentProductId: Ulid): Promise<readonly Bom[]>;
  all(tenantId: TenantId): Promise<readonly Bom[]>;
  save(bom: Bom): Promise<void>;
}

export interface EcoFilter {
  readonly status?: EcoStatus;
  readonly productId?: Ulid;
}

export interface EcoRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Eco | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<Eco | undefined>;
  list(tenantId: TenantId, filter: EcoFilter, page: PageRequest): Promise<Page<Eco>>;
  /** Monotonic per-tenant sequence used to mint ECO-000123 numbers. */
  nextSequence(tenantId: TenantId): Promise<number>;
  save(eco: Eco): Promise<void>;
}

/** Transactional-outbox stand-in: publish after (in-memory) commit. */
export interface OutboxPort {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}

export interface Clock {
  now(): IsoDateTime;
}
