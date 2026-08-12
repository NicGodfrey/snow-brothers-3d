import type { IncomingMessage } from "node:http";
import { DomainError, createTenantContext, type TenantContext } from "../kernel/index.js";

export class UnauthorizedError extends DomainError {
  constructor(message: string) {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
  }
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * JWT-ish tenant context per ARCHITECTURE.md: identity arrives via
 * x-tenant-id / x-user-id / x-roles headers (roles comma-separated).
 */
export function contextFromRequest(req: IncomingMessage): TenantContext {
  const tenant = headerValue(req, "x-tenant-id")?.trim();
  if (!tenant) throw new UnauthorizedError("Missing x-tenant-id header");
  const user = headerValue(req, "x-user-id")?.trim() || "anonymous";
  const rolesHeader = headerValue(req, "x-roles") ?? "";
  const roles = rolesHeader
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return createTenantContext(tenant, user, roles.length > 0 ? roles : ["viewer"]);
}
