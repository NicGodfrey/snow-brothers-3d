import type { RoleCode } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "../../domain/errors.js";
import type { Group } from "../../domain/group.js";
import type { Role, RoleGrant } from "../../domain/role.js";
import { grantKey } from "../../domain/role.js";
import { subjectKey, type SubjectRef } from "../../domain/subject.js";
import type { Ulid } from "@enterprise-suite/shared-kernel";

/** A grant plus the role it literally came from, which matters for explanations. */
export interface ResolvedGrant extends RoleGrant {
  readonly viaRoleCode: RoleCode;
  /** 0 for the role's own grants, 1 for a parent, and so on. */
  readonly inheritanceDepth: number;
}

export interface ResolvedRole {
  readonly code: RoleCode;
  readonly grants: readonly ResolvedGrant[];
  /** Every role that contributed grants, including the role itself. */
  readonly ancestry: readonly RoleCode[];
}

/**
 * Flattens a role and everything it inherits into a single grant list.
 *
 * Inheritance is a DAG: diamond shapes are fine (a grant reached by two paths appears
 * once, at its shallowest depth), cycles are a configuration error and throw.
 */
export function resolveRole(
  roles: ReadonlyMap<RoleCode, Role>,
  code: RoleCode,
  cache: Map<RoleCode, ResolvedRole> = new Map(),
): ResolvedRole {
  return resolveInternal(roles, code, cache, []);
}

function resolveInternal(
  roles: ReadonlyMap<RoleCode, Role>,
  code: RoleCode,
  cache: Map<RoleCode, ResolvedRole>,
  path: readonly RoleCode[],
): ResolvedRole {
  const cached = cache.get(code);
  if (cached) return cached;
  if (path.includes(code)) {
    throw new IdentityError(
      `Role inheritance cycle: ${[...path, code].join(" -> ")}`,
      IDENTITY_ERROR.roleCycle,
      409,
    );
  }
  const role = roles.get(code);
  if (!role) {
    // A binding may outlive the role it points at; treat it as granting nothing rather
    // than failing the whole evaluation.
    const empty: ResolvedRole = { code, grants: [], ancestry: [] };
    return empty;
  }

  const byKey = new Map<string, ResolvedGrant>();
  for (const grant of role.grants) {
    byKey.set(grantKey(grant), { ...grant, viaRoleCode: code, inheritanceDepth: 0 });
  }
  const ancestry: RoleCode[] = [code];

  for (const parentCode of role.inherits) {
    const parent = resolveInternal(roles, parentCode, cache, [...path, code]);
    for (const parentGrant of parent.grants) {
      const key = grantKey(parentGrant);
      const existing = byKey.get(key);
      const candidate: ResolvedGrant = {
        ...parentGrant,
        inheritanceDepth: parentGrant.inheritanceDepth + 1,
      };
      if (!existing || existing.inheritanceDepth > candidate.inheritanceDepth) {
        byKey.set(key, candidate);
      }
    }
    for (const ancestor of parent.ancestry) {
      if (!ancestry.includes(ancestor)) ancestry.push(ancestor);
    }
  }

  const resolved: ResolvedRole = {
    code,
    grants: [...byKey.values()].sort(
      (a, b) =>
        a.inheritanceDepth - b.inheritanceDepth ||
        a.effect.localeCompare(b.effect) ||
        a.permission.localeCompare(b.permission),
    ),
    ancestry,
  };
  cache.set(code, resolved);
  return resolved;
}

export function resolveAll(roles: ReadonlyMap<RoleCode, Role>): Map<RoleCode, ResolvedRole> {
  const cache = new Map<RoleCode, ResolvedRole>();
  for (const code of roles.keys()) resolveRole(roles, code, cache);
  return cache;
}

/**
 * Expands a subject into every subject whose bindings apply to it: the subject itself,
 * the groups it belongs to, and those groups' ancestors. Cycles in the group tree are
 * broken rather than thrown, because a broken parent link should not lock people out.
 */
export function expandSubjectChain(
  subject: SubjectRef,
  groups: readonly Group[],
): readonly SubjectRef[] {
  const chain: SubjectRef[] = [subject];
  const seen = new Set<string>([subjectKey(subject)]);
  if (subject.type !== "user") return chain;

  const byId = new Map<Ulid, Group>(groups.map((group) => [group.id, group]));
  const queue: Group[] = groups.filter((group) => group.hasMember(subject.id));

  while (queue.length > 0) {
    const group = queue.shift() as Group;
    const key = `group:${group.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push({ type: "group", id: group.id });
    const parentId = group.parentGroupId;
    if (parentId) {
      const parent = byId.get(parentId);
      if (parent && !seen.has(`group:${parent.id}`)) queue.push(parent);
    }
  }
  return chain;
}

/** Detects a cycle that a proposed parent link would introduce, before it is saved. */
export function wouldCreateGroupCycle(
  groups: readonly Group[],
  groupId: Ulid,
  proposedParentId: Ulid,
): boolean {
  if (groupId === proposedParentId) return true;
  const byId = new Map<Ulid, Group>(groups.map((group) => [group.id, group]));
  let current = byId.get(proposedParentId);
  const seen = new Set<Ulid>();
  while (current) {
    if (current.id === groupId) return true;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parentGroupId ? byId.get(current.parentGroupId) : undefined;
  }
  return false;
}
