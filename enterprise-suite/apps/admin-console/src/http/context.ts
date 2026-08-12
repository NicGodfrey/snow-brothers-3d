import type { HttpRequest, Middleware } from "@enterprise-suite/api-gateway";
import { ForbiddenError, tenantId as toTenantId } from "@enterprise-suite/shared-kernel";
import type { CommandContext } from "../application/ports.js";
import type { Permission } from "../domain/role.js";
import type { AdminContainer } from "../infrastructure/container.js";

/**
 * Request context and authorization.
 *
 * The gateway hands over a `TenantContext` parsed from headers. Turning that
 * into a `CommandContext` is trivial; authorizing it is not, because roles in
 * this app are tenant-scoped records with inheritance rather than opaque
 * strings. `requirePermissions` resolves the caller's role codes against the
 * tenant's own role definitions, which is why it lives here and not in the
 * gateway's generic middleware.
 */

/** Cross-tenant operators; recognised before any tenant role lookup. */
export const PLATFORM_ROLES = new Set(["platform-admin"]);

export function commandContext(req: HttpRequest): CommandContext {
  return {
    tenantId: toTenantId(String(req.ctx.tenantId)),
    actor: String(req.ctx.userId),
    roles: req.ctx.roles.map(String),
    requestId: String(req.ctx.requestId),
    sourceIp: req.clientIp,
  };
}

export function isPlatformOperator(req: HttpRequest): boolean {
  return req.ctx.roles.map(String).some((role) => PLATFORM_ROLES.has(role));
}

export function grantedPermissions(
  container: AdminContainer,
  req: HttpRequest,
): Set<Permission> {
  if (isPlatformOperator(req)) return new Set<Permission>(["*"]);
  const tenantId = toTenantId(String(req.ctx.tenantId));
  const known = container.repos.tenants.byKey(String(req.ctx.tenantId));
  if (!known) return new Set<Permission>();
  return container.services.role.permissionsForUser(tenantId, req.ctx.roles.map(String));
}

/**
 * Guards routes by name. Requirements are declared once next to the router so
 * the permission surface of the whole app can be read in one place.
 */
export function requirePermissions(
  container: AdminContainer,
  requirements: Readonly<Record<string, readonly Permission[]>>,
  options: { publicRoutes?: readonly string[] } = {},
): Middleware {
  const publicRoutes = new Set(options.publicRoutes ?? []);

  return async (req, next) => {
    const routeName = req.locals["routeName"] as string | undefined;
    if (!routeName || publicRoutes.has(routeName)) return next();
    const required = requirements[routeName];
    if (!required || required.length === 0) return next();

    const granted = grantedPermissions(container, req);
    const missing = required.filter(
      (permission) => !granted.has(permission) && !granted.has("*"),
    );
    if (missing.length > 0) {
      container.services.audit.recordDenied(commandContext(req), {
        action: routeName,
        resourceType: "Route",
        resourceId: req.path,
        reason: `missing permissions [${missing.join(", ")}]`,
      });
      throw new ForbiddenError(
        `${routeName} requires [${required.join(", ")}]; caller is missing [${missing.join(", ")}]`,
      );
    }
    return next();
  };
}
