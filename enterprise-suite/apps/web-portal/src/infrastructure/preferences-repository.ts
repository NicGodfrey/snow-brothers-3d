import { defaultPreferences, type PortalPreferences } from "../domain/preferences.js";

/**
 * Preferences persistence. In-memory here; the SQL shape it mirrors lives in
 * `migrations/0001_portal.sql` (one row per tenant+user, saved views in a
 * child table).
 */
export interface PreferencesRepository {
  find(tenantId: string, userId: string): Promise<PortalPreferences | undefined>;
  save(preferences: PortalPreferences): Promise<PortalPreferences>;
  /** Returns stored preferences or a defaulted, unsaved record. */
  findOrDefault(
    tenantId: string,
    userId: string,
    locale: string,
    now: string,
  ): Promise<PortalPreferences>;
}

export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly rows = new Map<string, PortalPreferences>();

  async find(tenantId: string, userId: string): Promise<PortalPreferences | undefined> {
    return this.rows.get(key(tenantId, userId));
  }

  async save(preferences: PortalPreferences): Promise<PortalPreferences> {
    this.rows.set(key(preferences.tenantId, preferences.userId), preferences);
    return preferences;
  }

  async findOrDefault(
    tenantId: string,
    userId: string,
    locale: string,
    now: string,
  ): Promise<PortalPreferences> {
    return (
      this.rows.get(key(tenantId, userId)) ?? defaultPreferences(tenantId, userId, locale, now)
    );
  }

  /** Test/diagnostics helper: every stored row, tenant-scoped. */
  listForTenant(tenantId: string): readonly PortalPreferences[] {
    return [...this.rows.values()].filter((p) => p.tenantId === tenantId);
  }
}

function key(tenantId: string, userId: string): string {
  return `${tenantId}::${userId}`;
}
