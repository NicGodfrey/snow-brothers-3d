import {
  ConflictError,
  NotFoundError,
  money,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  validateAttributeValues,
  validateAxisValues,
  type AttributeDefinitionRecord,
  type AttributeSetRecord,
  type AttributeValue,
} from "../domain/attribute.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import type { LifecycleState } from "../domain/lifecycle.js";
import {
  Product,
  type CreateProductInput,
  type ProductType,
  type ProductVariant,
} from "../domain/product.js";
import type {
  AttributeDefinitionRepository,
  AttributeSetRepository,
  BomRepository,
  CategoryRepository,
  Clock,
  OutboxPort,
  ProductFilter,
  ProductRepository,
} from "./ports.js";
import type { UomService } from "./uom-service.js";

export interface CreateProductCommand {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly type: ProductType;
  readonly baseUom: string;
  readonly sku?: string;
  readonly categoryId?: Ulid;
  readonly attributeSetId?: Ulid;
}

export interface AddVariantCommand {
  readonly productId: Ulid;
  readonly sku?: string;
  readonly axisValues: Readonly<Record<string, string>>;
  readonly attributes?: Readonly<Record<string, AttributeValue>>;
  readonly standardCost?: { readonly amountMinor: number; readonly currency: string };
}

export interface SkuResolution {
  readonly product: Product;
  readonly variant?: ProductVariant;
}

