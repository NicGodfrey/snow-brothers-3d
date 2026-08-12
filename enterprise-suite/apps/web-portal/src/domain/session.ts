import { ForbiddenError, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "./module.js";
import { PermissionSet } from "./rbac.js";

/**
 * Session and tenant model.
 *
 * The portal is multi-tenant: a user may belong to several tenants and the
 * active tenant decides both the entitlement set (which modules exist at all)
 * and the headers forwarded to every downstream service.
 */

export interface TenantProfile {
  readonly tenantId: string;
  readonly name: string;
  /** Modules the tenant has bought. Anything else is hidden, not just denied. */
  readonly entitlements: readonly ModuleKey[];
  readonly defaultLocale: string;
  readonly defaultCurrency: string;
  readonly featureFlags: Readonly<Record<string, boolean>>;
}

export interface UserProfile {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  /** Roles per tenant; a user can be an admin in one tenant and a viewer in another. */
  readonly memberships: Readonly<Record<string, readonly string[]>>;
}

export interface PortalSession {
  readonly sessionId: string;
  readonly tenant: TenantProfile;
  readonly user: UserProfile;
  readonly roles: readonly string[];
  readonly permissions: PermissionSet;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  /** Present when an admin is acting on behalf of another user. */
  readonly impersonatedBy?: string;
}

export interface SessionInput {
  readonly sessionId: string;
  readonly tenant: TenantProfile;
  readonly user: UserProfile;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly impersonatedBy?: string;
  /** Overrides the membership roles; used when a token carries explicit roles. */
  readonly roles?: readonly string[];
}

export function createSession(input: SessionInput): PortalSession {
  const roles = input.roles ?? input.user.memberships[input.tenant.tenantId];
  if (!roles || roles.length === 0) {
    throw new ForbiddenError(
      `${input.user.userId} has no roles in tenant ${input.tenant.tenantId}`,
    );
  }
  return {
    sessionId: input.sessionId,
    tenant: input.tenant,
    user: input.user,
    roles: [...roles],
    permissions: PermissionSet.fromRoles(roles),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    impersonatedBy: input.impersonatedBy,
  };
}

export function isExpired(session: PortalSession, now: string): boolean {
  return Date.parse(session.expiresAt) <= Date.parse(now);
}

export function isEntitled(session: PortalSession, module: ModuleKey): boolean {
  return session.tenant.entitlements.includes(module);
}

export function hasFeature(session: PortalSession, flag: string): boolean {
  return session.tenant.featureFlags[flag] === true;
}

export function tenantsOf(user: UserProfile): readonly string[] {
  return Object.keys(user.memberships).sort();
}

/** Headers every downstream call carries — the contract from ARCHITECTURE.md. */
export interface TenantHeaders extends Record<string, string> {
  "x-tenant-id": string;
  "x-user-id": string;
  "x-roles": string;
}

export function sessionHeaders(session: PortalSession): TenantHeaders {
  const headers: TenantHeaders = {
    "x-tenant-id": session.tenant.tenantId,
    "x-user-id": session.user.userId,
    "x-roles": session.roles.join(","),
  };
  if (session.impersonatedBy) headers["x-on-behalf-of"] = session.impersonatedBy;
  return headers;
}
