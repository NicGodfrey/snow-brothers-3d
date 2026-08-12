import type { ApiClients } from "../api/index.js";
import type { ModuleSummaryDto } from "../api/module-api.js";
import { ApiError } from "../api/types.js";
import type { Dashboard, DashboardTile, Kpi, TileStatus } from "../domain/kpi.js";
import { navItemPath, type ModuleDescriptor, type ModuleKey } from "../domain/module.js";
import { defaultNavItem } from "../domain/module.js";
import { visibleModules } from "../domain/navigation.js";
import type { PortalSession } from "../domain/session.js";
import type { Clock } from "../infrastructure/clock.js";

/**
 * Fans out to every visible module's `/summary` and folds the answers into
 * dashboard tiles.
 *
 * One slow or broken module must never blank the dashboard, so failures are
 * isolated per tile: a 403 renders as "not permitted", anything else as
 * "unavailable", and the rest of the page still renders.
 */

export interface DashboardOptions {
  /** Only these modules; defaults to everything visible to the session. */
  readonly modules?: readonly ModuleKey[];
  readonly timeoutMs?: number;
}

export class DashboardService {
  constructor(
    private readonly clients: ApiClients,
    private readonly clock: Clock,
  ) {}

  async load(session: PortalSession, options: DashboardOptions = {}): Promise<Dashboard> {
    const modules = visibleModules(session).filter(
      (m) => !options.modules || options.modules.includes(m.key),
    );

    const loaded = await Promise.all(
      modules.map((module) => this.loadTile(module, options.timeoutMs)),
    );
    const tiles = loaded.map((entry) => entry.tile);

    return {
      generatedAt: this.clock.now(),
      tenantId: session.tenant.tenantId,
      tiles,
      degradedModules: tiles.filter((t) => t.status !== "ok").map((t) => t.module),
      counts: Object.assign({}, ...loaded.map((entry) => entry.counts)) as Record<string, number>,
    };
  }

  /** Count metrics for one module, for the nav rail badges. */
  async counts(module: ModuleKey): Promise<Readonly<Record<string, number>>> {
    try {
      return navCounts(await this.clients.byModule[module].summary());
    } catch {
      return {};
    }
  }

  private async loadTile(
    module: ModuleDescriptor,
    timeoutMs?: number,
  ): Promise<{ tile: DashboardTile; counts: Readonly<Record<string, number>> }> {
    const started = this.clock.epochMs();
    const path = navItemPath(module, defaultNavItem(module));
    try {
      const summary = await this.clients.byModule[module.key].summary(
        timeoutMs ? { timeoutMs } : undefined,
      );
      return {
        tile: {
          module: module.key,
          label: module.label,
          accent: module.accent,
          path,
          status: "ok",
          kpis: toKpis(module, summary),
          latencyMs: this.clock.epochMs() - started,
        },
        counts: navCounts(summary),
      };
    } catch (error) {
      const status: TileStatus =
        error instanceof ApiError && error.kind === "forbidden" ? "forbidden" : "degraded";
      return {
        tile: {
          module: module.key,
          label: module.label,
          accent: module.accent,
          path,
          status,
          kpis: [],
          message: describe(error, module.service),
          latencyMs: this.clock.epochMs() - started,
        },
        counts: {},
      };
    }
  }
}

export function toKpis(module: ModuleDescriptor, summary: ModuleSummaryDto): readonly Kpi[] {
  const kpis: Kpi[] = [];
  for (const descriptor of module.kpis) {
    const value = summary.metrics[descriptor.key];
    if (!value) continue;
    kpis.push({
      key: descriptor.key,
      label: descriptor.label,
      value,
      delta: summary.deltas?.[descriptor.key],
      polarity: descriptor.polarity,
    });
  }
  return kpis;
}

/** Counts a nav item can show in the rail, keyed by `NavItem.countKey`. */
export function navCounts(summary: ModuleSummaryDto): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(summary.metrics)) {
    if (value.kind === "count") counts[key] = value.value;
  }
  return counts;
}

function describe(error: unknown, service: string): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "forbidden":
        return "You do not have access to this module's data.";
      case "timeout":
        return `${service} did not respond in time.`;
      case "network":
        return `${service} is unreachable.`;
      default:
        return `${service} returned ${error.status}${error.code ? ` (${error.code})` : ""}.`;
    }
  }
  return `${service} failed: ${error instanceof Error ? error.message : String(error)}`;
}
