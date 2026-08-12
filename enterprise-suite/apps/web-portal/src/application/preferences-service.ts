import { DomainError, newId } from "@enterprise-suite/shared-kernel";
import { isModuleKey, type ModuleKey } from "../domain/module.js";
import {
  addSavedView,
  applyPatch,
  removeSavedView,
  togglePin,
  type PortalPreferences,
  type PreferencesPatch,
  type SavedView,
} from "../domain/preferences.js";
import { isEntitled, type PortalSession } from "../domain/session.js";
import type { Clock } from "../infrastructure/clock.js";
import type { PreferencesRepository } from "../infrastructure/preferences-repository.js";

/**
 * Reads and writes the caller's own preferences. Every mutation re-checks the
 * tenant's entitlements, so a module dropped from the subscription cannot stay
 * pinned or remain someone's landing page.
 */
export class PreferencesService {
  constructor(
    private readonly repository: PreferencesRepository,
    private readonly clock: Clock,
  ) {}

  async load(session: PortalSession): Promise<PortalPreferences> {
    const stored = await this.repository.findOrDefault(
      session.tenant.tenantId,
      session.user.userId,
      session.tenant.defaultLocale,
      this.clock.now(),
    );
    return this.prune(session, stored);
  }

  async update(session: PortalSession, patch: PreferencesPatch): Promise<PortalPreferences> {
    const current = await this.load(session);
    const next = applyPatch(current, patch, this.clock.now());
    for (const module of next.pinnedModules) this.assertVisible(session, module);
    if (next.landingModule) this.assertVisible(session, next.landingModule);
    return this.repository.save(next);
  }

  async togglePinned(session: PortalSession, module: string): Promise<PortalPreferences> {
    if (!isModuleKey(module)) {
      throw new DomainError(`Unknown module: ${module}`, "VALIDATION", 400);
    }
    this.assertVisible(session, module);
    const current = await this.load(session);
    return this.repository.save(togglePin(current, module, this.clock.now()));
  }

  async saveView(
    session: PortalSession,
    input: { module: string; resource: string; name: string; query?: Record<string, string> },
  ): Promise<PortalPreferences> {
    if (!isModuleKey(input.module)) {
      throw new DomainError(`Unknown module: ${input.module}`, "VALIDATION", 400);
    }
    this.assertVisible(session, input.module);
    const name = input.name.trim();
    if (name.length === 0) {
      throw new DomainError("Saved view needs a name", "VALIDATION", 400);
    }
    const view: SavedView = {
      id: newId("view"),
      module: input.module,
      resource: input.resource,
      name,
      query: { ...(input.query ?? {}) },
      createdAt: this.clock.now(),
    };
    const current = await this.load(session);
    return this.repository.save(addSavedView(current, view));
  }

  async deleteView(session: PortalSession, viewId: string): Promise<PortalPreferences> {
    const current = await this.load(session);
    return this.repository.save(removeSavedView(current, viewId, this.clock.now()));
  }

  /** Drops anything the session can no longer see; never persists on read. */
  private prune(session: PortalSession, preferences: PortalPreferences): PortalPreferences {
    const visible = (module: ModuleKey): boolean =>
      isEntitled(session, module) && session.permissions.has(`${module}:read`);
    const pinnedModules = preferences.pinnedModules.filter(visible);
    const landingModule =
      preferences.landingModule && visible(preferences.landingModule)
        ? preferences.landingModule
        : undefined;
    const savedViews = preferences.savedViews.filter((v) => visible(v.module));
    if (
      pinnedModules.length === preferences.pinnedModules.length &&
      landingModule === preferences.landingModule &&
      savedViews.length === preferences.savedViews.length
    ) {
      return preferences;
    }
    return { ...preferences, pinnedModules, landingModule, savedViews };
  }

  private assertVisible(session: PortalSession, module: ModuleKey): void {
    if (!isEntitled(session, module)) {
      throw new DomainError(
        `Tenant ${session.tenant.tenantId} is not entitled to ${module}`,
        "NOT_ENTITLED",
        403,
      );
    }
    session.permissions.require(`${module}:read`);
  }
}
