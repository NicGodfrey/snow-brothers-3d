import {
  ConflictError,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { rollUpCost, type CostRollupResult } from "../domain/costing.js";
import type { BomService } from "./bom-service.js";
import type { Clock, OutboxPort, ProductRepository } from "./ports.js";

export interface RollupQuery {
  readonly productId: Ulid;
  readonly variantId?: Ulid;
  readonly at?: IsoDateTime;
  readonly currency?: string;
}

const DEFAULT_CURRENCY = "USD";

export class CostingService {
  constructor(
    private readonly products: ProductRepository,
    private readonly bomService: BomService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  /** Computes the cost breakdown without persisting anything. */
  async rollUp(ctx: TenantContext, query: RollupQuery): Promise<CostRollupResult> {
    const sources = await this.bomService.buildSources(ctx);
    return rollUpCost(sources, {
      productId: query.productId,
      variantId: query.variantId,
      at: query.at ?? this.clock.now(),
      currency: query.currency ?? DEFAULT_CURRENCY,
    });
  }

  /**
   * Computes the rollup and stores the result as the product's standard cost
   * (source "rollup"). Refuses to persist an incomplete rollup — a lower
   * bound must never silently become the standard cost.
   */
  async applyRollup(ctx: TenantContext, query: RollupQuery): Promise<CostRollupResult> {
    const result = await this.rollUp(ctx, query);
    if (result.incomplete) {
      throw new ConflictError(
        `Cannot apply rollup: missing standard costs for [${result.missing.map((m) => m.productCode).join(", ")}]`,
      );
    }
    const product = await this.products.byId(ctx.tenantId, query.productId);
    if (!product) throw new ConflictError(`Product ${query.productId} disappeared during rollup`);
    product.setStandardCost(result.root.unitCost, "rollup", query.variantId);
    await this.products.save(product);
    await this.outbox.publish(product.pullEvents());
    return result;
  }
}
