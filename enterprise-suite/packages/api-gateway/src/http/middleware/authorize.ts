import { ForbiddenError } from "@enterprise-suite/shared-kernel";
import type { PermissionResolver } from "../../domain/policy.js";
import type { HttpRequest, Middleware } from "../router.js";

/**
 * Coarse role/permission checks for routers that are not the gateway itself.
 * Handlers stay free of authorization boilerplate: the router names a route,
 * this middleware looks up the requirement for that name.
 */

export interface RouteRequirement {
  readonly anyOfRoles?: readonly string[];
  readonly allOfPermissions?: readonly string[];
}

export function authorize(options: {
  /** Keyed by route name (the third argument to `router.get(...)`). */
  requirements: Readonly<Record<string, RouteRequirement>>;
  resolver?: PermissionResolver;
  /** Route names that skip the check entirely. */
  publicRoutes?: readonly string[];
  /** Requirement applied when a route has no explicit entry. */
  fallback?: RouteRequirement;
}): Middleware {
  const publicRoutes = new Set(options.publicRoutes ?? []);

  return async (req, next) => {
    const routeName = req.locals["routeName"] as string | undefined;
    if (routeName === undefined || publicRoutes.has(routeName)) return next();
    const requirement = options.requirements[routeName] ?? options.fallback;
    if (requirement) assertAllowed(req, requirement, options.resolver);
    return next();
  };
}

/** Imperative check usable directly inside a handler. */
export function assertAllowed(
  req: HttpRequest,
  requirement: RouteRequirement,
  resolver?: PermissionResolver,
): void {
  const roles = req.ctx.roles.map(String);
  const anyOf = requirement.anyOfRoles ?? [];
  if (anyOf.length > 0 && !roles.some((role) => anyOf.includes(role))) {
    throw new ForbiddenError(`requires one of the roles [${anyOf.join(", ")}]`);
  }
  const needed = requirement.allOfPermissions ?? [];
  if (needed.length === 0) return;
  const granted = new Set<string>();
  for (const role of roles) {
    for (const permission of resolver?.permissionsFor(role) ?? []) granted.add(permission);
  }
  const missing = needed.filter((p) => !granted.has(p) && !granted.has("*"));
  if (missing.length > 0) {
    throw new ForbiddenError(`missing permissions [${missing.join(", ")}]`);
  }
}
