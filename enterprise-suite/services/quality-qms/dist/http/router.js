import { createTenantContext, DomainError, } from "@enterprise-suite/shared-kernel";
const MAX_BODY_BYTES = 1024 * 1024;
export class Router {
    routes = [];
    register(method, pattern, handler) {
        const segments = pattern.split("/").filter(Boolean);
        this.routes.push({ method, segments, handler });
    }
    get(pattern, handler) { this.register("GET", pattern, handler); }
    post(pattern, handler) { this.register("POST", pattern, handler); }
    put(pattern, handler) { this.register("PUT", pattern, handler); }
    delete(pattern, handler) { this.register("DELETE", pattern, handler); }
    match(method, path) {
        const pathSegments = path.split("/").filter(Boolean);
        for (const route of this.routes) {
            if (route.method !== method)
                continue;
            if (route.segments.length !== pathSegments.length)
                continue;
            const params = {};
            let matched = true;
            for (let i = 0; i < route.segments.length; i++) {
                const pattern = route.segments[i];
                const actual = pathSegments[i];
                if (pattern.startsWith(":")) {
                    params[pattern.slice(1)] = decodeURIComponent(actual);
                }
                else if (pattern !== actual) {
                    matched = false;
                    break;
                }
            }
            if (matched)
                return { route, params };
        }
        return null;
    }
    async dispatch(req, res) {
        try {
            const url = new URL(req.url ?? "/", "http://localhost");
            const matched = this.match(req.method ?? "GET", url.pathname);
            if (!matched) {
                sendJson(res, 404, { error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${url.pathname}` } });
                return;
            }
            // Health check is unauthenticated; everything else needs tenant headers.
            const isHealth = url.pathname === "/health";
            const tenantHeader = header(req, "x-tenant-id");
            const userHeader = header(req, "x-user-id");
            if (!isHealth && (!tenantHeader || !userHeader)) {
                sendJson(res, 401, {
                    error: { code: "MISSING_TENANT_CONTEXT", message: "x-tenant-id and x-user-id headers are required" },
                });
                return;
            }
            const roles = (header(req, "x-roles") ?? "viewer")
                .split(",")
                .map((r) => r.trim())
                .filter(Boolean);
            const ctx = createTenantContext(tenantHeader ?? "system", userHeader ?? "system", roles);
            const body = await readJsonBody(req);
            const result = await matched.route.handler({
                ctx,
                params: matched.params,
                query: url.searchParams,
                body,
            });
            sendJson(res, result.status ?? 200, result.body);
        }
        catch (error) {
            if (error instanceof DomainError) {
                sendJson(res, error.status, {
                    error: { code: error.code, message: error.message, details: error.details },
                });
                return;
            }
            sendJson(res, 500, {
                error: { code: "INTERNAL", message: error instanceof Error ? error.message : "Unknown error" },
            });
        }
    }
}
function header(req, name) {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
}
async function readJsonBody(req) {
    if (req.method === "GET" || req.method === "DELETE")
        return undefined;
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = chunk;
        size += buf.length;
        if (size > MAX_BODY_BYTES) {
            throw new DomainError("Request body too large", "PAYLOAD_TOO_LARGE", 413);
        }
        chunks.push(buf);
    }
    if (chunks.length === 0)
        return undefined;
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        throw new DomainError("Request body is not valid JSON", "INVALID_JSON", 400);
    }
}
export function sendJson(res, status, body) {
    const payload = JSON.stringify(body ?? null);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
}
//# sourceMappingURL=router.js.map