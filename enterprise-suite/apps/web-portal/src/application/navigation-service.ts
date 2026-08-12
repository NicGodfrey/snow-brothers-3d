import type { ModuleKey } from "../domain/module.js";
import {
  breadcrumbs,
  buildNavigation,
  resolveRoute,
  type Crumb,
  type NavModuleView,
  type RouteMatch,
} from "../domain/navigation.js";
import type { PortalPreferences } from "../domain/preferences.js";
import type { PortalSession } from "../domain/session.js";
import type { Directory } from "../infrastructure/auth/directory.js";

/**
 * Builds the chrome around every page: rail, breadcrumbs, tenant switcher and
 * the identity block. Pages render inside this; nothing else computes it.
 */

export interface TenantOption {
  readonly tenantId: string;
  readonly name: string;
  readonly current: boolean;
}

export interface ShellModel {
  readonly route: RouteMatch;
  readonly nav: readonly NavModuleView[];
  readonly crumbs: readonly Crumb[];
  readonly tenants: readonly TenantOption[];
  readonly user: {
    readonly userId: string;
    readonly displayName: string;
    readonly email: string;
    readonly roles: readonly string[];
    readonly impersonatedBy?: string;
  };
  readonly density: PortalPreferences["density"];
  readonly theme: PortalPreferences["theme"];
  readonly pinned: readonly ModuleKey[];
  readonly commandPaletteEnabled: boolean;
}

export class NavigationService {
  constructor(private readonly directory: Directory) {}

  build(session: PortalSession, path: string, preferences: PortalPreferences): ShellModel {
    const route = resolveRoute(path);
    return {
      route,
      nav: buildNavigation(session, {
        activePath: route.path,
        pinned: preferences.pinnedModules,
        showDenied: true,
      }),
      crumbs: breadcrumbs(route),
      tenants: this.tenantOptions(session),
      user: {
        userId: session.user.userId,
        displayName: session.user.displayName,
        email: session.user.email,
        roles: session.roles,
        impersonatedBy: session.impersonatedBy,
      },
      density: preferences.density,
      theme: preferences.theme,
      pinned: preferences.pinnedModules,
      commandPaletteEnabled: session.tenant.featureFlags.commandPalette === true,
    };
  }

  tenantOptions(session: PortalSession): readonly TenantOption[] {
    return this.directory
      .tenantsFor(session.user)
      .map((tenant) => ({
        tenantId: tenant.tenantId,
        name: tenant.name,
        current: tenant.tenantId === session.tenant.tenantId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
