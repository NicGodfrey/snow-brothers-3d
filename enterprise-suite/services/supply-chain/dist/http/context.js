import { createTenantContext, DomainError, } from "@enterprise-suite/shared-kernel";
/**
 * Tenant context extraction per the architecture's identity convention:
 * `x-tenant-id`, `x-user-id` and comma-separated `x-roles` headers. The API
 * gateway is responsible for verifying the upstream JWT; services trust the
 * propagated headers.
 */
export function extractTenantContext(headers, options) {
    const tenant = headerValue(headers, "x-tenant-id");
    const user = headerValue(headers, "x-user-id");
    if (!tenant) {
        if (options?.optional)
            return createTenantContext("anonymous", "anonymous", []);
        throw new DomainError("Missing x-tenant-id header", "UNAUTHENTICATED", 401);
    }
    const roles = (headerValue(headers, "x-roles") ?? "viewer")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
    return createTenantContext(tenant, user ?? "system", roles);
}
function headerValue(headers, name) {
    const value = headers[name];
    if (Array.isArray(value))
        return value[0]?.trim() || undefined;
    return value?.trim() || undefined;
}
//# sourceMappingURL=context.js.map