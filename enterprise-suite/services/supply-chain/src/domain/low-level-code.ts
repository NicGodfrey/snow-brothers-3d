import { DomainError } from "@enterprise-suite/shared-kernel";
import type { PlanningItem } from "./planning-item.js";

/**
 * Low-level codes (LLC) order items for multi-level MRP: an item's LLC is the
 * deepest level at which it appears in any BOM (top-level items are 0). MRP
 * must fully plan level N before exploding demand into level N+1, otherwise
 * a component shared by two parents would be netted before all of its gross
 * requirements are known.
 *
 * Implemented as longest-path over the BOM DAG with cycle detection.
 */
export function computeLowLevelCodes(items: readonly PlanningItem[]): Map<string, number> {
  const bySku = new Map<string, PlanningItem>();
  for (const item of items) bySku.set(item.sku, item);

  const codes = new Map<string, number>();
  const onStack = new Set<string>();

  function visit(sku: string, level: number, path: string[]): void {
    if (onStack.has(sku)) {
      throw new DomainError(`BOM cycle detected: ${[...path, sku].join(" -> ")}`, "BOM_CYCLE", 422);
    }
    const existing = codes.get(sku);
    // Already explored at this depth or deeper: children already carry codes
    // at least as deep as this path would assign.
    if (existing !== undefined && level <= existing) return;
    codes.set(sku, level);

    const item = bySku.get(sku);
    if (!item) return; // component not under planning control; leaf by definition

    onStack.add(sku);
    for (const line of item.bom) {
      visit(line.componentSku, level + 1, [...path, sku]);
    }
    onStack.delete(sku);
  }

  // Roots are items that never appear as a component of any planned item.
  const componentSkus = new Set<string>();
  for (const item of items) {
    for (const line of item.bom) componentSkus.add(line.componentSku);
  }
  for (const item of items) {
    if (!componentSkus.has(item.sku)) visit(item.sku, 0, []);
  }
  // Anything still uncoded is only reachable through a cycle among non-roots;
  // visiting it as a root surfaces the cycle error deterministically.
  for (const item of items) {
    if (!codes.has(item.sku)) visit(item.sku, 0, []);
  }
  return codes;
}

/** Items grouped by low-level code, ascending (level 0 first). */
export function itemsByLevel(
  items: readonly PlanningItem[],
  codes: Map<string, number>,
): PlanningItem[][] {
  const maxLevel = Math.max(0, ...codes.values());
  const levels: PlanningItem[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const item of items) {
    levels[codes.get(item.sku) ?? 0].push(item);
  }
  return levels;
}
