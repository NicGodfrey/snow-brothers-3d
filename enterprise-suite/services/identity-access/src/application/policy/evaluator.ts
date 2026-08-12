import type { IsoDateTime, RoleCode } from "@enterprise-suite/shared-kernel";
import {
  DECISION_REASON,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type Effect,
  type MatchedGrant,
} from "../../domain/decision.js";
import {
  matchesPermission,
  patternSpecificity,
  type GrantPattern,
  type PermissionKey,
} from "../../domain/permission-key.js";
import type { Role } from "../../domain/role.js";
import type { RoleBinding } from "../../domain/role-binding.js";
import {
  isRootScope,
  scopeCovers,
  scopeSpecificity,
  type ScopePath,
} from "../../domain/scope.js";
import { subjectKey, type SubjectRef } from "../../domain/subject.js";
import type { TenantStatus } from "../../domain/tenant.js";
import { resolveRole, type ResolvedGrant, type ResolvedRole } from "./effective-permissions.js";

export interface EvaluationInput {
  readonly now: IsoDateTime;
  readonly subject: SubjectRef;
  readonly tenantStatus: TenantStatus;
  /** False when the user is suspended/locked or the key is revoked/expired. */
  readonly subjectEnabled: boolean;
  readonly request: AuthorizationRequest;
  /** Bindings for the whole subject chain (subject + its groups). */
  readonly bindings: readonly RoleBinding[];
  readonly roles: ReadonlyMap<RoleCode, Role>;
  /** API key scope-down list; when present the permission must match one of these. */
  readonly restrictions?: readonly GrantPattern[];
  readonly explain?: boolean;
  /** Shared across a batch of checks so role inheritance is flattened once. */
  readonly roleCache?: Map<RoleCode, ResolvedRole>;
}

interface Candidate {
  readonly grant: ResolvedGrant;
  readonly binding: RoleBinding;
  readonly effectiveScope: ScopePath;
}

/**
 * Resolves the scope a grant actually applies at, given the scope its binding was made
 * at. A grant may narrow the binding (role says "only in EMEA", binding is tenant-wide)
 * or the binding may narrow the grant. Disjoint scopes mean the grant never applies.
 */
export function effectiveGrantScope(
  bindingScope: ScopePath,
  grantScope: ScopePath,
): ScopePath | undefined {
  if (isRootScope(grantScope)) return bindingScope;
  if (scopeCovers(bindingScope, grantScope)) return grantScope;
  if (scopeCovers(grantScope, bindingScope)) return bindingScope;
  return undefined;
}

/**
 * Pure RBAC decision function: no repositories, no clock, no side effects. Everything it
 * needs is in `input`, which makes the whole policy testable in isolation and lets the
 * service layer cache results freely.
 *
 * Order of evaluation:
 *   1. tenant must be active
 *   2. subject must be enabled
 *   3. API key restrictions must admit the permission
 *   4. explicit deny anywhere in the subject's roles wins
 *   5. otherwise an allow grant covering the requested scope permits the action
 *   6. default deny
 */
