import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { KpiValue } from "../domain/kpi.js";
import type { ApiClient } from "./client.js";
import { ApiError, type ApiPage, type ListQuery, type RequestOptions, type RowLike } from "./types.js";

/**
 * The contract the shell relies on for *every* module, on top of each client's
 * hand-written typed methods. The dashboard, the generic list view and the
 * command palette are written against this interface only, so a seventh module
 * needs no changes in the shell.
 */

export interface ModuleSummaryDto {
  readonly module: ModuleKey;
  readonly metrics: Readonly<Record<string, KpiValue>>;
  /** Change versus the previous comparable window, keyed like `metrics`. */
  readonly deltas?: Readonly<Record<string, number>>;
  readonly asOf: string;
}

export interface SearchHit {
  readonly module: ModuleKey;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  /** Portal path that opens the record's list view. */
  readonly path: string;
}

export interface ModuleApi {
  readonly module: ModuleKey;
  readonly service: string;
  summary(options?: RequestOptions): Promise<ModuleSummaryDto>;
  /** Resource keys come from the module descriptor's nav items. */
  list(resource: string, query?: ListQuery, options?: RequestOptions): Promise<ApiPage<RowLike>>;
  search(term: string, limit?: number, options?: RequestOptions): Promise<readonly SearchHit[]>;
  /** Generic command dispatch used by declared module actions. */
  command(slug: string, body: unknown, idempotencyKey?: string): Promise<unknown>;
}

/**
 * Shared implementation of the three shell-facing endpoints. Module clients
 * extend it and add their own typed, hand-written methods.
 */
export abstract class BaseModuleApi implements ModuleApi {
  abstract readonly module: ModuleKey;

  protected constructor(protected readonly http: ApiClient) {}

  get service(): string {
    return this.http.service;
  }

  summary(options?: RequestOptions): Promise<ModuleSummaryDto> {
    return this.http.get<ModuleSummaryDto>("/summary", options);
  }

  list(resource: string, query?: ListQuery, options?: RequestOptions): Promise<ApiPage<RowLike>> {
    return this.http.get<ApiPage<RowLike>>(`/${resource}`, { ...options, query: { ...query } });
  }

  search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    return this.http.get<readonly SearchHit[]>("/search", {
      ...options,
      query: { q: term, limit },
    });
  }

  command(slug: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    return this.http.post<unknown>(`/${slug}`, { body, idempotencyKey });
  }
}

export function count(value: number): KpiValue {
  return { kind: "count", value };
}

export function percent(value: number): KpiValue {
  return { kind: "percent", value };
}

export function days(value: number): KpiValue {
  return { kind: "days", value };
}

export function moneyValue(value: Money): KpiValue {
  return { kind: "money", value };
}

/**
 * Helpers for module clients that compose their shell contract (`summary`,
 * `search`, `list`) from the services' real list endpoints, instead of
 * expecting each backend to expose synthetic `/summary` and `/search` routes.
 */

/** Accepts bare arrays and `{ items | data | results }` envelopes alike. */
export function asPage<T>(body: unknown): ApiPage<T> {
  if (Array.isArray(body)) {
    return { items: body as T[], page: 1, pageSize: body.length, total: body.length };
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const items = (record.items ?? record.data ?? record.results ?? []) as T[];
    const list = Array.isArray(items) ? items : [];
    return {
      items: list,
      page: Number(record.page ?? 1),
      pageSize: Number(record.pageSize ?? list.length),
      total: Number(record.total ?? list.length),
      nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : undefined,
    };
  }
  return { items: [], page: 1, pageSize: 0, total: 0 };
}

export function emptyPage<T>(): ApiPage<T> {
  return { items: [], page: 1, pageSize: 0, total: 0 };
}

/**
 * For optional sources in a composed summary: a missing route (404) means the
 * gateway does not expose the resource yet and is tolerated; anything else
 * (403, 5xx, timeouts) still fails the module so the tile reports honestly.
 */
export function undefinedOnNotFound(error: unknown): undefined {
  if (error instanceof ApiError && error.kind === "not-found") return undefined;
  throw error;
}

/** Same policy as {@link undefinedOnNotFound}, for sources folded into search. */
export function emptyPageOnNotFound<T>(error: unknown): ApiPage<T> {
  if (error instanceof ApiError && error.kind === "not-found") return emptyPage<T>();
  throw error;
}

function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { amountMinor?: unknown }).amountMinor === "number" &&
    typeof (value as { currency?: unknown }).currency === "string"
  );
}

/** Sums Money-ish values; rows without a usable value are skipped. */
export function sumMoney(values: ReadonlyArray<unknown>): Money | undefined {
  let total = 0;
  let currency: string | undefined;
  for (const value of values) {
    if (!isMoney(value)) continue;
    currency ??= value.currency;
    if (value.currency === currency) total += value.amountMinor;
  }
  return currency === undefined ? undefined : ({ amountMinor: total, currency } as Money);
}

/** Lower-cased status, tolerant of rows from services with divergent DTOs. */
export function statusOf(row: unknown): string {
  const value = (row as { status?: unknown } | null)?.status;
  return typeof value === "string" ? value.toLowerCase() : "";
}

export interface SearchSource {
  /** Portal nav slug the hit links to, e.g. `receivables`. */
  readonly slug: string;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly fields: readonly string[];
  readonly title: (row: Record<string, unknown>) => string;
  readonly subtitle: (row: Record<string, unknown>) => string;
}

/** Keeps the typed row accessors while erasing the row type for composition. */
export function hitSource<T extends { readonly id: string }>(input: {
  readonly slug: string;
  readonly rows: readonly T[];
  readonly fields: ReadonlyArray<keyof T & string>;
  readonly title: (row: T) => string;
  readonly subtitle: (row: T) => string;
}): SearchSource {
  return {
    slug: input.slug,
    rows: input.rows as unknown as ReadonlyArray<Record<string, unknown>>,
    fields: input.fields,
    title: (row) => input.title(row as unknown as T),
    subtitle: (row) => input.subtitle(row as unknown as T),
  };
}

/** Client-side counterpart of a `/search` endpoint over already-listed rows. */
export function composeHits(
  module: ModuleKey,
  term: string,
  limit: number,
  sources: ReadonlyArray<SearchSource>,
): SearchHit[] {
  const q = term.trim().toLowerCase();
  if (q.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const source of sources) {
    for (const row of source.rows) {
      const matches = source.fields.some((field) =>
        String(row[field] ?? "").toLowerCase().includes(q),
      );
      if (!matches) continue;
      hits.push({
        module,
        id: String(row.id ?? ""),
        title: source.title(row),
        subtitle: source.subtitle(row),
        path: `/m/${module}/${source.slug}?q=${encodeURIComponent(q)}`,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
