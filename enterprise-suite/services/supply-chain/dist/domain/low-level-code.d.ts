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
export declare function computeLowLevelCodes(items: readonly PlanningItem[]): Map<string, number>;
/** Items grouped by low-level code, ascending (level 0 first). */
export declare function itemsByLevel(items: readonly PlanningItem[], codes: Map<string, number>): PlanningItem[][];
//# sourceMappingURL=low-level-code.d.ts.map