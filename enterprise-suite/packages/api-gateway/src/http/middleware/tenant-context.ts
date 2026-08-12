import {
  createTenantContext,
  brand,
  verifySuiteToken,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { TenantRequiredError, UnauthenticatedError } from "../../domain/errors.js";
import { ANONYMOUS_CONTEXT_TENANT, type HttpRequest, type Middleware } from "../router.js";

/**
 * Authenticated tenant middleware.
 *
 * A signed suite token is authoritative. Legacy tenant headers are accepted
 * only when `trustHeaders` is explicitly enabled for local service-to-service
 * demos. Probes and documentation endpoints opt out through `anonymousPaths`.
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
  /** HS256 key used to verify bearer/cookie suite tokens. */
  readonly authSecret?: string;
  /** Explicit development-only fallback to x-tenant-id/x-user-id/x-roles. */
  readonly trustHeaders?: boolean;
  /** Cookie names checked after Authorization. */
  readonly tokenCookieNames?: readonly string[];
  /** Injectable time source for deterministic token-expiry tests. */
  readonly nowMs?: () => number;
}

const DEFAULT_ANONYMOUS = ["/health", "/health/*", "/ready", "/openapi.json", "/docs", "/docs/*"];
const DEFAULT_TENANT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const DEFAULT_TOKEN_COOKIES = ["suite_auth", "portal_session"];

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
  const trustHeaders = options.trustHeaders ?? false;
  const tokenCookieNames = options.tokenCookieNames ?? DEFAULT_TOKEN_COOKIES;
  const nowMs = options.nowMs ?? (() => Date.now());

  return async (req, next) => {
    const anonymous = isAnonymousPath(req.path, anonymousPaths);
    const token = requestToken(req.headers, tokenCookieNames);
    let tenant: string | undefined;
    let user: string | undefined;
    let roles: readonly string[] = [];

    if (token) {
      if (!options.authSecret) {
        throw new UnauthenticatedError("Suite token verification is not configured");
      }
      try {
        const claims = verifySuiteToken(token, options.authSecret, { nowMs: nowMs() });
        tenant = claims.tenantId;
        user = claims.userId;
        roles = claims.roles;
        req.locals["authSource"] = "token";
      } catch (error) {
        if (error instanceof Error) throw new UnauthenticatedError(error.message);
        throw new UnauthenticatedError("Invalid suite token");
      }
    } else if (trustHeaders) {
      tenant = req.headers[tenantHeader]?.trim();
      user = req.headers[userHeader]?.trim();
      roles = parseRoles(req.headers[rolesHeader], defaultRoles);
      req.locals["authSource"] = tenant || user ? "headers" : "anonymous";
    } else {
      req.locals["authSource"] = "anonymous";
    }

    if (!tenant) {
      if (!anonymous) {
        if (!trustHeaders) throw new UnauthenticatedError("Bearer suite token is required");
        throw new TenantRequiredError(tenantHeader);
      }
      req.ctx = withRequestId(
        createTenantContext(ANONYMOUS_CONTEXT_TENANT, ANONYMOUS_CONTEXT_TENANT, [...roles]),
        req.headers[requestIdHeader],
      );
    } else {
      if (!tenantPattern.test(tenant)) {
        if (token) throw new UnauthenticatedError("Suite token contains a malformed tenantId");
        throw new TenantRequiredError(`${tenantHeader} (malformed: "${tenant}")`);
      }
      if (!user && requireUser && !anonymous) {
        throw new UnauthenticatedError(token ? "Suite token is missing userId" : `${userHeader} header is required`);
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

function requestToken(
  headers: Readonly<Record<string, string | undefined>>,
  cookieNames: readonly string[],
): string | undefined {
  const authorization = headers.authorization?.trim();
  if (authorization && /^Bearer(?:\s|$)/i.test(authorization)) {
    const token = authorization.replace(/^Bearer\s*/i, "").trim();
    if (!token) throw new UnauthenticatedError("Bearer suite token is empty");
    return token;
  }

  const wanted = new Set(cookieNames);
  for (const part of (headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!wanted.has(name)) continue;
    const value = part.slice(separator + 1).trim();
    if (value) return value;
  }
  return undefined;
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