export class ProductService {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryRepository,
    private readonly attributeSets: AttributeSetRepository,
    private readonly attributeDefinitions: AttributeDefinitionRepository,
    private readonly boms: BomRepository,
    private readonly uomService: UomService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, command: CreateProductCommand): Promise<Product> {
    const registry = await this.uomService.registryFor(ctx.tenantId);
    const baseUom = registry.resolve(command.baseUom).code;
    if (command.categoryId && !(await this.categories.byId(ctx.tenantId, command.categoryId))) {
      throw new NotFoundError("Category", command.categoryId);
    }
    if (command.attributeSetId && !(await this.attributeSets.byId(ctx.tenantId, command.attributeSetId))) {
      throw new NotFoundError("AttributeSet", command.attributeSetId);
    }
    const normalizedCode = command.code.trim().toUpperCase();
    if (await this.products.byCode(ctx.tenantId, normalizedCode)) {
      throw new ConflictError(`Product code "${normalizedCode}" already exists`);
    }
    const input: CreateProductInput = { ...command, baseUom };
    const product = Product.create(ctx.tenantId, input);
    if (product.sku) {
      const clash = await this.products.bySku(ctx.tenantId, product.sku);
      if (clash && clash.id !== product.id) {
        throw new ConflictError(`SKU "${product.sku}" is already taken by ${clash.code}`);
      }
    }
    await this.commit(product);
    return product;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Product> {
    const product = await this.products.byId(ctx.tenantId, id);
    if (!product) throw new NotFoundError("Product", id);
    return product;
  }

  async list(
    ctx: TenantContext,
    filter: ProductFilter,
    page?: Partial<PageRequest>,
  ): Promise<Page<Product>> {
    return this.products.list(ctx.tenantId, filter, normalizePage(page));
  }

  async updateDetails(
    ctx: TenantContext,
    id: Ulid,
    patch: { readonly name?: string; readonly description?: string },
  ): Promise<Product> {
    const product = await this.get(ctx, id);
    product.updateDetails(patch);
    await this.commit(product);
    return product;
  }

  async setAttributes(
    ctx: TenantContext,
    id: Ulid,
    values: Record<string, AttributeValue>,
  ): Promise<Product> {
    const product = await this.get(ctx, id);
    const { set, defs } = await this.attributeSchemaOf(ctx, product);
    const issues = validateAttributeValues(set, defs, values, { enforceRequired: true });
    if (issues.length > 0) throw new ValidationError("Invalid attribute values", issues);
    product.setAttributes(values);
    await this.commit(product);
    return product;
  }

  async assignCategory(ctx: TenantContext, id: Ulid, categoryId: Ulid): Promise<Product> {
    const product = await this.get(ctx, id);
    if (!(await this.categories.byId(ctx.tenantId, categoryId))) {
      throw new NotFoundError("Category", categoryId);
    }
    product.assignCategory(categoryId);
    await this.commit(product);
    return product;
  }

  /**
   * Lifecycle transition with cross-aggregate guards:
   * - a manufactured product cannot go active without a BOM revision that is
   *   effective right now (you cannot launch what you cannot build);
   * - end-of-life additionally discontinues all active variants.
   */
  async transitionLifecycle(
    ctx: TenantContext,
    id: Ulid,
    to: LifecycleState,
    reason?: string,
  ): Promise<Product> {
    const product = await this.get(ctx, id);
    const now = this.clock.now();
    if (to === "active" && product.type === "manufactured") {
      const bom = await this.boms.byProductId(ctx.tenantId, product.id);
      if (!bom?.effectiveRevision(now)) {
        throw new InvalidStateError(
          `Manufactured product ${product.code} needs a released, currently effective BOM before it can go active`,
        );
      }
    }
    product.transitionLifecycle(to, ctx.userId, { reason, at: now });
    if (to === "end_of_life") {
      for (const variant of product.activeVariants()) {
        product.discontinueVariant(variant.id);
      }
    }
    await this.commit(product);
    return product;
  }

  async addVariant(ctx: TenantContext, command: AddVariantCommand): Promise<ProductVariant> {
    const product = await this.get(ctx, command.productId);
    const { set, defs } = await this.attributeSchemaOf(ctx, product);
    const axisIssues = validateAxisValues(set, defs, command.axisValues);
    if (axisIssues.length > 0) throw new ValidationError("Invalid variant axis values", axisIssues);
    if (command.attributes) {
      const attrIssues = validateAttributeValues(set, defs, { ...command.attributes }, { enforceRequired: false });
      if (attrIssues.length > 0) throw new ValidationError("Invalid variant attributes", attrIssues);
    }
    const variant = product.addVariant({
      sku: command.sku,
      axisValues: command.axisValues,
      attributes: command.attributes,
      standardCost: command.standardCost
        ? money(command.standardCost.amountMinor, command.standardCost.currency)
        : undefined,
      at: this.clock.now(),
    });
    // Tenant-wide SKU uniqueness (the aggregate can only see itself).
    const clash = await this.products.bySku(ctx.tenantId, variant.sku);
    if (clash && clash.id !== product.id) {
      throw new ConflictError(`SKU "${variant.sku}" is already taken by product ${clash.code}`);
    }
    await this.commit(product);
    return variant;
  }

  async discontinueVariant(ctx: TenantContext, productId: Ulid, variantId: Ulid): Promise<Product> {
    const product = await this.get(ctx, productId);
    product.discontinueVariant(variantId);
    await this.commit(product);
    return product;
  }

  async setStandardCost(
    ctx: TenantContext,
    productId: Ulid,
    input: { readonly amountMinor: number; readonly currency: string; readonly variantId?: Ulid },
  ): Promise<Product> {
    const product = await this.get(ctx, productId);
    product.setStandardCost(money(input.amountMinor, input.currency), "manual", input.variantId);
    await this.commit(product);
    return product;
  }

  async resolveSku(ctx: TenantContext, sku: string): Promise<SkuResolution> {
    const product = await this.products.bySku(ctx.tenantId, sku);
    if (!product) throw new NotFoundError("SKU", sku);
    const normalized = sku.trim().toUpperCase();
    return {
      product,
      variant: product.sku === normalized ? undefined : product.variantBySku(normalized),
    };
  }

  private async attributeSchemaOf(
    ctx: TenantContext,
    product: Product,
  ): Promise<{ set: AttributeSetRecord; defs: Map<string, AttributeDefinitionRecord> }> {
    if (!product.attributeSetId) {
      throw new InvalidStateError(`Product ${product.code} has no attribute set assigned`);
    }
    const set = await this.attributeSets.byId(ctx.tenantId, product.attributeSetId);
    if (!set) throw new NotFoundError("AttributeSet", product.attributeSetId);
    const defs = await this.attributeDefinitions.byCodes(
      ctx.tenantId,
      set.members.map((m) => m.code),
    );
    return { set, defs };
  }

  private async commit(product: Product): Promise<void> {
    await this.products.save(product);
    await this.outbox.publish(product.pullEvents());
  }
}
