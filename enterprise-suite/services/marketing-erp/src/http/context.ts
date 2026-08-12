import type { IncomingHttpHeaders } from "node:http";
import {
  createTenantContext,
  DomainError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Builds the tenant context from the gateway-injected identity headers
 * (`x-tenant-id`, `x-user-id`, `x-roles`). The gateway owns authentication;
 * this service only refuses requests that arrive without an identity.
 */
export function tenantContextFromHeaders(headers: IncomingHttpHeaders): TenantContext {
  const tenant = headerValue(headers, "x-tenant-id");
  const user = headerValue(headers, "x-user-id");
  if (!tenant || tenant.trim() === "") {
    throw new DomainError("Missing x-tenant-id header", "MISSING_TENANT", 401);
  }
  if (!user || user.trim() === "") {
    throw new DomainError("Missing x-user-id header", "MISSING_USER", 401);
  }
  const roles = (headerValue(headers, "x-roles") ?? "viewer")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return createTenantContext(tenant.trim(), user.trim(), roles);
}
