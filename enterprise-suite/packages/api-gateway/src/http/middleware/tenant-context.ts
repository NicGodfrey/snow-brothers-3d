import { createTenantContext, brand, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { TenantRequiredError, UnauthenticatedError } from "../../domain/errors.js";
import { ANONYMOUS_CONTEXT_TENANT, type HttpRequest, type Middleware } from "../router.js";

/**
 * Tenant header middleware.
 *
 * Every request that touches tenant data must carry `x-tenant-id`; the acting
 * principal comes from `x-user-id` and coarse roles from `x-roles`. Probes and
 * documentation endpoints opt out through `anonymousPaths`. The resolved
 * context is also echoed back as `x-request-id` so a caller can correlate a
 * failure with gateway and upstream logs.
 */

export interface TenantMiddlewareOptions {
  readonly tenantHeader?: string;
  readonly userHeader?: string;
  readonly rolesHeader?: string;
  readonly requestIdHeader?: string;
  /** Exact paths or prefixes ending in `*` that may run without a tenant. */
  readonly anonymousPaths?: readonly string[];
  /** Require `x-user-id` in addition to the tenant. Defaults to true. */
  readonly requireUser?: boolean;
  /** Roles applied when the caller sends none. */
  readonly defaultRoles?: readonly string[];
  /** Rejects tenant ids that do not match this pattern. */
  readonly tenantPattern?: RegExp;
}

const DEFAULT_ANONYMOUS = ["/health", "/health/*", "/ready", "/openapi.json", "/docs", "/docs/*"];
const DEFAULT_TENANT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;

export function isAnonymousPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
    if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
    return path === pattern;
  });
}

export function tenantContextMiddleware(options: TenantMiddlewareOptions = {}): Middleware {
  const tenantHeader = options.tenantHeader ?? "x-tenant-id";
  const userHeader = options.userHeader ?? "x-user-id";
  const rolesHeader = options.rolesHeader ?? "x-roles";
  const requestIdHeader = options.requestIdHeader ?? "x-request-id";
  const anonymousPaths = options.anonymousPaths ?? DEFAULT_ANONYMOUS;
  const requireUser = options.requireUser ?? true;
  const defaultRoles = options.defaultRoles ?? ["viewer"];
  const tenantPattern = options.tenantPattern ?? DEFAULT_TENANT_PATTERN;

  return async (req, next) => {
    const tenant = req.headers[tenantHeader]?.trim();
    const user = req.headers[userHeader]?.trim();
    const roles = parseRoles(req.headers[rolesHeader], defaultRoles);
    const anonymous = isAnonymousPath(req.path, anonymousPaths);

    if (!tenant) {
      if (!anonymous) throw new TenantRequiredError(tenantHeader);
      req.ctx = withRequestId(
        createTenantContext(ANONYMOUS_CONTEXT_TENANT, ANONYMOUS_CONTEXT_TENANT, [...roles]),
        req.headers[requestIdHeader],
      );
    } else {
      if (!tenantPattern.test(tenant)) {
        throw new TenantRequiredError(`${tenantHeader} (malformed: "${tenant}")`);
      }
      if (!user && requireUser && !anonymous) {
        throw new UnauthenticatedError(`${userHeader} header is required`);
      }
      req.ctx = withRequestId(
        createTenantContext(tenant, user ?? ANONYMOUS_CONTEXT_TENANT, [...roles]),
        req.headers[requestIdHeader],
      );
    }

    req.locals["tenantId"] = String(req.ctx.tenantId);
    req.locals["anonymous"] = anonymous && !tenant;

    const response = await next();
    return {
      ...response,
      headers: {
        ...(response.headers ?? {}),
        [requestIdHeader]: String(req.ctx.requestId),
        "x-tenant-id": String(req.ctx.tenantId),
      },
    };
  };
}

export function parseRoles(
  header: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  const parsed = (header ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}

/** Honours an inbound correlation id instead of minting a fresh one. */
function withRequestId(ctx: TenantContext, inbound: string | undefined): TenantContext {
  if (!inbound || inbound.trim().length === 0) return ctx;
  return { ...ctx, requestId: brand<string, "Ulid">(inbound.trim()) as Ulid };
}

/** Convenience for handlers that must never see an anonymous caller. */
export function requireTenant(req: HttpRequest): TenantContext {
  if (String(req.ctx.tenantId) === ANONYMOUS_CONTEXT_TENANT) {
    throw new TenantRequiredError();
  }
  return req.ctx;
}
