import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";

/**
 * Category tree.
 *
 * Categories are lightweight records; tree invariants (unique codes, no
 * cycles on move, path maintenance) live in CategoryService because they span
 * multiple records. `path` is a materialized slash-joined code path
 * ("hardware/fasteners") kept in sync on create/move/rename so reads never
 * need recursive queries.
 */

export interface CategoryRecord {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  /** Stable slug, unique per tenant, e.g. "fasteners". */
  readonly code: string;
  readonly name: string;
  readonly parentId?: Ulid;
  readonly path: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export const CATEGORY_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface CategoryTreeNode extends CategoryRecord {
  readonly children: CategoryTreeNode[];
}

/** Builds a forest from flat records, ordered by sortOrder then name. */
export function buildCategoryTree(records: readonly CategoryRecord[]): CategoryTreeNode[] {
  const nodes = new Map<Ulid, CategoryTreeNode>();
  for (const r of records) nodes.set(r.id, { ...r, children: [] });
  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: CategoryTreeNode, b: CategoryTreeNode) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const sortRec = (list: CategoryTreeNode[]) => {
    list.sort(order);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** True if `candidateAncestorId` appears on `record`'s parent chain. */
export function isDescendantOf(
  records: ReadonlyMap<Ulid, CategoryRecord>,
  record: CategoryRecord,
  candidateAncestorId: Ulid,
): boolean {
  let current: CategoryRecord | undefined = record;
  const seen = new Set<Ulid>();
  while (current?.parentId) {
    if (seen.has(current.id)) return false; // corrupt data; fail closed
    seen.add(current.id);
    if (current.parentId === candidateAncestorId) return true;
    current = records.get(current.parentId);
  }
  return false;
}

export function childPath(parent: CategoryRecord | undefined, code: string): string {
  return parent ? `${parent.path}/${code}` : code;
}
