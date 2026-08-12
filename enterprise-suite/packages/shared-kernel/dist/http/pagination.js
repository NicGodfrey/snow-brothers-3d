export function normalizePage(input) {
    const page = Math.max(1, input?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, input?.pageSize ?? 20));
    return { page, pageSize, cursor: input?.cursor };
}
export function paginate(items, req) {
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
//# sourceMappingURL=pagination.js.map