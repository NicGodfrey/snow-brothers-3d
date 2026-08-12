import type { TenantContext } from "@enterprise-suite/shared-kernel";
import type { RateLimitPolicy, RouteDefinition } from "./route.js";

/**
 * Authorization and throttling decisions. Both are pure functions over the
 * route definition plus the caller's tenant context so they can be unit
 * tested without an HTTP server, and reused by services that embed the
 * gateway kernel instead of running it at the edge.
 */

export interface AuthDecision {
  readonly allowed: boolean;
  readonly status?: 400 | 401 | 403;
  readonly code?: "TENANT_REQUIRED" | "UNAUTHENTICATED" | "FORBIDDEN";
  readonly reason?: string;
  /** Roles/permissions that would have satisfied the route. */
  readonly required?: readonly string[];
}

const ALLOWED = { allowed: true } as const;

export interface PermissionResolver {
  /** Permissions granted by a role code, e.g. `admin` → `tenant:write`. */
  permissionsFor(role: string): readonly string[];
}

export class StaticPermissionResolver implements PermissionResolver {
  private readonly map: ReadonlyMap<string, readonly string[]>;

  constructor(grants: Readonly<Record<string, readonly string[]>>) {
    this.map = new Map(Object.entries(grants));
  }

  permissionsFor(role: string): readonly string[] {
    return this.map.get(role) ?? [];
  }

  /** Flattened permission set for a caller, expanding the `*` wildcard grant. */
  expand(roles: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const role of roles) {
      for (const permission of this.permissionsFor(role)) out.add(permission);
    }
    return out;
  }
}

export const ANONYMOUS_TENANT = "anonymous";

export function isAnonymous(ctx: TenantContext | undefined): boolean {
  return ctx === undefined || String(ctx.tenantId) === ANONYMOUS_TENANT;
}

export function evaluateAuth(
  route: RouteDefinition,
  ctx: TenantContext | undefined,
  resolver?: PermissionResolver,
): AuthDecision {
  if (route.auth.mode === "anonymous") return ALLOWED;

  if (isAnonymous(ctx)) {
    return {
      allowed: false,
      status: 400,
      code: "TENANT_REQUIRED",
      reason: "x-tenant-id header is required for this route",
    };
  }
  const context = ctx as TenantContext;
  if (String(context.userId) === "" || String(context.userId) === ANONYMOUS_TENANT) {
    return {
      allowed: false,
      status: 401,
      code: "UNAUTHENTICATED",
      reason: "x-user-id header is required for this route",
    };
  }
  const roles = context.roles.map(String);
  const anyOf = route.auth.mode === "roles" ? (route.auth.anyOfRoles ?? []) : [];
  if (anyOf.length > 0 && !roles.some((role) => anyOf.includes(role))) {
    return {
      allowed: false,
      status: 403,
      code: "FORBIDDEN",
      reason: `requires one of the roles [${anyOf.join(", ")}]`,
      required: anyOf,
    };
  }

  const needed = route.auth.allOfPermissions ?? [];
  if (needed.length > 0) {
    const granted = new Set<string>();
    for (const role of roles) {
      for (const permission of resolver?.permissionsFor(role) ?? []) granted.add(permission);
    }
    const missing = needed.filter(
      (permission) => !granted.has(permission) && !granted.has("*"),
    );
    if (missing.length > 0) {
      return {
        allowed: false,
        status: 403,
        code: "FORBIDDEN",
        reason: `missing permissions [${missing.join(", ")}]`,
        required: missing,
      };
    }
  }
  return ALLOWED;
}

/**
 * Throttling bucket identity. Keys are namespaced by strategy so that a route
 * scoped limit can never collide with a tenant-wide one.
 */
export function rateLimitKey(
  policy: RateLimitPolicy,
  route: RouteDefinition,
  ctx: TenantContext | undefined,
): string {
  const tenant = ctx ? String(ctx.tenantId) : ANONYMOUS_TENANT;
  switch (policy.key) {
    case "global":
      return "global";
    case "tenant":
      return `tenant:${tenant}`;
    case "tenant-user":
      return `tenant-user:${tenant}:${ctx ? String(ctx.userId) : ANONYMOUS_TENANT}`;
    case "tenant-route":
      return `tenant-route:${tenant}:${route.id}`;
    default: {
      const exhaustive: never = policy.key;
      return exhaustive;
    }
  }
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch millis when the current window rolls over. */
  readonly resetAtMs: number;
  readonly retryAfterMs: number;
}

/** Standard `x-ratelimit-*` headers plus `retry-after` when throttled. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(Math.max(0, decision.remaining)),
    "x-ratelimit-reset": String(Math.ceil(decision.resetAtMs / 1000)),
  };
  if (!decision.allowed) {
    headers["retry-after"] = String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000)));
  }
  return headers;
}

/** Default grants used by the reference configuration. */
export const DEFAULT_ROLE_GRANTS: Record<string, readonly string[]> = {
  "platform-admin": ["*"],
  "tenant-admin": [
    "tenant:read",
    "tenant:write",
    "user:read",
    "user:write",
    "role:read",
    "role:write",
    "reference-data:read",
    "reference-data:write",
    "webhook:read",
    "webhook:write",
    "feature-flag:read",
    "feature-flag:write",
    "audit:read",
  ],
  "tenant-operator": [
    "tenant:read",
    "user:read",
    "reference-data:read",
    "reference-data:write",
    "webhook:read",
    "feature-flag:read",
    "audit:read",
  ],
  auditor: ["tenant:read", "user:read", "role:read", "audit:read", "feature-flag:read"],
  viewer: ["tenant:read", "reference-data:read"],
  service: ["reference-data:read", "feature-flag:read"],
};
