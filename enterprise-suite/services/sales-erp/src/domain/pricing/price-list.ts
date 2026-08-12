import {
  ConflictError,
  NotFoundError,
  type CurrencyCode,
  type IsoDate,
  type Money,
  type Sku,
  type TenantId,
  currency,
  money,
} from "../../kernel/index.js";
import { AggregateRoot } from "../../kernel/aggregate.js";

export type PriceListStatus = "active" | "archived";

/** Quantity-tiered price: the tier with the highest minQty <= qty wins. */
export interface PriceTier {
  readonly minQty: number;
  readonly unitPriceMinor: number;
}

export interface PriceListItem {
  readonly sku: Sku;
  readonly description: string;
  readonly taxCategory: TaxCategory;
  readonly tiers: readonly PriceTier[];
}

export type TaxCategory = "standard" | "reduced" | "zero" | "exempt";

export interface PriceListProps {
  name: string;
  currency: CurrencyCode;
  status: PriceListStatus;
  validFrom?: IsoDate;
  validUntil?: IsoDate;
  isDefault: boolean;
  items: Map<string, PriceListItem>;
}

export class PriceList extends AggregateRoot<PriceListProps> {
  private constructor(tenantId: TenantId, props: PriceListProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      name: string;
      currency: string;
      validFrom?: IsoDate;
      validUntil?: IsoDate;
      isDefault?: boolean;
    },
  ): PriceList {
    return new PriceList(tenantId, {
      name: input.name.trim(),
      currency: currency(input.currency),
      status: "active",
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      isDefault: input.isDefault ?? false,
      items: new Map(),
    });
  }

  get name(): string {
    return this.props.name;
  }

  get currencyCode(): CurrencyCode {
    return this.props.currency;
  }

  get status(): PriceListStatus {
    return this.props.status;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  get itemCount(): number {
    return this.props.items.size;
  }

  items(): readonly PriceListItem[] {
    return [...this.props.items.values()];
  }

  upsertItem(input: {
    sku: Sku;
    description: string;
    taxCategory?: TaxCategory;
    tiers: readonly PriceTier[];
  }): void {
    this.assertActive();
    if (input.tiers.length === 0) {
      throw new ConflictError(`Price list item ${input.sku} needs at least one tier`);
    }
    const sorted = [...input.tiers].sort((a, b) => a.minQty - b.minQty);
    if (sorted[0].minQty > 1) {
      throw new ConflictError(`Price list item ${input.sku} must have a tier starting at qty 1`);
    }
    const seen = new Set<number>();
    for (const tier of sorted) {
      if (!Number.isInteger(tier.minQty) || tier.minQty < 1) {
        throw new ConflictError(`Tier minQty must be a positive integer (got ${tier.minQty})`);
      }
      if (!Number.isInteger(tier.unitPriceMinor) || tier.unitPriceMinor < 0) {
        throw new ConflictError(`Tier unitPriceMinor must be a non-negative integer`);
      }
      if (seen.has(tier.minQty)) {
        throw new ConflictError(`Duplicate tier minQty ${tier.minQty} for ${input.sku}`);
      }
      seen.add(tier.minQty);
    }
    this.props.items.set(input.sku as unknown as string, {
      sku: input.sku,
      description: input.description,
      taxCategory: input.taxCategory ?? "standard",
      tiers: sorted,
    });
    this.touch();
  }

  removeItem(skuValue: Sku): void {
    this.assertActive();
    if (!this.props.items.delete(skuValue as unknown as string)) {
      throw new NotFoundError("PriceListItem", skuValue as unknown as string);
    }
    this.touch();
  }

  hasSku(skuValue: Sku): boolean {
    return this.props.items.has(skuValue as unknown as string);
  }

  itemFor(skuValue: Sku): PriceListItem {
    const item = this.props.items.get(skuValue as unknown as string);
    if (!item) throw new NotFoundError("PriceListItem", skuValue as unknown as string);
    return item;
  }

  /** Resolve the unit price for a sku at a given quantity using tier rules. */
  priceFor(skuValue: Sku, qty: number): Money {
    const item = this.itemFor(skuValue);
    let winning = item.tiers[0];
    for (const tier of item.tiers) {
      if (tier.minQty <= qty) winning = tier;
      else break;
    }
    return money(winning.unitPriceMinor, this.props.currency);
  }

  isValidOn(date: IsoDate): boolean {
    if (this.props.status !== "active") return false;
    const d = date as unknown as string;
    if (this.props.validFrom && d < (this.props.validFrom as unknown as string)) return false;
    if (this.props.validUntil && d > (this.props.validUntil as unknown as string)) return false;
    return true;
  }

  archive(): void {
    if (this.props.status === "archived") {
      throw new ConflictError(`Price list ${this.props.name} is already archived`);
    }
    this.props.status = "archived";
    this.touch();
  }

  snapshot(): Record<string, unknown> {
    return {
      id: this.id,
      tenantId: this.tenantId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      version: this.version,
      name: this.props.name,
      currency: this.props.currency,
      status: this.props.status,
      validFrom: this.props.validFrom ?? null,
      validUntil: this.props.validUntil ?? null,
      isDefault: this.props.isDefault,
      items: this.items(),
    };
  }

  private assertActive(): void {
    if (this.props.status !== "active") {
      throw new ConflictError(`Price list ${this.props.name} is archived`);
    }
  }
}
