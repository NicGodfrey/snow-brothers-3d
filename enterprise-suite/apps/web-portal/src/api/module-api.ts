import type { ModuleKey } from "../domain/module.js";
import type { KpiValue } from "../domain/kpi.js";
import type { ApiClient } from "./client.js";
import type { ApiPage, ListQuery, RequestOptions, RowLike } from "./types.js";

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
