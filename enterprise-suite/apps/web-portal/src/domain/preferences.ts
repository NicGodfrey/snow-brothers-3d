import { DomainError } from "@enterprise-suite/shared-kernel";
import { MODULE_KEYS, isModuleKey, type ModuleKey } from "./module.js";

/**
 * Per-user, per-tenant portal preferences: pinned modules, landing module,
 * density and saved list views. Backed by `migrations/0001_portal.sql` in
 * production, by an in-memory repository here.
 */

export type Density = "comfortable" | "compact";
export type Theme = "system" | "light" | "dark";

export interface SavedView {
  readonly id: string;
  readonly module: ModuleKey;
  readonly resource: string;
  readonly name: string;
  readonly query: Readonly<Record<string, string>>;
  readonly createdAt: string;
}

export interface PortalPreferences {
  readonly tenantId: string;
  readonly userId: string;
  readonly pinnedModules: readonly ModuleKey[];
  readonly landingModule?: ModuleKey;
  readonly density: Density;
  readonly theme: Theme;
  readonly locale: string;
  readonly savedViews: readonly SavedView[];
  readonly updatedAt: string;
}

export const MAX_PINNED_MODULES = 4;

export function defaultPreferences(
  tenantId: string,
  userId: string,
  locale: string,
  now: string,
): PortalPreferences {
  return {
    tenantId,
    userId,
    pinnedModules: [],
    density: "comfortable",
    theme: "system",
    locale,
    savedViews: [],
    updatedAt: now,
  };
}

export interface PreferencesPatch {
  readonly pinnedModules?: readonly string[];
  readonly landingModule?: string | null;
  readonly density?: string;
  readonly theme?: string;
  readonly locale?: string;
}

export function applyPatch(
  current: PortalPreferences,
  patch: PreferencesPatch,
  now: string,
): PortalPreferences {
  const next: {
    -readonly [K in keyof PortalPreferences]: PortalPreferences[K];
  } = { ...current, updatedAt: now };

  if (patch.pinnedModules) {
    next.pinnedModules = parsePinned(patch.pinnedModules);
  }
  if (patch.landingModule !== undefined) {
    next.landingModule = patch.landingModule === null ? undefined : parseModule(patch.landingModule);
  }
  if (patch.density !== undefined) {
    if (patch.density !== "comfortable" && patch.density !== "compact") {
      throw new DomainError(`Unknown density: ${patch.density}`, "VALIDATION", 400);
    }
    next.density = patch.density;
  }
  if (patch.theme !== undefined) {
    if (patch.theme !== "system" && patch.theme !== "light" && patch.theme !== "dark") {
      throw new DomainError(`Unknown theme: ${patch.theme}`, "VALIDATION", 400);
    }
    next.theme = patch.theme;
  }
  if (patch.locale !== undefined) {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(patch.locale)) {
      throw new DomainError(`Unknown locale: ${patch.locale}`, "VALIDATION", 400);
    }
    next.locale = patch.locale;
  }
  return next;
}

export function togglePin(
  current: PortalPreferences,
  module: ModuleKey,
  now: string,
): PortalPreferences {
  const pinned = current.pinnedModules.includes(module)
    ? current.pinnedModules.filter((m) => m !== module)
    : [...current.pinnedModules, module];
  if (pinned.length > MAX_PINNED_MODULES) {
    throw new DomainError(
      `At most ${MAX_PINNED_MODULES} modules can be pinned`,
      "VALIDATION",
      400,
    );
  }
  return { ...current, pinnedModules: pinned, updatedAt: now };
}

export function addSavedView(
  current: PortalPreferences,
  view: SavedView,
): PortalPreferences {
  if (current.savedViews.some((v) => v.name === view.name && v.module === view.module)) {
    throw new DomainError(`Saved view already exists: ${view.name}`, "CONFLICT", 409);
  }
  return {
    ...current,
    savedViews: [...current.savedViews, view],
    updatedAt: view.createdAt,
  };
}

export function removeSavedView(
  current: PortalPreferences,
  viewId: string,
  now: string,
): PortalPreferences {
  const savedViews = current.savedViews.filter((v) => v.id !== viewId);
  if (savedViews.length === current.savedViews.length) {
    throw new DomainError(`Saved view not found: ${viewId}`, "NOT_FOUND", 404);
  }
  return { ...current, savedViews, updatedAt: now };
}

function parsePinned(values: readonly string[]): readonly ModuleKey[] {
  const parsed = values.map(parseModule);
  const unique = [...new Set(parsed)];
  if (unique.length !== parsed.length) {
    throw new DomainError("Pinned modules must be unique", "VALIDATION", 400);
  }
  if (unique.length > MAX_PINNED_MODULES) {
    throw new DomainError(
      `At most ${MAX_PINNED_MODULES} modules can be pinned`,
      "VALIDATION",
      400,
    );
  }
  return unique;
}

function parseModule(value: string): ModuleKey {
  if (!isModuleKey(value)) {
    throw new DomainError(
      `Unknown module: ${value}`,
      "VALIDATION",
      400,
      { allowed: MODULE_KEYS },
    );
  }
  return value;
}
