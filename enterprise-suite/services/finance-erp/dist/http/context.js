import { createTenantContext } from "@enterprise-suite/shared-kernel";
/**
 * Builds the tenant context from the suite's standard identity headers:
 *   x-tenant-id (required), x-user-id (required), x-roles (csv, optional).
 * Upstream identity-access is expected to have validated the JWT already.
 */
export function extractTenantContext(headers) {
    const single = (name) => {
        const value = headers[name];
        return Array.isArray(value) ? value[0] : value;
    };
    const tenant = single("x-tenant-id");
    const user = single("x-user-id");
    if (!tenant || tenant.trim().length === 0) {
        throw new Error("x-tenant-id header is required");
    }
    if (!user || user.trim().length === 0) {
        throw new Error("x-user-id header is required");
    }
    const roles = (single("x-roles") ?? "viewer")
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
    return createTenantContext(tenant.trim(), user.trim(), roles);
}
//# sourceMappingURL=context.js.map