import { MODULE_CATALOG, tryGetModule } from "./module-catalog.js";
import {
  defaultNavItem,
  findNavItem,
  modulePath,
  navItemPath,
  type ModuleDescriptor,
  type ModuleKey,
  type NavItem,
} from "./module.js";
import { isEntitled, type PortalSession } from "./session.js";

/**
 * Route resolution and nav-tree construction.
 *
 * Paths are `/`, `/m/<module>`, `/m/<module>/<slug>` and a handful of system
 * screens. Everything the chrome renders (rail, breadcrumbs, module tabs) is
 * derived from a `RouteMatch` plus the session, so the SSR views and the BFF
 * always agree on what "active" means.
 */

export type SystemRoute = "search" | "preferences" | "profile" | "sign-in";

export type RouteMatch =
  | { readonly kind: "dashboard"; readonly path: "/" }
  | {
      readonly kind: "module";
      readonly path: string;
      readonly module: ModuleDescriptor;
      readonly item: NavItem;
    }
  | { readonly kind: "system"; readonly path: string; readonly route: SystemRoute }
  | { readonly kind: "not-found"; readonly path: string };

const SYSTEM_ROUTES: Readonly<Record<string, SystemRoute>> = {
  "/search": "search",
  "/preferences": "preferences",
  "/profile": "profile",
  "/sign-in": "sign-in",
};

export function resolveRoute(path: string): RouteMatch {
  const clean = normalizePath(path);
  if (clean === "/") return { kind: "dashboard", path: "/" };

  const system = SYSTEM_ROUTES[clean];
  if (system) return { kind: "system", path: clean, route: system };

  const segments = clean.split("/").filter(Boolean);
  if (segments[0] === "m" && segments[1]) {
    const module = tryGetModule(segments[1]);
    if (!module) return { kind: "not-found", path: clean };
    const slug = segments[2];
    const item = slug ? findNavItem(module, slug) : defaultNavItem(module);
    if (!item || segments.length > 3) return { kind: "not-found", path: clean };
    return { kind: "module", path: navItemPath(module, item), module, item };
  }
  return { kind: "not-found", path: clean };
}

export function normalizePath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? "/";
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

export interface NavItemView {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly summary: string;
  readonly active: boolean;
  /** False when the session may see the module but not this view. */
  readonly enabled: boolean;
  readonly countKey?: string;
}

export interface NavModuleView {
  readonly key: ModuleKey;
  readonly label: string;
  readonly tagline: string;
  readonly mark: string;
  readonly accent: string;
  readonly path: string;
  readonly active: boolean;
  readonly pinned: boolean;
  readonly items: readonly NavItemView[];
}

export interface NavigationOptions {
  readonly activePath?: string;
  readonly pinned?: readonly ModuleKey[];
  /** Keep views the session cannot open, rendered disabled instead of hidden. */
  readonly showDenied?: boolean;
}

/**
 * Modules visible to a session: entitled to the tenant, readable by the role,
 * pinned ones hoisted to the top of the rail in the user's pin order.
 */
export function visibleModules(
  session: PortalSession,
  pinned: readonly ModuleKey[] = [],
): readonly ModuleDescriptor[] {
  const visible = MODULE_CATALOG.filter(
    (m) => isEntitled(session, m.key) && session.permissions.has(m.permission),
  );
  const pinIndex = new Map(pinned.map((key, index) => [key, index]));
  return [...visible].sort((a, b) => {
    const ap = pinIndex.get(a.key);
    const bp = pinIndex.get(b.key);
    if (ap !== undefined && bp !== undefined) return ap - bp;
    if (ap !== undefined) return -1;
    if (bp !== undefined) return 1;
    return a.order - b.order;
  });
}

export function buildNavigation(
  session: PortalSession,
  options: NavigationOptions = {},
): readonly NavModuleView[] {
  const activePath = options.activePath ? normalizePath(options.activePath) : undefined;
  const pinned = options.pinned ?? [];
  return visibleModules(session, pinned).map((module) => {
    const items: NavItemView[] = [];
    for (const item of module.nav) {
      const enabled = session.permissions.has(item.permission);
      if (!enabled && !options.showDenied) continue;
      const path = navItemPath(module, item);
      items.push({
        key: item.key,
        label: item.label,
        path,
        summary: item.summary,
        active: enabled && path === activePath,
        enabled,
        countKey: item.countKey,
      });
    }
    return {
      key: module.key,
      label: module.label,
      tagline: module.tagline,
      mark: module.mark,
      accent: module.accent,
      path: items.find((i) => i.enabled)?.path ?? modulePath(module),
      active: activePath?.startsWith(modulePath(module)) ?? false,
      pinned: pinned.includes(module.key),
      items,
    };
  });
}

export interface Crumb {
  readonly label: string;
  readonly path?: string;
}

export function breadcrumbs(match: RouteMatch): readonly Crumb[] {
  const home: Crumb = { label: "Home", path: "/" };
  switch (match.kind) {
    case "dashboard":
      return [{ label: "Home" }];
    case "module":
      return [
        home,
        { label: match.module.label, path: modulePath(match.module) },
        { label: match.item.label },
      ];
    case "system":
      return [home, { label: systemLabel(match.route) }];
    case "not-found":
      return [home, { label: "Not found" }];
  }
}

export function systemLabel(route: SystemRoute): string {
  switch (route) {
    case "search":
      return "Search";
    case "preferences":
      return "Preferences";
    case "profile":
      return "Profile";
    case "sign-in":
      return "Sign in";
  }
}

/** First landing target a session can actually open. */
export function landingPath(
  session: PortalSession,
  preferred?: ModuleKey,
): string {
  const modules = visibleModules(session);
  if (preferred) {
    const match = modules.find((m) => m.key === preferred);
    if (match) return navItemPath(match, defaultNavItem(match));
  }
  return "/";
}
