import {
  AggregateRoot,
  brand,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type Sku,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { axisKey, type AttributeValue } from "./attribute.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { PlmEventTypes } from "./events.js";
import {
  assertTransition,
  isEditable,
  type LifecycleState,
} from "./lifecycle.js";
import type { UomCode } from "./uom.js";

/**
 * Product aggregate.
 *
 * A Product is the engineering master record. Variants are child entities
 * inside the aggregate: each variant fixes a concrete combination of the
 * attribute set's variant axes and owns a sellable SKU. Products without
 * variants sell under their own base SKU.
 *
 * Type semantics:
 * - manufactured: built from a BOM; unit cost is rolled up.
 * - purchased:    bought outside; unit cost is the standard cost.
 * - phantom:      logical grouping that is never stocked; BOM explosion and
 *                 costing pass through to its components.
 * - service:      no BOM, no stock; costed by standard cost.
 */

export type ProductType = "manufactured" | "purchased" | "phantom" | "service";

export const PRODUCT_TYPES: readonly ProductType[] = [
  "manufactured",
  "purchased",
  "phantom",
  "service",
];

export const PRODUCT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9\-]{1,63}$/;
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9\-]{1,79}$/;

export function skuOf(value: string): Sku {
  const normalized = value.trim().toUpperCase();
  if (!SKU_PATTERN.test(normalized)) {
    throw ValidationError.single("sku", `invalid SKU "${value}"`);
  }
  return brand<string, "Sku">(normalized);
}

export type VariantStatus = "active" | "discontinued";

export interface ProductVariant {
  readonly id: Ulid;
  readonly sku: Sku;
  readonly axisValues: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
  readonly status: VariantStatus;
  readonly standardCost?: Money;
  readonly createdAt: IsoDateTime;
}

export interface ProductProps {
  code: string;
  name: string;
  description?: string;
  type: ProductType;
  lifecycle: LifecycleState;
  baseUom: UomCode;
  sku?: Sku;
  categoryId?: Ulid;
  attributeSetId?: Ulid;
  attributes: Record<string, AttributeValue>;
  variants: ProductVariant[];
  standardCost?: Money;
  eolAt?: IsoDateTime;
  eolReason?: string;
}

export interface CreateProductInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly type: ProductType;
  readonly baseUom: UomCode;
  readonly sku?: string;
  readonly categoryId?: Ulid;
  readonly attributeSetId?: Ulid;
}

