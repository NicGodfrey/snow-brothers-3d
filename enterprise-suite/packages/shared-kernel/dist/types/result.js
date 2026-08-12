export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });
export function mapResult(r, fn) {
    return r.ok ? ok(fn(r.value)) : r;
}
export function unwrapOr(r, fallback) {
    return r.ok ? r.value : fallback;
}
//# sourceMappingURL=result.js.map