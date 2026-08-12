/**
 * Dashboards: an ordered set of tiles over a 12-column grid.
 *
 * Tiles store *relative* windows ("trailing 12 months"), never absolute
 * dates. A dashboard saved in January must still be correct in June without
 * anyone editing it, and an export of a tile must reproduce what the viewer
 * saw at the time they clicked, which the renderer resolves from the clock.
 */
import {
  AggregateRoot,
  ConflictError,
  envelope,
  newId,
  type EntityProps,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { DefinitionError } from "./errors.js";
import { ReportingEventTypes } from "./events.js";
import type { CubeQueryInput } from "./query.js";
import { isTimeGrain, type TimeGrain } from "./time-grain.js";

export const GRID_COLUMNS = 12;

export type TileType = "kpi" | "chart" | "table";

export type ChartKind = "line" | "area" | "bar" | "stacked-bar" | "pie" | "donut";

export const CHART_KINDS: readonly ChartKind[] = ["line", "area", "bar", "stacked-bar", "pie", "donut"];

export interface TileLayout {
  readonly row: number;
  readonly col: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Relative time window resolved at render time. `groupByPeriod` decides
 * whether the grain is only a window length (a donut of the last quarter) or
 * also a grouping key (a line chart by month).
 */
export interface TileWindow {
  readonly grain: TimeGrain;
  readonly trailingPeriods: number;
  readonly groupByPeriod: boolean;
}

/** A stored query without an absolute range — the window supplies that. */
export type TileQuerySpec = Omit<CubeQueryInput, "timeRange" | "timeGrain">;

export interface DashboardTile {
  readonly id: Ulid;
  readonly type: TileType;
  readonly title: string;
  readonly layout: TileLayout;
  readonly window: TileWindow;
  readonly kpiCode?: string;
  readonly query?: TileQuerySpec;
  readonly chart?: { readonly kind: ChartKind };
}

export type DashboardStatus = "draft" | "published" | "archived";

interface DashboardProps {
  code: string;
  title: string;
  description?: string;
  status: DashboardStatus;
  tiles: DashboardTile[];
  audienceRoles: string[];
  refreshIntervalSeconds: number;
}

const CODE_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

export interface CreateDashboardInput {
  code: string;
  title: string;
  description?: string;
  audienceRoles?: readonly string[];
  refreshIntervalSeconds?: number;
}

export interface AddTileInput {
  type: TileType;
  title: string;
  layout?: Partial<TileLayout>;
  window?: Partial<TileWindow>;
  kpiCode?: string;
  query?: TileQuerySpec;
  chart?: { kind: ChartKind };
}

export class Dashboard extends AggregateRoot<DashboardProps> {
  private constructor(tenantId: TenantId, props: DashboardProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(tenantId: TenantId, input: CreateDashboardInput): Dashboard {
    if (!CODE_PATTERN.test(input.code)) {
      throw new DefinitionError(
        `dashboard code '${input.code}' must be kebab-case, start with a letter, and be 3..64 characters`,
      );
    }
    if (!input.title.trim()) throw new DefinitionError(`dashboard '${input.code}' needs a title`);
    const refresh = input.refreshIntervalSeconds ?? 300;
    if (!Number.isInteger(refresh) || refresh < 30 || refresh > 86_400) {
      throw new DefinitionError("refreshIntervalSeconds must be an integer between 30 and 86400");
    }

    const dashboard = new Dashboard(tenantId, {
      code: input.code,
      title: input.title.trim(),
      description: input.description?.trim(),
      status: "draft",
      tiles: [],
      audienceRoles: [...(input.audienceRoles ?? [])],
      refreshIntervalSeconds: refresh,
    });
    dashboard.raise(
      envelope({
        eventType: ReportingEventTypes.DashboardCreated,
        aggregateType: "Dashboard",
        aggregateId: dashboard.id,
        tenantId,
        payload: { code: input.code, title: dashboard.props.title },
      }),
    );
    return dashboard;
  }

  static rehydrate(
    tenantId: TenantId,
    props: DashboardProps,
    existing: Partial<EntityProps>,
  ): Dashboard {
    return new Dashboard(tenantId, props, existing);
  }

  get code(): string { return this.props.code; }
  get title(): string { return this.props.title; }
  get description(): string | undefined { return this.props.description; }
  get status(): DashboardStatus { return this.props.status; }
  get tiles(): readonly DashboardTile[] { return this.props.tiles; }
  get audienceRoles(): readonly string[] { return this.props.audienceRoles; }
  get refreshIntervalSeconds(): number { return this.props.refreshIntervalSeconds; }

  tile(tileId: Ulid): DashboardTile | undefined {
    return this.props.tiles.find((t) => t.id === tileId);
  }

  addTile(input: AddTileInput): DashboardTile {
    this.assertMutable();
    if (!input.title.trim()) throw new DefinitionError("tile title is required");
    if (input.type === "kpi" && !input.kpiCode) {
      throw new DefinitionError("a kpi tile requires a kpiCode");
    }
    if (input.type !== "kpi" && !input.query) {
      throw new DefinitionError(`a ${input.type} tile requires a query`);
    }
    if (input.type === "chart" && input.chart && !CHART_KINDS.includes(input.chart.kind)) {
      throw new DefinitionError(`unknown chart kind '${input.chart.kind}'`);
    }

    const layout = normalizeLayout(input.layout, this.nextFreeRow());
    const window = normalizeWindow(input.window);
    const tile: DashboardTile = {
      id: newId("tile"),
      type: input.type,
      title: input.title.trim(),
      layout,
      window,
      kpiCode: input.kpiCode,
      query: input.query,
      chart: input.type === "chart" ? (input.chart ?? { kind: "line" }) : undefined,
    };
    this.assertFits(tile);
    this.props.tiles.push(tile);
    this.touch();
    return tile;
  }

  updateTile(
    tileId: Ulid,
    changes: { title?: string; layout?: Partial<TileLayout>; window?: Partial<TileWindow>; chart?: { kind: ChartKind } },
  ): DashboardTile {
    this.assertMutable();
    const index = this.props.tiles.findIndex((t) => t.id === tileId);
    if (index === -1) throw new DefinitionError(`tile ${tileId} is not on dashboard '${this.props.code}'`);
    const existing = this.props.tiles[index]!;
    const updated: DashboardTile = {
      ...existing,
      title: changes.title?.trim() || existing.title,
      layout: changes.layout ? normalizeLayout({ ...existing.layout, ...changes.layout }, existing.layout.row) : existing.layout,
      window: changes.window ? normalizeWindow({ ...existing.window, ...changes.window }) : existing.window,
      chart: changes.chart ?? existing.chart,
    };
    this.props.tiles[index] = updated;
    this.assertFits(updated, tileId);
    this.touch();
    return updated;
  }

  removeTile(tileId: Ulid): void {
    this.assertMutable();
    const index = this.props.tiles.findIndex((t) => t.id === tileId);
    if (index === -1) throw new DefinitionError(`tile ${tileId} is not on dashboard '${this.props.code}'`);
    this.props.tiles.splice(index, 1);
    this.touch();
  }

  publish(): void {
    if (this.props.status === "published") {
      throw new ConflictError(`dashboard '${this.props.code}' is already published`);
    }
    if (this.props.tiles.length === 0) {
      throw new DefinitionError(`dashboard '${this.props.code}' has no tiles to publish`);
    }
    this.props.status = "published";
    this.raise(
      envelope({
        eventType: ReportingEventTypes.DashboardPublished,
        aggregateType: "Dashboard",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code, tileCount: this.props.tiles.length },
      }),
    );
  }

  archive(reason: string): void {
    if (!reason.trim()) throw new DefinitionError("an archive reason is required");
    if (this.props.status === "archived") {
      throw new ConflictError(`dashboard '${this.props.code}' is already archived`);
    }
    this.props.status = "archived";
    this.raise(
      envelope({
        eventType: ReportingEventTypes.DashboardArchived,
        aggregateType: "Dashboard",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code, reason: reason.trim() },
      }),
    );
  }

  /** Roles allowed to view; empty means "any authenticated tenant user". */
  grantAudience(role: string): void {
    if (!role.trim()) throw new DefinitionError("role cannot be blank");
    if (this.props.audienceRoles.includes(role)) return;
    this.props.audienceRoles.push(role);
    this.touch();
  }

  isVisibleTo(roles: readonly string[]): boolean {
    if (this.props.audienceRoles.length === 0) return true;
    return this.props.audienceRoles.some((role) => roles.includes(role));
  }

  private nextFreeRow(): number {
    return this.props.tiles.reduce((max, tile) => Math.max(max, tile.layout.row + tile.layout.height), 0);
  }

  private assertFits(tile: DashboardTile, replacingId?: Ulid): void {
    if (tile.layout.col + tile.layout.width > GRID_COLUMNS) {
      throw new DefinitionError(
        `tile '${tile.title}' spans columns ${tile.layout.col}..${tile.layout.col + tile.layout.width} beyond the ${GRID_COLUMNS}-column grid`,
      );
    }
    for (const other of this.props.tiles) {
      if (other.id === tile.id || other.id === replacingId) continue;
      if (overlaps(tile.layout, other.layout)) {
        throw new ConflictError(
          `tile '${tile.title}' overlaps '${other.title}' at row ${tile.layout.row}, column ${tile.layout.col}`,
        );
      }
    }
  }

  private assertMutable(): void {
    if (this.props.status === "archived") {
      throw new ConflictError(`dashboard '${this.props.code}' is archived`);
    }
  }
}

function overlaps(a: TileLayout, b: TileLayout): boolean {
  const horizontal = a.col < b.col + b.width && b.col < a.col + a.width;
  const vertical = a.row < b.row + b.height && b.row < a.row + a.height;
  return horizontal && vertical;
}

function normalizeLayout(input: Partial<TileLayout> | undefined, defaultRow: number): TileLayout {
  const layout: TileLayout = {
    row: input?.row ?? defaultRow,
    col: input?.col ?? 0,
    width: input?.width ?? 4,
    height: input?.height ?? 2,
  };
  for (const [label, value] of Object.entries(layout)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new DefinitionError(`tile layout ${label} must be a non-negative integer`);
    }
  }
  if (layout.width < 1 || layout.width > GRID_COLUMNS) {
    throw new DefinitionError(`tile width must be between 1 and ${GRID_COLUMNS}`);
  }
  if (layout.height < 1 || layout.height > 12) {
    throw new DefinitionError("tile height must be between 1 and 12");
  }
  return layout;
}

function normalizeWindow(input?: Partial<TileWindow>): TileWindow {
  const grain = input?.grain ?? "month";
  if (!isTimeGrain(grain)) throw new DefinitionError(`unknown tile window grain '${grain}'`);
  const trailingPeriods = input?.trailingPeriods ?? 12;
  if (!Number.isInteger(trailingPeriods) || trailingPeriods < 1 || trailingPeriods > 400) {
    throw new DefinitionError("tile window trailingPeriods must be an integer 1..400");
  }
  return { grain, trailingPeriods, groupByPeriod: input?.groupByPeriod ?? true };
}
