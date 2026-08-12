import type { IsoDateTime, Ulid } from "@enterprise-suite/shared-kernel";
import type { Bom } from "./bom.js";
import { BomCycleError, InvalidStateError } from "./errors.js";
import type { Product } from "./product.js";
import { roundTo, type UomCode, type UomRegistry } from "./uom.js";

/**
 * Multi-level BOM explosion.
 *
 * Walks the effective revision tree at a given date, applying per-line scrap
 * and unit conversion, with cycle detection along the current path. Phantom
 * components are flattened by default: their children are hoisted into the
 * parent with multiplied quantities, which is how MRP wants to see them.
 */

export interface ExplosionSources {
  readonly productById: (id: Ulid) => Product | undefined;
  readonly bomByProductId: (productId: Ulid) => Bom | undefined;
  readonly registry: UomRegistry;
}

export interface ExplosionNode {
  readonly productId: Ulid;
  readonly productCode: string;
  readonly productName: string;
  readonly productType: string;
  readonly variantId?: Ulid;
  /** Quantity per one unit of the immediate parent (before scrap). */
  readonly quantityPer: number;
  /** Total quantity needed for the requested root quantity, scrap included. */
  readonly extendedQuantity: number;
  /** Unit the extended quantity is expressed in (component's base UoM). */
  readonly uom: UomCode;
  readonly scrapFactor: number;
  readonly level: number;
  readonly revisionCode?: string;
  readonly children: readonly ExplosionNode[];
}

export interface ExplosionOptions {
  readonly quantity?: number;
  readonly at: IsoDateTime;
  readonly maxDepth?: number;
  readonly flattenPhantoms?: boolean;
}

export interface ExplosionResult {
  readonly root: ExplosionNode;
  readonly at: IsoDateTime;
  readonly totalNodeCount: number;
}

const DEFAULT_MAX_DEPTH = 32;

export function explodeBom(
  sources: ExplosionSources,
  rootProductId: Ulid,
  options: ExplosionOptions,
): ExplosionResult {
  const rootProduct = sources.productById(rootProductId);
  if (!rootProduct) throw new InvalidStateError(`Product ${rootProductId} not found`);
  const quantity = options.quantity ?? 1;
  if (!(quantity > 0)) throw new InvalidStateError("Explosion quantity must be positive");
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const flatten = options.flattenPhantoms ?? true;
  let nodeCount = 0;

  const walk = (
    product: Product,
    extendedQuantity: number,
    level: number,
    path: readonly string[],
  ): ExplosionNode[] => {
    if (level > maxDepth) {
      throw new InvalidStateError(`BOM exceeds maximum depth of ${maxDepth}`);
    }
    const bom = sources.bomByProductId(product.id);
    const revision = bom?.effectiveRevision(options.at);
    if (!revision) return [];
    const children: ExplosionNode[] = [];
    for (const line of [...revision.lines].sort((a, b) => a.position - b.position)) {
      const component = sources.productById(line.componentProductId);
      if (!component) {
        throw new InvalidStateError(
          `BOM line references missing product ${line.componentProductId}`,
        );
      }
      if (path.includes(component.id)) {
        throw new BomCycleError([...path, component.id].map(String));
      }
      const qtyInBase = sources.registry.convert(line.quantity, line.uom, component.baseUom);
      const extended = roundTo(extendedQuantity * qtyInBase * (1 + line.scrapFactor), 6);
      const grandchildren = walk(component, extended, level + 1, [...path, component.id]);
      if (flatten && component.type === "phantom" && grandchildren.length > 0) {
        // Hoist the phantom's components into this level.
        children.push(...grandchildren);
        continue;
      }
      nodeCount += 1;
      children.push({
        productId: component.id,
        productCode: component.code,
        productName: component.name,
        productType: component.type,
        variantId: line.componentVariantId,
        quantityPer: qtyInBase,
        extendedQuantity: extended,
        uom: component.baseUom,
        scrapFactor: line.scrapFactor,
        level,
        revisionCode: revision.code,
        children: grandchildren,
      });
    }
    return children;
  };

  const children = walk(rootProduct, quantity, 1, [rootProduct.id]);
  const root: ExplosionNode = {
    productId: rootProduct.id,
    productCode: rootProduct.code,
    productName: rootProduct.name,
    productType: rootProduct.type,
    quantityPer: 1,
    extendedQuantity: quantity,
    uom: rootProduct.baseUom,
    scrapFactor: 0,
    level: 0,
    children,
  };
  return { root, at: options.at, totalNodeCount: nodeCount + 1 };
}

export interface ExplosionSummaryLine {
  readonly productId: Ulid;
  readonly productCode: string;
  readonly variantId?: Ulid;
  readonly totalQuantity: number;
  readonly uom: UomCode;
}

/**
 * Aggregates an explosion tree into total requirements per component — the
 * flat list MRP consumes. Only leaves (no children in the exploded tree)
 * appear, since intermediate assemblies are made, not procured.
 */
export function summarizeExplosion(result: ExplosionResult): ExplosionSummaryLine[] {
  const totals = new Map<string, ExplosionSummaryLine>();
  const visit = (node: ExplosionNode): void => {
    if (node.children.length === 0 && node.level > 0) {
      const key = `${node.productId}:${node.variantId ?? ""}`;
      const existing = totals.get(key);
      totals.set(key, {
        productId: node.productId,
        productCode: node.productCode,
        variantId: node.variantId,
        totalQuantity: roundTo((existing?.totalQuantity ?? 0) + node.extendedQuantity, 6),
        uom: node.uom,
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(result.root);
  return [...totals.values()].sort((a, b) => a.productCode.localeCompare(b.productCode));
}