export function evaluate(input: EvaluationInput): AuthorizationDecision {
  const trace: string[] = [];
  const push = (line: string): void => {
    if (input.explain) trace.push(line);
  };
  const base = {
    permission: input.request.permission,
    scope: input.request.scope,
    subject: input.subject,
    evaluatedAt: input.now,
  };
  const finish = (
    allowed: boolean,
    reason: AuthorizationDecision["reason"],
    matched?: MatchedGrant,
  ): AuthorizationDecision => ({
    ...base,
    allowed,
    reason,
    matched,
    trace: input.explain ? [...trace] : undefined,
  });

  push(
    `evaluating ${input.request.permission} @ ${input.request.scope} for ${subjectKey(input.subject)}`,
  );

  if (input.tenantStatus !== "active") {
    push(`tenant is ${input.tenantStatus}`);
    return finish(false, DECISION_REASON.deniedTenantInactive);
  }
  if (!input.subjectEnabled) {
    push("subject is not enabled (suspended, locked, revoked or expired)");
    return finish(false, DECISION_REASON.deniedSubjectInactive);
  }
  if (input.restrictions && input.restrictions.length > 0) {
    const permitted = input.restrictions.some((pattern) =>
      matchesPermission(pattern, input.request.permission),
    );
    push(
      `credential restrictions [${input.restrictions.join(", ")}] ${permitted ? "admit" : "exclude"} the permission`,
    );
    if (!permitted) return finish(false, DECISION_REASON.deniedCredentialRestriction);
  }

  const roleCache = input.roleCache ?? new Map<RoleCode, ResolvedRole>();
  const candidates: Candidate[] = [];
  let sawActiveBinding = false;
  let sawExpiredBinding = false;
  let sawPermissionOutOfScope = false;

  for (const binding of input.bindings) {
    if (!binding.isActiveAt(input.now)) {
      sawExpiredBinding = sawExpiredBinding || binding.isExpiredAt(input.now);
      push(`binding ${binding.id} (${binding.describe()}) is not active at ${input.now}`);
      continue;
    }
    sawActiveBinding = true;
    const resolved = resolveRole(input.roles, binding.roleCode, roleCache);
    if (resolved.grants.length === 0) {
      push(`role ${binding.roleCode} resolves to no grants`);
      continue;
    }
    for (const grant of resolved.grants) {
      if (!matchesPermission(grant.permission, input.request.permission)) continue;
      const scope = effectiveGrantScope(binding.scope, grant.scope);
      if (!scope) {
        push(
          `grant ${grant.effect} ${grant.permission} @ ${grant.scope} is disjoint from binding scope ${binding.scope}`,
        );
        sawPermissionOutOfScope = true;
        continue;
      }
      if (!scopeCovers(scope, input.request.scope)) {
        push(
          `grant ${grant.effect} ${grant.permission} applies at ${scope}, which does not cover ${input.request.scope}`,
        );
        sawPermissionOutOfScope = true;
        continue;
      }
      candidates.push({ grant, binding, effectiveScope: scope });
    }
  }

  const denies = candidates.filter((candidate) => candidate.grant.effect === "deny");
  if (denies.length > 0) {
    const winner = mostSpecific(denies);
    push(`explicit deny from role ${winner.binding.roleCode} (${winner.grant.permission})`);
    return finish(false, DECISION_REASON.deniedByExplicitDeny, toMatched(winner, "deny"));
  }

  const allows = candidates.filter((candidate) => candidate.grant.effect === "allow");
  if (allows.length > 0) {
    const winner = mostSpecific(allows);
    const superuser = winner.grant.permission === "**:*";
    push(
      `allowed by role ${winner.binding.roleCode} via ${winner.grant.viaRoleCode} (${winner.grant.permission} @ ${winner.effectiveScope})`,
    );
    return finish(
      true,
      superuser ? DECISION_REASON.allowedBySuperuser : DECISION_REASON.allowedByGrant,
      toMatched(winner, "allow"),
    );
  }

  if (!sawActiveBinding && sawExpiredBinding) {
    push("every binding for this subject has expired");
    return finish(false, DECISION_REASON.deniedBindingExpired);
  }
  if (sawPermissionOutOfScope) {
    push("permission is granted, but not at the requested scope");
    return finish(false, DECISION_REASON.deniedScope);
  }
  push("no grant matches");
  return finish(false, DECISION_REASON.deniedNoGrant);
}

function mostSpecific(candidates: readonly Candidate[]): Candidate {
  return [...candidates].sort(
    (a, b) =>
      scopeSpecificity(b.effectiveScope) - scopeSpecificity(a.effectiveScope) ||
      patternSpecificity(b.grant.permission) - patternSpecificity(a.grant.permission) ||
      a.grant.inheritanceDepth - b.grant.inheritanceDepth ||
      a.binding.id.localeCompare(b.binding.id),
  )[0];
}

function toMatched(candidate: Candidate, effect: Effect): MatchedGrant {
  return {
    bindingId: candidate.binding.id,
    roleCode: candidate.binding.roleCode,
    viaRoleCode: candidate.grant.viaRoleCode,
    subject: candidate.binding.subject,
    effect,
    permission: candidate.grant.permission,
    scope: candidate.effectiveScope,
  };
}

/**
 * Every permission pattern the subject can exercise at a scope, with the winning effect.
 * Used by the "what can this user do" endpoint and by admin UIs.
 */
export function effectivePatterns(input: {
  now: IsoDateTime;
  bindings: readonly RoleBinding[];
  roles: ReadonlyMap<RoleCode, Role>;
  scope: ScopePath;
  roleCache?: Map<RoleCode, ResolvedRole>;
}): readonly { permission: GrantPattern; effect: Effect; scope: ScopePath; roleCode: RoleCode }[] {
  const cache = input.roleCache ?? new Map<RoleCode, ResolvedRole>();
  const out = new Map<
    string,
    { permission: GrantPattern; effect: Effect; scope: ScopePath; roleCode: RoleCode }
  >();
  for (const binding of input.bindings) {
    if (!binding.isActiveAt(input.now)) continue;
    const resolved = resolveRole(input.roles, binding.roleCode, cache);
    for (const grant of resolved.grants) {
      const scope = effectiveGrantScope(binding.scope, grant.scope);
      if (!scope || !scopeCovers(scope, input.scope)) continue;
      const key = `${grant.effect}|${grant.permission}|${scope}`;
      if (!out.has(key)) {
        out.set(key, {
          permission: grant.permission,
          effect: grant.effect,
          scope,
          roleCode: binding.roleCode,
        });
      }
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      a.effect.localeCompare(b.effect) ||
      patternSpecificity(b.permission) - patternSpecificity(a.permission) ||
      a.permission.localeCompare(b.permission),
  );
}

/** Filters a candidate permission list down to the ones the subject may exercise. */
export function filterAllowed(
  permissions: readonly PermissionKey[],
  scope: ScopePath,
  input: Omit<EvaluationInput, "request">,
): readonly PermissionKey[] {
  const roleCache = input.roleCache ?? new Map<RoleCode, ResolvedRole>();
  return permissions.filter(
    (permission) => evaluate({ ...input, roleCache, request: { permission, scope } }).allowed,
  );
}
