import {
  DomainError,
  ForbiddenError,
  createTenantContext,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";

/**
 * Tenant identity comes from gateway-verified headers (JWT-ish contract of
 * the suite): x-tenant-id, x-user-id, x-roles (comma separated).
 */
export function tenantContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): TenantContext {
  const tenant = headerValue(headers["x-tenant-id"]);
  const user = headerValue(headers["x-user-id"]);
  if (!tenant || !user) {
    throw new DomainError(
      "Missing x-tenant-id / x-user-id headers",
      "UNAUTHENTICATED",
      401,
    );
  }
  const roles = (headerValue(headers["x-roles"]) ?? "viewer")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return createTenantContext(tenant, user, roles);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const WRITE_ROLES = new Set(["inventory.write", "admin"]);

/** Mutating endpoints require an inventory write role; admin always passes. */
export function requireWriteRole(ctx: TenantContext): void {
  const allowed = ctx.roles.some((role) => WRITE_ROLES.has(String(role)));
  if (!allowed) {
    throw new ForbiddenError(
      "Requires role inventory.write (or admin)",
    );
  }
}
