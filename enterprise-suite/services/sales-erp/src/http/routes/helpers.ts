import { brand, type Page, type Ulid } from "../../kernel/index.js";

export function idParam(value: string): Ulid {
  return brand<string, "Ulid">(value);
}

export function intQuery(query: URLSearchParams, name: string): number | undefined {
  const raw = query.get(name);
  if (raw === null) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function pageQuery(query: URLSearchParams): { page?: number; pageSize?: number } {
  return { page: intQuery(query, "page"), pageSize: intQuery(query, "pageSize") };
}

export function pageToJSON<T>(page: Page<T>, serialize: (item: T) => unknown): unknown {
  return {
    items: page.items.map(serialize),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    nextCursor: page.nextCursor ?? null,
  };
}
