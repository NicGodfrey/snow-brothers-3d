import type { IsoDateTime, RoleCode, Ulid } from "@enterprise-suite/shared-kernel";
import type { GrantPattern, PermissionKey } from "./permission-key.js";
import type { ScopePath } from "./scope.js";
import type { SubjectRef } from "./subject.js";

export type Effect = "allow" | "deny";

/**
 * Reason codes are stable and machine-readable: dashboards group denials by reason,
 * and support staff use them to tell "you were never granted this" apart from
 * "someone explicitly denied you".
 */
export const DECISION_REASON = {
  allowedByGrant: "ALLOWED_BY_GRANT",
  allowedBySuperuser: "ALLOWED_BY_SUPERUSER",
  deniedByExplicitDeny: "DENIED_BY_EXPLICIT_DENY",
  deniedNoGrant: "DENIED_NO_MATCHING_GRANT",
  deniedScope: "DENIED_SCOPE_MISMATCH",
  deniedTenantInactive: "DENIED_TENANT_INACTIVE",
  deniedSubjectInactive: "DENIED_SUBJECT_INACTIVE",
  deniedBindingExpired: "DENIED_ALL_BINDINGS_EXPIRED",
  deniedCredentialRestriction: "DENIED_CREDENTIAL_RESTRICTION",
  deniedUnknownPermission: "DENIED_UNKNOWN_PERMISSION",
} as const;

export type DecisionReason = (typeof DECISION_REASON)[keyof typeof DECISION_REASON];

/** The grant that decided the request, kept for audit and for the explain endpoint. */
export interface MatchedGrant {
  readonly bindingId: Ulid;
  readonly roleCode: RoleCode;
  /** Role the grant literally came from, which differs from `roleCode` when inherited. */
  readonly viaRoleCode: RoleCode;
  readonly subject: SubjectRef;
  readonly effect: Effect;
  readonly permission: GrantPattern;
  readonly scope: ScopePath;
}

export interface AuthorizationRequest {
  readonly permission: PermissionKey;
  readonly scope: ScopePath;
  readonly resourceId?: string;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: DecisionReason;
  readonly permission: PermissionKey;
  readonly scope: ScopePath;
  readonly subject: SubjectRef;
  readonly matched?: MatchedGrant;
  readonly evaluatedAt: IsoDateTime;
  /** Ordered human-readable evaluation steps; only populated when explain is requested. */
  readonly trace?: readonly string[];
}

export function describeDecision(decision: AuthorizationDecision): string {
  const verdict = decision.allowed ? "ALLOW" : "DENY";
  const via = decision.matched
    ? ` via role ${decision.matched.roleCode} (${decision.matched.permission} @ ${decision.matched.scope})`
    : "";
  return `${verdict} ${decision.permission} @ ${decision.scope} [${decision.reason}]${via}`;
}
