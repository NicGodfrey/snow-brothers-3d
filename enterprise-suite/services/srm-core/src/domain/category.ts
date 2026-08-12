import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { CertificationType } from "./certification.js";

/**
 * Procurement category taxonomy (the "category tree" a CPO organises spend by).
 *
 * Categories are lightweight records; the tree invariants (unique codes, no
 * cycles on move, materialized `path` maintenance) live in CategoryService
 * because they span records. Beyond naming, each node carries **sourcing
 * policy**: how risky the category is, whether suppliers must be formally
 * qualified before they can be awarded business, which certifications they
 * must hold, and how often they must requalify.
 *
 * Policy is *inherited*: a child inherits its ancestors' required
 * certifications, the strictest risk tier and the shortest requalification
 * interval, so "electronics" can tighten what "indirect" already demands
 * without restating it.
 */

export type CategoryRiskTier = "low" | "medium" | "high" | "critical";

export const CATEGORY_RISK_TIERS: readonly CategoryRiskTier[] = ["low", "medium", "high", "critical"];

const RISK_TIER_RANK: Readonly<Record<CategoryRiskTier, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface CategoryRecord {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  /** Stable slug, unique per tenant, e.g. "pcb-assembly". */
  readonly code: string;
  readonly name: string;
  readonly parentId?: Ulid;
  /** Materialized slash-joined code path ("electronics/pcb-assembly"). */
  readonly path: string;
  readonly level: number;
  readonly riskTier: CategoryRiskTier;
  readonly requiresQualification: boolean;
  readonly requiredCertifications: readonly CertificationType[];
  /** Months of validity for a passed qualification in this category. */
  readonly requalificationMonths: number;
  /** Managers own the category's supplier panel and approve awards. */
  readonly managerUserId?: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface CategoryTreeNode extends CategoryRecord {
  readonly children: CategoryTreeNode[];
}

/** Effective policy for a node after merging its ancestor chain. */
export interface CategoryPolicy {
  readonly categoryId: Ulid;
  readonly path: string;
  readonly riskTier: CategoryRiskTier;
  readonly requiresQualification: boolean;
  readonly requiredCertifications: readonly CertificationType[];
  readonly requalificationMonths: number;
  /** Root-first chain, useful for explaining *why* a rule applies. */
  readonly inheritedFrom: readonly string[];
}

export function buildCategoryTree(records: readonly CategoryRecord[]): CategoryTreeNode[] {
  const nodes = new Map<Ulid, CategoryTreeNode>();
  for (const record of records) nodes.set(record.id, { ...record, children: [] });
  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: CategoryTreeNode, b: CategoryTreeNode) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const sortRecursive = (list: CategoryTreeNode[]) => {
    list.sort(order);
    for (const node of list) sortRecursive(node.children);
  };
  sortRecursive(roots);
  return roots;
}

/** Root-first ancestor chain including the node itself. */
export function ancestorChain(
  records: ReadonlyMap<Ulid, CategoryRecord>,
  categoryId: Ulid,
): CategoryRecord[] {
  const chain: CategoryRecord[] = [];
  const seen = new Set<Ulid>();
  let current = records.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? records.get(current.parentId) : undefined;
  }
  return chain;
}

export function isDescendantOf(
  records: ReadonlyMap<Ulid, CategoryRecord>,
  record: CategoryRecord,
  candidateAncestorId: Ulid,
): boolean {
  let current: CategoryRecord | undefined = record;
  const seen = new Set<Ulid>();
  while (current?.parentId) {
    if (seen.has(current.id)) return false; // corrupt data: fail closed
    seen.add(current.id);
    if (current.parentId === candidateAncestorId) return true;
    current = records.get(current.parentId);
  }
  return false;
}

export function descendantsOf(
  records: readonly CategoryRecord[],
  categoryId: Ulid,
): CategoryRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return records.filter((record) => isDescendantOf(byId, record, categoryId));
}

export function childPath(parent: CategoryRecord | undefined, code: string): string {
  return parent ? `${parent.path}/${code}` : code;
}

export function strictestRiskTier(a: CategoryRiskTier, b: CategoryRiskTier): CategoryRiskTier {
  return RISK_TIER_RANK[a] >= RISK_TIER_RANK[b] ? a : b;
}

export function riskTierRank(tier: CategoryRiskTier): number {
  return RISK_TIER_RANK[tier];
}

/**
 * Merges the ancestor chain into one effective policy. Certifications union,
 * risk tier takes the strictest, requalification takes the shortest non-zero
 * interval, and `requiresQualification` is sticky once any ancestor sets it.
 */
export function resolveCategoryPolicy(
  records: ReadonlyMap<Ulid, CategoryRecord>,
  categoryId: Ulid,
): CategoryPolicy | undefined {
  const chain = ancestorChain(records, categoryId);
  const leaf = chain[chain.length - 1];
  if (!leaf) return undefined;

  const certifications = new Set<CertificationType>();
  let riskTier: CategoryRiskTier = "low";
  let requiresQualification = false;
  let requalificationMonths = 0;
  const inheritedFrom: string[] = [];

  for (const node of chain) {
    for (const type of node.requiredCertifications) certifications.add(type);
    riskTier = strictestRiskTier(riskTier, node.riskTier);
    requiresQualification = requiresQualification || node.requiresQualification;
    if (node.requalificationMonths > 0) {
      requalificationMonths =
        requalificationMonths === 0
          ? node.requalificationMonths
          : Math.min(requalificationMonths, node.requalificationMonths);
    }
    inheritedFrom.push(node.code);
  }

  return {
    categoryId: leaf.id,
    path: leaf.path,
    riskTier,
    requiresQualification,
    requiredCertifications: [...certifications].sort(),
    requalificationMonths: requalificationMonths === 0 ? 24 : requalificationMonths,
    inheritedFrom,
  };
}
