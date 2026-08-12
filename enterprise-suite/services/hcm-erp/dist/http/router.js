import { createTenantContext, DomainError, } from "@enterprise-suite/shared-kernel";
export function jsonOk(body, status = 200) {
    return { status, body };
}
export function created(body) {
    return { status: 201, body };
}
/**
 * Minimal dependency-free router: exact-segment matching with `:param`
 * captures, header-based tenant context, and DomainError → HTTP mapping.
 */
export class Router {
    routes = [];
    register(method, pattern, handler) {
        const segments = pattern.split("/").filter(Boolean);
        this.routes.push({ method: method.toUpperCase(), segments, handler });
    }
    get(pattern, handler) {
        this.register("GET", pattern, handler);
    }
    post(pattern, handler) {
        this.register("POST", pattern, handler);
    }
    patch(pattern, handler) {
        this.register("PATCH", pattern, handler);
    }
    delete(pattern, handler) {
        this.register("DELETE", pattern, handler);
    }
    /**
     * Dispatches a request. `headers` must carry `x-tenant-id` (401 otherwise);
     * `x-user-id` and `x-roles` (comma-separated) are optional.
     */
    async dispatch(input) {
        const url = new URL(input.url, "http://localhost");
        const pathSegments = url.pathname.split("/").filter(Boolean);
        const tenantHeader = headerValue(input.headers["x-tenant-id"]);
        if (input.method.toUpperCase() !== "GET" || pathSegments[0] !== "health") {
            if (!tenantHeader) {
                return {
                    status: 401,
                    body: { error: { code: "MISSING_TENANT", message: "x-tenant-id header is required" } },
                };
            }
        }
        const userHeader = headerValue(input.headers["x-user-id"]) ?? "anonymous";
        const rolesHeader = headerValue(input.headers["x-roles"]);
        const roles = rolesHeader
            ? rolesHeader.split(",").map((r) => r.trim()).filter(Boolean)
            : ["viewer"];
        const ctx = createTenantContext(tenantHeader ?? "unauthenticated", userHeader, roles);
        const match = this.match(input.method.toUpperCase(), pathSegments);
        if (!match) {
            return {
                status: 404,
                body: { error: { code: "ROUTE_NOT_FOUND", message: `No route for ${input.method} ${url.pathname}` } },
            };
        }
        const request = {
            method: input.method.toUpperCase(),
            path: url.pathname,
            params: match.params,
            query: url.searchParams,
            body: input.body,
            ctx,
        };
        try {
            return await match.route.handler(request);
        }
        catch (error) {
            return errorToResponse(error);
        }
    }
    match(method, pathSegments) {
        for (const route of this.routes) {
            if (route.method !== method || route.segments.length !== pathSegments.length)
                continue;
            const params = {};
            let matched = true;
            for (let i = 0; i < route.segments.length; i += 1) {
                const routeSegment = route.segments[i];
                const pathSegment = decodeURIComponent(pathSegments[i]);
                if (routeSegment.startsWith(":")) {
                    params[routeSegment.slice(1)] = pathSegment;
                }
                else if (routeSegment !== pathSegment) {
                    matched = false;
                    break;
                }
            }
            if (matched)
                return { route, params };
        }
        return undefined;
    }
}
function headerValue(value) {
    if (Array.isArray(value))
        return value[0];
    return value || undefined;
}
export function errorToResponse(error) {
    if (error instanceof DomainError) {
        return {
            status: error.status,
            body: { error: { code: error.code, message: error.message, details: error.details } },
        };
    }
    if (error instanceof SyntaxError) {
        return { status: 400, body: { error: { code: "INVALID_JSON", message: error.message } } };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { error: { code: "INTERNAL", message } } };
}
//# sourceMappingURL=router.js.map