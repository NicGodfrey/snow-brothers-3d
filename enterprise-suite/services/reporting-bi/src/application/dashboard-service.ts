/**
 * Dashboard use-cases, including rendering.
 *
 * Rendering resolves each tile's relative window against the clock and runs
 * it. Tiles are rendered independently and a failing tile becomes an error
 * payload on that tile rather than a failed dashboard: one broken metric
 * must not blank out the other eleven panels.
 */
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  Dashboard,
  type AddTileInput,
  type ChartKind,
  type CreateDashboardInput,
  type DashboardStatus,
  type DashboardTile,
  type TileLayout,
  type TileWindow,
} from "../domain/dashboard.js";
import type { KpiSnapshot } from "../domain/kpi.js";
import type { CubeQueryResult } from "../domain/query.js";
import type { DashboardRepository } from "../domain/repositories.js";
import { trailingRange } from "../domain/time-grain.js";
import type { KpiService } from "./kpi-service.js";
import type { Clock, Outbox } from "./ports.js";
import type { QueryService } from "./query-service.js";

export interface RenderedTile {
  readonly tile: DashboardTile;
  readonly kind: "kpi" | "result" | "error";
  readonly snapshot?: KpiSnapshot;
  readonly result?: CubeQueryResult;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface RenderedDashboard {
  readonly code: string;
  readonly title: string;
  readonly status: DashboardStatus;
  readonly renderedAt: IsoDateTime;
  readonly refreshIntervalSeconds: number;
  readonly tiles: readonly RenderedTile[];
  readonly errorCount: number;
}

export class DashboardService {
  constructor(
    private readonly dashboards: DashboardRepository,
    private readonly queries: QueryService,
    private readonly kpis: KpiService,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
  ) {}

  async createDashboard(ctx: TenantContext, input: CreateDashboardInput): Promise<Dashboard> {
    const existing = await this.dashboards.findByCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`dashboard '${input.code}' already exists`);
    const dashboard = Dashboard.create(ctx.tenantId, input);
    await this.flush(dashboard);
    return dashboard;
  }

  async getDashboard(ctx: TenantContext, code: string): Promise<Dashboard> {
    const dashboard = await this.dashboards.findByCode(ctx.tenantId, code);
    if (!dashboard) throw new NotFoundError("Dashboard", code);
    return dashboard;
  }

  async listDashboards(ctx: TenantContext, filter?: { status?: DashboardStatus }): Promise<Dashboard[]> {
    const all = await this.dashboards.list(ctx.tenantId, filter);
    return all.filter((dashboard) => dashboard.isVisibleTo(ctx.roles));
  }

  async addTile(ctx: TenantContext, code: string, input: AddTileInput): Promise<DashboardTile> {
    const dashboard = await this.getDashboard(ctx, code);
    const tile = dashboard.addTile(input);
    await this.flush(dashboard);
    return tile;
  }

  async updateTile(
    ctx: TenantContext,
    code: string,
    tileId: Ulid,
    changes: {
      title?: string;
      layout?: Partial<TileLayout>;
      window?: Partial<TileWindow>;
      chart?: { kind: ChartKind };
    },
  ): Promise<DashboardTile> {
    const dashboard = await this.getDashboard(ctx, code);
    const tile = dashboard.updateTile(tileId, changes);
    await this.flush(dashboard);
    return tile;
  }

  async removeTile(ctx: TenantContext, code: string, tileId: Ulid): Promise<Dashboard> {
    const dashboard = await this.getDashboard(ctx, code);
    dashboard.removeTile(tileId);
    await this.flush(dashboard);
    return dashboard;
  }

  async publishDashboard(ctx: TenantContext, code: string): Promise<Dashboard> {
    const dashboard = await this.getDashboard(ctx, code);
    dashboard.publish();
    await this.flush(dashboard);
    return dashboard;
  }

  async archiveDashboard(ctx: TenantContext, code: string, reason: string): Promise<Dashboard> {
    const dashboard = await this.getDashboard(ctx, code);
    dashboard.archive(reason);
    await this.flush(dashboard);
    return dashboard;
  }

  /** The instant a render would use — callers rendering a single tile need it. */
  now(): IsoDateTime {
    return this.clock.now();
  }

  async render(ctx: TenantContext, code: string, anchor?: IsoDateTime): Promise<RenderedDashboard> {
    const dashboard = await this.getDashboard(ctx, code);
    if (!dashboard.isVisibleTo(ctx.roles)) {
      throw new ForbiddenError(`dashboard '${code}' requires one of: ${dashboard.audienceRoles.join(", ")}`);
    }
    const at = anchor ?? this.clock.now();
    const tiles: RenderedTile[] = [];
    for (const tile of dashboard.tiles) {
      tiles.push(await this.renderTile(ctx, tile, at));
    }
    return {
      code: dashboard.code,
      title: dashboard.title,
      status: dashboard.status,
      renderedAt: at,
      refreshIntervalSeconds: dashboard.refreshIntervalSeconds,
      tiles,
      errorCount: tiles.filter((t) => t.kind === "error").length,
    };
  }

  /** Renders a single tile — used by tile-level refresh and tile exports. */
  async renderTile(ctx: TenantContext, tile: DashboardTile, at: IsoDateTime): Promise<RenderedTile> {
    try {
      if (tile.type === "kpi") {
        const snapshot = await this.kpis.computeSnapshot(ctx, tile.kpiCode!, at);
        return { tile, kind: "kpi", snapshot };
      }
      const result = await this.queries.run(ctx, this.resolveTileQuery(tile, at));
      return { tile, kind: "result", result };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "TILE_RENDER_FAILED";
      return {
        tile,
        kind: "error",
        error: { code, message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /** Turns a stored tile spec into an absolute, runnable query. */
  resolveTileQuery(tile: DashboardTile, at: IsoDateTime) {
    if (!tile.query) {
      throw new NotFoundError("TileQuery", tile.id);
    }
    const range = trailingRange(at, tile.window.grain, tile.window.trailingPeriods);
    return {
      ...tile.query,
      timeGrain: tile.window.groupByPeriod ? tile.window.grain : undefined,
      timeRange: range,
      densify: tile.window.groupByPeriod ? tile.query.densify : false,
    };
  }

  private async flush(dashboard: Dashboard): Promise<void> {
    await this.dashboards.save(dashboard);
    await this.outbox.append(dashboard.pullEvents());
  }
}
