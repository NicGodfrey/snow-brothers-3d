import type { Permission } from "./rbac.js";

/**
 * Module descriptors: the static shape of the portal shell.
 *
 * A module maps one upstream bounded context (`sales-erp`, `srm-core`, ...) to
 * a slice of portal navigation. Descriptors are pure data so they can be
 * filtered per session, serialised to the BFF and asserted on in tests.
 */

export const MODULE_KEYS = [
  "sales",
  "marketing",
  "inventory",
  "srm",
  "prm",
  "finance",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** A leaf view inside a module: one list/detail screen backed by one query. */
export interface NavItem {
  readonly key: string;
  readonly label: string;
  /** Path relative to the module base path, without a leading slash. */
  readonly slug: string;
  readonly summary: string;
  readonly permission: Permission;
  /** Resource this view lists, used by the BFF to pick the client call. */
  readonly resource: string;
  /** Rendered in the nav rail as a live count when the module answers. */
  readonly countKey?: string;
}

export interface ModuleAction {
  readonly key: string;
  readonly label: string;
  readonly permission: Permission;
  /** POST target on the BFF, relative to the module base path. */
  readonly slug: string;
}

export interface KpiDescriptor {
  readonly key: string;
  readonly label: string;
  readonly format: "count" | "money" | "percent" | "days";
  /** Higher is better — drives the up/down arrow colouring. */
  readonly polarity: "up-good" | "down-good" | "neutral";
}

export interface ModuleDescriptor {
  readonly key: ModuleKey;
  readonly label: string;
  readonly tagline: string;
  /** Upstream workspace package that owns the data. */
  readonly service: string;
  /** Two-letter mark rendered in the nav rail (no icon font dependency). */
  readonly mark: string;
  readonly accent: string;
  readonly order: number;
  readonly permission: Permission;
  readonly nav: readonly NavItem[];
  readonly actions: readonly ModuleAction[];
  readonly kpis: readonly KpiDescriptor[];
}

export function modulePath(module: ModuleDescriptor): string {
  return `/m/${module.key}`;
}

export function navItemPath(module: ModuleDescriptor, item: NavItem): string {
  return `${modulePath(module)}/${item.slug}`;
}

export function findNavItem(
  module: ModuleDescriptor,
  slug: string,
): NavItem | undefined {
  return module.nav.find((item) => item.slug === slug);
}

export function defaultNavItem(module: ModuleDescriptor): NavItem {
  const first = module.nav[0];
  if (!first) throw new Error(`Module ${module.key} declares no nav items`);
  return first;
}
