import type { TenantId } from "@enterprise-suite/shared-kernel";
import type { AuthorizationService, CheckOptions } from "../application/authorization-service.js";
import type { Principal } from "../application/principal.js";
import type { AuthorizationDecision } from "../domain/decision.js";
import { AuthorizationDeniedError } from "../domain/errors.js";
import { matchesPermission, permissionKey, type GrantPattern, type PermissionKey } from "../domain/permission-key.js";
import { ROOT_SCOPE, childScope, scopePath, type ScopePath } from "../domain/scope.js";

/**
 * Ergonomic wrappers over `AuthorizationService`. Callers in other bounded contexts
 * should use these rather than reaching for the evaluator: they keep the audit trail
 * consistent and make the intent (`can` vs `require`) obvious at the call site.
 */

export function can(
  authorization: AuthorizationService,
  principal: Principal,
  permission: string,
  scope?: string | ScopePath,
): boolean {
  return authorization.can(principal, permission, { scope });
}

export function requirePermission(
  authorization: AuthorizationService,
  principal: Principal,
  permission: string,
  options: CheckOptions = {},
): AuthorizationDecision {
  return authorization.require(principal, permission, options);
}

/** Requires every permission; the first failure names the permission that failed. */
export function requireAll(
  authorization: AuthorizationService,
  principal: Principal,
  permissions: readonly string[],
  options: CheckOptions = {},
): void {
  for (const permission of permissions) authorization.require(principal, permission, options);
}

/** Requires at least one of the permissions, reporting them all when none matches. */
export function requireAny(
  authorization: AuthorizationService,
  principal: Principal,
  permissions: readonly string[],
  options: CheckOptions = {},
): AuthorizationDecision {
  let last: AuthorizationDecision | undefined;
  for (const permission of permissions) {
    const decision = authorization.check(principal, permission, { ...options, silent: true });
    if (decision.allowed) return decision;
    last = decision;
  }
  throw new AuthorizationDeniedError(
    permissions.join(" | "),
    last?.scope ?? ROOT_SCOPE,
    last?.reason ?? "DENIED_NO_MATCHING_GRANT",
  );
}

/**
 * Wraps a function so it only runs when the permission is held. Useful for route
 * handlers and job steps that would otherwise repeat the same three lines.
 */
export function guarded<TArgs extends unknown[], TResult>(
  authorization: AuthorizationService,
  permission: string,
  handler: (principal: Principal, ...args: TArgs) => TResult,
  options: CheckOptions = {},
): (principal: Principal, ...args: TArgs) => TResult {
  return (principal: Principal, ...args: TArgs): TResult => {
    authorization.require(principal, permission, options);
    return handler(principal, ...args);
  };
}

/**
 * Narrows a collection to the entries the principal may see, given a function that maps
 * each entry to the scope it lives at. One authorization call per distinct scope.
 */
export function filterByScope<T>(
  authorization: AuthorizationService,
  principal: Principal,
  permission: string,
  items: readonly T[],
  scopeOf: (item: T) => string | ScopePath,
): readonly T[] {
  const verdicts = new Map<string, boolean>();
  return items.filter((item) => {
    const scope = String(scopeOf(item));
    const cached = verdicts.get(scope);
    if (cached !== undefined) return cached;
    const allowed = authorization.can(principal, permission, { scope });
    verdicts.set(scope, allowed);
    return allowed;
  });
}

/** Convenience for building the scope of a business object, e.g. `bu`/`emea`. */
export function scopeFor(type: string, key: string, parent: ScopePath = ROOT_SCOPE): ScopePath {
  return childScope(parent, type, key);
}

export function toScope(value: string | ScopePath | undefined): ScopePath {
  return value ? scopePath(String(value)) : ROOT_SCOPE;
}

/**
 * An immutable snapshot of what a subject may do at one scope. Front-ends fetch this
 * once per page load instead of asking the server about every button.
 */
export class PermissionSet {
  private readonly keys: ReadonlySet<string>;

  constructor(
    readonly tenantId: TenantId,
    readonly scope: ScopePath,
    permissions: readonly PermissionKey[],
  ) {
    this.keys = new Set(permissions);
  }

  static from(
    authorization: AuthorizationService,
    principal: Principal,
    scope: ScopePath = ROOT_SCOPE,
  ): PermissionSet {
    return new PermissionSet(
      principal.tenantId,
      scope,
      authorization.grantedPermissionKeys(principal.tenantId, principal.subject, scope),
    );
  }

  has(permission: string): boolean {
    return this.keys.has(permissionKey(permission));
  }

  hasAll(permissions: readonly string[]): boolean {
    return permissions.every((permission) => this.has(permission));
  }

  hasAny(permissions: readonly string[]): boolean {
    return permissions.some((permission) => this.has(permission));
  }

  /** Every held permission matching a wildcard pattern, e.g. `identity.user:*`. */
  matching(pattern: GrantPattern): readonly PermissionKey[] {
    return this.toArray().filter((key) => matchesPermission(pattern, key));
  }

  toArray(): readonly PermissionKey[] {
    return [...this.keys].sort() as PermissionKey[];
  }

  get size(): number {
    return this.keys.size;
  }

  toJSON(): { tenantId: TenantId; scope: ScopePath; permissions: readonly string[] } {
    return { tenantId: this.tenantId, scope: this.scope, permissions: this.toArray() };
  }
}