export class Product extends AggregateRoot<ProductProps> {
  static create(tenantId: TenantId, input: CreateProductInput): Product {
    const code = input.code.trim().toUpperCase();
    if (!PRODUCT_CODE_PATTERN.test(code)) {
      throw ValidationError.single("code", `invalid product code "${input.code}"`);
    }
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "name is required");
    }
    if (!PRODUCT_TYPES.includes(input.type)) {
      throw ValidationError.single("type", `unknown product type "${input.type}"`);
    }
    const product = new Product(tenantId, {
      code,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      type: input.type,
      lifecycle: "design",
      baseUom: input.baseUom,
      sku: input.sku !== undefined ? skuOf(input.sku) : skuOf(code),
      categoryId: input.categoryId,
      attributeSetId: input.attributeSetId,
      attributes: {},
      variants: [],
    });
    product.raise(
      envelope({
        eventType: PlmEventTypes.ProductCreated,
        aggregateType: "Product",
        aggregateId: product.id,
        tenantId,
        payload: {
          productId: product.id,
          code,
          name: product.props.name,
          type: product.props.type,
          baseUom: product.props.baseUom,
          lifecycle: product.props.lifecycle,
        },
      }),
    );
    return product;
  }

  static fromSnapshot(snapshot: EntityProps & ProductProps): Product {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Product(
      tenantId,
      { ...props, attributes: { ...props.attributes }, variants: [...props.variants] },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get type(): ProductType {
    return this.props.type;
  }
  get lifecycle(): LifecycleState {
    return this.props.lifecycle;
  }
  get baseUom(): UomCode {
    return this.props.baseUom;
  }
  get sku(): Sku | undefined {
    return this.props.sku;
  }
  get categoryId(): Ulid | undefined {
    return this.props.categoryId;
  }
  get attributeSetId(): Ulid | undefined {
    return this.props.attributeSetId;
  }
  get attributes(): Readonly<Record<string, AttributeValue>> {
    return this.props.attributes;
  }
  get variants(): readonly ProductVariant[] {
    return this.props.variants;
  }
  get standardCost(): Money | undefined {
    return this.props.standardCost;
  }

  variantById(variantId: Ulid): ProductVariant | undefined {
    return this.props.variants.find((v) => v.id === variantId);
  }

  variantBySku(sku: string): ProductVariant | undefined {
    const normalized = sku.trim().toUpperCase();
    return this.props.variants.find((v) => v.sku === normalized);
  }

  activeVariants(): readonly ProductVariant[] {
    return this.props.variants.filter((v) => v.status === "active");
  }

  /** True if the product may carry a BOM at all. */
  canHaveBom(): boolean {
    return this.props.type === "manufactured" || this.props.type === "phantom";
  }

  // --- commands ------------------------------------------------------------

  updateDetails(input: { readonly name?: string; readonly description?: string }): void {
    if (this.props.lifecycle === "end_of_life") {
      throw new InvalidStateError(`Product ${this.props.code} is end-of-life and read-only`);
    }
    if (input.name !== undefined) {
      if (input.name.trim().length === 0) {
        throw ValidationError.single("name", "name cannot be blank");
      }
      this.props.name = input.name.trim();
    }
    if (input.description !== undefined) {
      this.props.description = input.description.trim() || undefined;
    }
    this.raise(
      envelope({
        eventType: PlmEventTypes.ProductDetailsUpdated,
        aggregateType: "Product",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { productId: this.id, name: this.props.name },
      }),
    );
  }

  /** Values must be validated against the attribute set by the caller. */
  setAttributes(values: Record<string, AttributeValue>): void {
    if (!this.props.attributeSetId) {
      throw new InvalidStateError(`Product ${this.props.code} has no attribute set assigned`);
    }
    if (this.props.lifecycle === "end_of_life") {
      throw new InvalidStateError(`Product ${this.props.code} is end-of-life and read-only`);
    }
    this.props.attributes = { ...values };
    this.raise(
      envelope({
        eventType: PlmEventTypes.ProductAttributesSet,
        aggregateType: "Product",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { productId: this.id, attributes: this.props.attributes },
      }),
    );
  }

  assignCategory(categoryId: Ulid): void {
    this.props.categoryId = categoryId;
    this.raise(
      envelope({
        eventType: PlmEventTypes.ProductCategoryAssigned,
        aggregateType: "Product",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { productId: this.id, categoryId },
      }),
    );
  }

  transitionLifecycle(
    to: LifecycleState,
    actor: UserId,
    opts: { readonly reason?: string; readonly at: IsoDateTime },
  ): void {
    const from = this.props.lifecycle;
    assertTransition(from, to);
    if (to === "end_of_life") {
      if (!opts.reason || opts.reason.trim().length === 0) {
        throw ValidationError.single("reason", "a reason is required to end-of-life a product");
      }
      this.props.eolAt = opts.at;
      this.props.eolReason = opts.reason.trim();
    }
    this.props.lifecycle = to;
    this.raise(
      envelope({
        eventType: PlmEventTypes.ProductLifecycleChanged,
        aggregateType: "Product",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          productId: this.id,
          code: this.props.code,
          from,
          to,
          reason: opts.reason,
          changedBy: actor,
        },
      }),
    );
  }

  /**
   * Adds a variant. Axis values must already be validated against the
   * attribute set; the aggregate enforces the structural invariants: unique
   * axis combination, unique SKU within the aggregate, and no new variants
   * once the product left its editable states (a released product's variant
   * space is frozen — extending it is an engineering change).
   */
  addVariant(input: {
    readonly sku?: string;
    readonly axisValues: Readonly<Record<string, string>>;
    readonly attributes?: Readonly<Record<string, AttributeValue>>;
    readonly standardCost?: Money;
    readonly at: IsoDateTime;
  }): ProductVariant {
    if (!this.props.attributeSetId) {
      throw new InvalidStateError(
        `Product ${this.props.code} needs an attribute set before variants can be added`,
      );
    }
    if (!isEditable(this.props.lifecycle)) {
      throw new InvalidStateError(
        `Variants can only be added in design/pilot; product ${this.props.code} is ${this.props.lifecycle}`,
      );
    }
    const key = axisKey(input.axisValues);
    if (this.props.variants.some((v) => axisKey(v.axisValues) === key)) {
      throw new InvalidStateError(`A variant with axis combination {${key}} already exists`);
    }
    const sku = input.sku !== undefined ? skuOf(input.sku) : this.generateVariantSku(input.axisValues);
    if (this.props.sku === sku || this.props.variants.some((v) => v.sku === sku)) {
      throw new InvalidStateError(`SKU ${sku} is already used within product ${this.props.code}`);
    }
    const variant: ProductVariant = {
      id: newId("variant"),
      sku,
      axisValues: { ...input.axisValues },
      attributes: { ...(input.attributes ?? {}) },
      status: "active",
      standardCost: input.standardCost,
      createdAt: input.at,
    };
    this.props.variants.push(variant);
    this.raise(
      envelope({
        eventType: PlmEventTypes.ProductVariantAdded,
        aggregateType: "Product",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          productId: this.id,
          variantId: variant.id,
          sku: variant.sku,
          axisValues: variant.axisValues,
        },
      }),
    );
    return variant;
  }

  discontinueVariant(variantId: Ulid): void {
    const index = this.props.variants.findIndex((v) => v.id === variantId);
    if (index === -1) {
      throw new InvalidStateError(`Variant ${variantId} not found on product ${this.props.code}`);
    }
    const variant = this.props.variants[index]!;
    if (variant.status === "discontinued") {
      throw new InvalidStateError(`Variant ${variant.sku} is already discontinued`);
    }
    this.props.variants[index] = { ...variant, status: "discontinued" };
    this.raise(
      envelope({
        eventType: PlmEventTypes.ProductVariantDiscontinued,
        aggregateType: "Product",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { productId: this.id, variantId, sku: variant.sku },
      }),
    );
  }

  setStandardCost(cost: Money, source: "manual" | "rollup", variantId?: Ulid): void {
    if (variantId !== undefined) {
      const index = this.props.variants.findIndex((v) => v.id === variantId);
      if (index === -1) {
        throw new InvalidStateError(`Variant ${variantId} not found on product ${this.props.code}`);
      }
      this.props.variants[index] = { ...this.props.variants[index]!, standardCost: cost };
    } else {
      this.props.standardCost = cost;
    }
    this.raise(
      envelope({
        eventType: PlmEventTypes.ProductCostUpdated,
        aggregateType: "Product",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { productId: this.id, variantId, cost, source },
      }),
    );
  }

  /** Deterministic SKU: product code + axis value codes in axis-name order. */
  private generateVariantSku(axisValues: Readonly<Record<string, string>>): Sku {
    const suffix = Object.entries(axisValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v.toUpperCase().replace(/[^A-Z0-9]+/g, ""))
      .join("-");
    return skuOf(`${this.props.code}-${suffix}`);
  }
}
