import {
  envelope,
  type EventEnvelope,
  type IsoDateTime,
  type RoleCode,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { DecisionReason } from "./decision.js";
import type { GrantPattern, PermissionKey } from "./permission-key.js";
import type { ScopePath } from "./scope.js";
import type { SubjectRef } from "./subject.js";

export const IDENTITY_EVENT = {
  tenantProvisioned: "identity.tenant.provisioned",
  tenantActivated: "identity.tenant.activated",
  tenantSuspended: "identity.tenant.suspended",
  tenantArchived: "identity.tenant.archived",
  tenantSettingsUpdated: "identity.tenant.settings_updated",

  userInvited: "identity.user.invited",
  userActivated: "identity.user.activated",
  userSuspended: "identity.user.suspended",
  userReactivated: "identity.user.reactivated",
  userDeactivated: "identity.user.deactivated",
  userEmailChanged: "identity.user.email_changed",
  userPasswordChanged: "identity.user.password_changed",
  userLockedOut: "identity.user.locked_out",
  userUnlocked: "identity.user.unlocked",
  userMfaEnrolled: "identity.user.mfa_enrolled",
  userMfaDisabled: "identity.user.mfa_disabled",

  groupCreated: "identity.group.created",
  groupRenamed: "identity.group.renamed",
  groupMemberAdded: "identity.group.member_added",
  groupMemberRemoved: "identity.group.member_removed",
  groupDeleted: "identity.group.deleted",

  roleCreated: "identity.role.created",
  roleUpdated: "identity.role.updated",
  roleGrantAdded: "identity.role.grant_added",
  roleGrantRemoved: "identity.role.grant_removed",
  roleDeleted: "identity.role.deleted",

  bindingGranted: "identity.role_binding.granted",
  bindingRevoked: "identity.role_binding.revoked",
  bindingExtended: "identity.role_binding.extended",

  apiKeyIssued: "identity.api_key.issued",
  apiKeyRotated: "identity.api_key.rotated",
  apiKeyRevoked: "identity.api_key.revoked",
  apiKeyUsed: "identity.api_key.used",

  sessionIssued: "identity.session.issued",
  sessionRefreshed: "identity.session.refreshed",
  sessionRevoked: "identity.session.revoked",
  sessionExpired: "identity.session.expired",

  authnSucceeded: "identity.authn.succeeded",
  authnFailed: "identity.authn.failed",
  authzDenied: "identity.authz.denied",
} as const;

export type IdentityEventType = (typeof IDENTITY_EVENT)[keyof typeof IDENTITY_EVENT];

export interface TenantProvisionedPayload {
  readonly slug: string;
  readonly name: string;
}

export interface TenantLifecyclePayload {
  readonly slug: string;
  readonly status: string;
  readonly reason?: string;
}

export interface UserInvitedPayload {
  readonly email: string;
  readonly displayName: string;
  readonly invitedBy?: Ulid;
}

export interface UserLifecyclePayload {
  readonly email: string;
  readonly status: string;
  readonly reason?: string;
}

export interface UserLockedOutPayload {
  readonly email: string;
  readonly failedAttempts: number;
  readonly lockedUntil: IsoDateTime;
}

export interface RoleChangedPayload {
  readonly roleCode: RoleCode;
  readonly name: string;
  readonly grantCount: number;
  readonly inherits: readonly RoleCode[];
}

export interface RoleGrantPayload {
  readonly roleCode: RoleCode;
  readonly effect: string;
  readonly permission: GrantPattern;
  readonly scope?: ScopePath;
}

export interface BindingPayload {
  readonly subject: SubjectRef;
  readonly roleCode: RoleCode;
  readonly scope: ScopePath;
  readonly validUntil?: IsoDateTime;
  readonly grantedBy?: Ulid;
  readonly reason?: string;
}

export interface ApiKeyPayload {
  readonly name: string;
  readonly prefix: string;
  readonly expiresAt?: IsoDateTime;
  readonly reason?: string;
}

export interface SessionPayload {
  readonly userId: Ulid;
  readonly expiresAt: IsoDateTime;
  readonly absoluteExpiresAt: IsoDateTime;
  readonly amr: readonly string[];
  readonly reason?: string;
}

export interface AuthnPayload {
  readonly email?: string;
  readonly method: string;
  readonly outcome: "succeeded" | "failed";
  readonly failureCode?: string;
  readonly ip?: string;
}

export interface AuthzDeniedPayload {
  readonly subject: SubjectRef;
  readonly permission: PermissionKey;
  readonly scope: ScopePath;
  readonly reason: DecisionReason;
}

export interface GroupPayload {
  readonly name: string;
  readonly userId?: Ulid;
  readonly parentGroupId?: Ulid;
}

/** Thin wrapper so every event in this context gets a consistent aggregateType prefix. */
export function identityEvent<TPayload>(input: {
  eventType: IdentityEventType;
  aggregateType: string;
  aggregateId: Ulid;
  tenantId: TenantId;
  payload: TPayload;
  correlationId?: Ulid;
  causationId?: Ulid;
}): EventEnvelope<TPayload> {
  return envelope<TPayload>({
    eventType: input.eventType,
    aggregateType: `identity.${input.aggregateType}`,
    aggregateId: input.aggregateId,
    tenantId: input.tenantId,
    payload: input.payload,
    schemaVersion: 1,
    correlationId: input.correlationId,
    causationId: input.causationId,
  });
}
