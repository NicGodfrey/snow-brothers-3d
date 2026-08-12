import {
  addMoney,
  money,
  mulMoney,
  type IsoDateTime,
  type Money,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { Bom } from "./bom.js";
import { BomCycleError, InvalidStateError } from "./errors.js";
import type { Product } from "./product.js";
import { roundTo, type UomCode, type UomRegistry } from "./uom.js";

/**
 * Standard cost rollup.
 *
 * Leaf costs come from standard costs on purchased/service products (variant
 * override first). Manufactured and phantom products are rolled up from the
 * BOM revision effective at the requested date:
 *
 *   unit cost = Σ over lines: componentUnitCost × qtyInComponentBaseUom × (1 + scrap)
 *
 * Money stays in integer minor units; each line's extended cost is rounded
 * once. Components without a cost are reported (source "missing", cost 0)
 * rather than failing the whole rollup, so a partially costed BOM still gives
 * a useful lower bound — callers check `incomplete` before persisting.
 */

export interface CostingSources {
  readonly productById: (id: Ulid) => Product | undefined;
  readonly bomByProductId: (productId: Ulid) => Bom | undefined;
  readonly registry: UomRegistry;
}

export type CostSource = "standard" | "rollup" | "missing";

export interface CostComponentLine {
  readonly lineId: Ulid;
  readonly quantity: number;
  readonly uom: UomCode;
  readonly scrapFactor: number;
  readonly extendedCost: Money;
  readonly component: CostNode;
}

export interface CostNode {
  readonly productId: Ulid;
  readonly productCode: string;
  readonly productName: string;
  readonly variantId?: Ulid;
  readonly source: CostSource;
  readonly unitCost: Money;
  readonly revisionCode?: string;
  readonly components: readonly CostComponentLine[];
}

export interface CostRollupResult {
  readonly root: CostNode;
  readonly currency: string;
  readonly at: IsoDateTime;
  readonly incomplete: boolean;
  readonly missing: readonly { productId: Ulid; productCode: string; variantId?: Ulid }[];
}

export interface CostRollupRequest {
  readonly productId: Ulid;
  readonly variantId?: Ulid;
  readonly at: IsoDateTime;
  readonly currency: string;
}

export function rollUpCost(sources: CostingSources, request: CostRollupRequest): CostRollupResult {
  const currency = request.currency.toUpperCase();
  const missing: { productId: Ulid; productCode: string; variantId?: Ulid }[] = [];
  const memo = new Map<string, CostNode>();

  const standardCostOf = (product: Product, variantId?: Ulid): Money | undefined => {
    if (variantId) {
      const variant = product.variantById(variantId);
      if (!variant) {
        throw new InvalidStateError(`Variant ${variantId} not found on product ${product.code}`);
      }
      if (variant.standardCost) return variant.standardCost;
    }
    return product.standardCost;
  };

  const assertCurrency = (cost: Money, product: Product): Money => {
    if (cost.currency !== currency) {
      throw new InvalidStateError(
        `Standard cost of ${product.code} is in ${cost.currency}, rollup requested in ${currency} (no FX conversion in PLM)`,
      );
    }
    return cost;
  };

  const compute = (productId: Ulid, variantId: Ulid | undefined, path: readonly string[]): CostNode => {
    const key = `${productId}:${variantId ?? ""}`;
    const cached = memo.get(key);
    if (cached) return cached;
    if (path.includes(key)) {
      throw new BomCycleError([...path, key]);
    }
    const product = sources.productById(productId);
    if (!product) throw new InvalidStateError(`Product ${productId} not found`);

    let node: CostNode;
    const standard = standardCostOf(product, variantId);
    if (!product.canHaveBom()) {
      // Purchased/service: standard cost or missing.
      node = standard
        ? leaf(product, variantId, assertCurrency(standard, product), "standard")
        : markMissing(product, variantId);
    } else {
      const bom = sources.bomByProductId(productId);
      const revision = bom?.effectiveRevision(request.at);
      if (!revision) {
        // A make-item without an effective BOM can still carry a manually
        // maintained standard cost (e.g. before first release).
        node = standard
          ? leaf(product, variantId, assertCurrency(standard, product), "standard")
          : markMissing(product, variantId);
      } else {
        const components: CostComponentLine[] = [];
        let total = money(0, currency);
        for (const line of [...revision.lines].sort((a, b) => a.position - b.position)) {
          const componentProduct = sources.productById(line.componentProductId);
          if (!componentProduct) {
            throw new InvalidStateError(`BOM line references missing product ${line.componentProductId}`);
          }
          const child = compute(line.componentProductId, line.componentVariantId, [...path, key]);
          const qtyInBase = sources.registry.convert(line.quantity, line.uom, componentProduct.baseUom);
          const effectiveQty = roundTo(qtyInBase * (1 + line.scrapFactor), 6);
          const extended = mulMoney(child.unitCost, effectiveQty);
          total = addMoney(total, extended);
          components.push({
            lineId: line.id,
            quantity: qtyInBase,
            uom: componentProduct.baseUom,
            scrapFactor: line.scrapFactor,
            extendedCost: extended,
            component: child,
          });
        }
        node = {
          productId: product.id,
          productCode: product.code,
          productName: product.name,
          variantId,
          source: "rollup",
          unitCost: total,
          revisionCode: revision.code,
          components,
        };
      }
    }
    memo.set(key, node);
    return node;
  };

  const leaf = (product: Product, variantId: Ulid | undefined, cost: Money, source: CostSource): CostNode => ({
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    variantId,
    source,
    unitCost: cost,
    components: [],
  });

  const markMissing = (product: Product, variantId: Ulid | undefined): CostNode => {
    missing.push({ productId: product.id, productCode: product.code, variantId });
    return leaf(product, variantId, money(0, currency), "missing");
  };

  const root = compute(request.productId, request.variantId, []);
  return {
    root,
    currency,
    at: request.at,
    incomplete: missing.length > 0,
    missing,
  };
}
