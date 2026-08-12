import type { IncomingHttpHeaders } from "node:http";
import { type TenantContext } from "@enterprise-suite/shared-kernel";
/**
 * Tenant context extraction per the architecture's identity convention:
 * `x-tenant-id`, `x-user-id` and comma-separated `x-roles` headers. The API
 * gateway is responsible for verifying the upstream JWT; services trust the
 * propagated headers.
 */
export declare function extractTenantContext(headers: IncomingHttpHeaders, options?: {
    optional?: boolean;
}): TenantContext;
//# sourceMappingURL=context.d.ts.map