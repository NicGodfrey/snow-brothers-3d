export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly nextCursor?: string;
}

export function normalizePage(input?: Partial<PageRequest>): PageRequest {
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input?.pageSize ?? 20));
  return { page, pageSize, cursor: input?.cursor };
}

export function paginate<T>(items: readonly T[], req: PageRequest): Page<T> {
  const start = (req.page - 1) * req.pageSize;
  const slice = items.slice(start, start + req.pageSize);
  return {
    items: slice,
    page: req.page,
    pageSize: req.pageSize,
    total: items.length,
    nextCursor: start + req.pageSize < items.length ? String(req.page + 1) : undefined,
  };
}
