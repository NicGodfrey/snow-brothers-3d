import { type TenantContext } from "@enterprise-suite/shared-kernel";
/**
 * Builds the tenant context from the suite's standard identity headers:
 *   x-tenant-id (required), x-user-id (required), x-roles (csv, optional).
 * Upstream identity-access is expected to have validated the JWT already.
 */
export declare function extractTenantContext(headers: Record<string, string | string[] | undefined>): TenantContext;
//# sourceMappingURL=context.d.ts.map