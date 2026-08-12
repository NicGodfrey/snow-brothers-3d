import { DomainError, NotFoundError, type Money } from "@enterprise-suite/shared-kernel";
import type { ApiClients } from "../api/index.js";
import type { ListQuery, RowLike } from "../api/types.js";
import { formatMoney } from "../domain/kpi.js";
import {
  findNavItem,
  navItemPath,
  type ModuleDescriptor,
  type ModuleKey,
  type NavItem,
} from "../domain/module.js";
import { getModule, tryGetModule } from "../domain/module-catalog.js";
import { isEntitled, type PortalSession } from "../domain/session.js";

/**
 * Turns "module + nav item + query" into a rendered list view.
 *
 * Columns are inferred from the rows rather than declared per screen: the
 * upstream DTOs are the contract, and a new field shows up in the portal
 * without a shell change. Money is formatted once, here.
 */

export type CellKind = "text" | "number" | "money" | "percent" | "date" | "boolean";

export interface Column {
  readonly key: string;
  readonly label: string;
  readonly kind: CellKind;
  readonly align: "left" | "right";
}

export interface Cell {
  readonly kind: CellKind;
  readonly text: string;
}

export interface ListRow {
  readonly id: string;
  readonly cells: readonly Cell[];
}

export interface ListViewModel {
  readonly module: ModuleKey;
  readonly moduleLabel: string;
  readonly item: NavItem;
  readonly path: string;
  readonly columns: readonly Column[];
  readonly rows: readonly ListRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly query: ListQuery;
  readonly canWrite: boolean;
  readonly actions: readonly { key: string; label: string; slug: string }[];
}

const HIDDEN_COLUMNS = new Set(["id"]);
const MAX_COLUMNS = 8;

export class ModuleService {
  constructor(private readonly clients: ApiClients) {}

  resolve(session: PortalSession, moduleKey: string): ModuleDescriptor {
    const module = tryGetModule(moduleKey);
    if (!module) throw new NotFoundError("module", moduleKey);
    if (!isEntitled(session, module.key)) {
      throw new NotFoundError("module", moduleKey);
    }
    session.permissions.require(module.permission);
    return module;
  }

  async loadList(
    session: PortalSession,
    moduleKey: string,
    slug: string,
    query: ListQuery = {},
  ): Promise<ListViewModel> {
    const module = this.resolve(session, moduleKey);
    const item = findNavItem(module, slug);
    if (!item) throw new NotFoundError("view", `${moduleKey}/${slug}`);
    session.permissions.require(item.permission);

    const page = await this.clients.byModule[module.key].list(item.resource, query);
    const locale = session.tenant.defaultLocale;
    const columns = inferColumns(page.items);

    return {
      module: module.key,
      moduleLabel: module.label,
      item,
      path: navItemPath(module, item),
      columns,
      rows: page.items.map((row) => ({
        id: String(row.id),
        cells: columns.map((column) => formatCell(row[column.key], column.kind, locale)),
      })),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      query,
      canWrite: session.permissions.has(`${module.key}:write`),
      actions: module.actions
        .filter((action) => session.permissions.has(action.permission))
        .map((action) => ({ key: action.key, label: action.label, slug: action.slug })),
    };
  }

  /** Dispatches a declared module action; the shell never invents endpoints. */
  async runAction(
    session: PortalSession,
    moduleKey: string,
    actionKey: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const module = this.resolve(session, moduleKey);
    const action = module.actions.find((a) => a.key === actionKey);
    if (!action) throw new NotFoundError("action", actionKey);
    session.permissions.require(action.permission);
    if (body !== undefined && body !== null && typeof body !== "object") {
      throw new DomainError("Action payload must be an object", "VALIDATION", 400);
    }
    return this.clients.byModule[module.key].command(action.slug, body ?? {}, idempotencyKey);
  }

  describe(moduleKey: ModuleKey): ModuleDescriptor {
    return getModule(moduleKey);
  }
}

export function inferColumns(rows: readonly RowLike[]): readonly Column[] {
  const first = rows[0];
  if (!first) return [];
  const columns: Column[] = [];
  for (const key of Object.keys(first)) {
    if (HIDDEN_COLUMNS.has(key)) continue;
    const value = first[key];
    if (Array.isArray(value)) continue;
    const kind = inferKind(key, value);
    columns.push({
      key,
      label: humanize(key),
      kind,
      align: kind === "money" || kind === "number" || kind === "percent" ? "right" : "left",
    });
    if (columns.length >= MAX_COLUMNS) break;
  }
  return columns;
}

function inferKind(key: string, value: unknown): CellKind {
  if (isMoney(value)) return "money";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return /(pct|rate|utilisation|utilization)$/i.test(key) ? "percent" : "number";
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  return "text";
}

function formatCell(value: unknown, kind: CellKind, locale: string): Cell {
  if (value === undefined || value === null) return { kind, text: "—" };
  switch (kind) {
    case "money":
      return { kind, text: formatMoney(value as Money, locale) };
    case "percent":
      return { kind, text: `${(Number(value) * 100).toFixed(1)}%` };
    case "number":
      return { kind, text: new Intl.NumberFormat(locale).format(Number(value)) };
    case "boolean":
      return { kind, text: value ? "yes" : "no" };
    case "date":
      return { kind, text: String(value).slice(0, 10) };
    default:
      return { kind, text: String(value) };
  }
}

function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof (value as Money).amountMinor === "number"
  );
}

export function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
