import {
  ConflictError,
  NotFoundError,
  isoDate,
  sku,
  type Money,
  type TenantContext,
  type Ulid,
} from "../kernel/index.js";
import { PriceList } from "../domain/pricing/price-list.js";
import type { OutboxPort, PriceListRepository } from "./ports.js";
import { parse } from "./validation/validator.js";
import { createPriceListSchema, upsertPriceItemSchema } from "./validation/pricing-schemas.js";

export class PricingService {
  constructor(
    private readonly priceLists: PriceListRepository,
    private readonly outbox: OutboxPort,
  ) {}

  create(ctx: TenantContext, input: unknown): PriceList {
    const cmd = parse(createPriceListSchema, input);
    if (cmd.isDefault) {
      const existing = this.priceLists.findDefault(ctx.tenantId, cmd.currency);
      if (existing) {
        throw new ConflictError(
          `Price list ${existing.name} is already the default for ${cmd.currency}; archive it first`,
        );
      }
    }
    const priceList = PriceList.create(ctx.tenantId, {
      name: cmd.name,
      currency: cmd.currency,
      validFrom: cmd.validFrom === undefined ? undefined : isoDate(cmd.validFrom),
      validUntil: cmd.validUntil === undefined ? undefined : isoDate(cmd.validUntil),
      isDefault: cmd.isDefault,
    });
    this.priceLists.save(priceList);
    return priceList;
  }

  get(ctx: TenantContext, id: Ulid): PriceList {
    return this.priceLists.getById(ctx.tenantId, id);
  }

  list(ctx: TenantContext): PriceList[] {
    return this.priceLists
      .listByTenant(ctx.tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  upsertItem(ctx: TenantContext, priceListId: Ulid, input: unknown): PriceList {
    const cmd = parse(upsertPriceItemSchema, input);
    const priceList = this.priceLists.getById(ctx.tenantId, priceListId);
    priceList.upsertItem({
      sku: sku(cmd.sku),
      description: cmd.description,
      taxCategory: cmd.taxCategory,
      tiers: cmd.tiers,
    });
    this.priceLists.save(priceList);
    return priceList;
  }

  removeItem(ctx: TenantContext, priceListId: Ulid, skuValue: string): PriceList {
    const priceList = this.priceLists.getById(ctx.tenantId, priceListId);
    priceList.removeItem(sku(skuValue));
    this.priceLists.save(priceList);
    return priceList;
  }

  archive(ctx: TenantContext, priceListId: Ulid): PriceList {
    const priceList = this.priceLists.getById(ctx.tenantId, priceListId);
    priceList.archive();
    this.priceLists.save(priceList);
    return priceList;
  }

  /**
   * Resolve a unit price. Uses the given price list, or falls back to the
   * tenant's default list for the currency.
   */
  resolvePrice(
    ctx: TenantContext,
    args: { priceListId?: Ulid; currency: string; sku: string; qty: number },
  ): { unitPrice: Money; priceList: PriceList } {
    const priceList = args.priceListId
      ? this.priceLists.getById(ctx.tenantId, args.priceListId)
      : this.priceLists.findDefault(ctx.tenantId, args.currency);
    if (!priceList) {
      throw new NotFoundError("PriceList", `default for ${args.currency.toUpperCase()}`);
    }
    if ((priceList.currencyCode as unknown as string) !== args.currency.toUpperCase()) {
      throw new ConflictError(
        `Price list ${priceList.name} is in ${priceList.currencyCode}, expected ${args.currency.toUpperCase()}`,
      );
    }
    return { unitPrice: priceList.priceFor(sku(args.sku), args.qty), priceList };
  }
}
