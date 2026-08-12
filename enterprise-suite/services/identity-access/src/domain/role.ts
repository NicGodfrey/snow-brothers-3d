import {
  AggregateRoot,
  ConflictError,
  brand,
  roleCode as toRoleCode,
  type IsoDateTime,
  type RoleCode,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { Effect } from "./decision.js";
import { IDENTITY_ERROR, IdentityError, ValidationError } from "./errors.js";
import { IDENTITY_EVENT, identityEvent } from "./events.js";
import { newRoleId } from "./ids.js";
import {
  bySpecificityDesc,
  grantPattern,
  patternCovers,
  type GrantPattern,
} from "./permission-key.js";
import { ROOT_SCOPE, scopePath, type ScopePath } from "./scope.js";

/**
 * One rule inside a role. `scope` narrows the rule relative to the scope the role is
 * bound at, so a role can carry "read everywhere, write only in this business unit".
 */
export interface RoleGrant {
  readonly effect: Effect;
  readonly permission: GrantPattern;
  readonly scope: ScopePath;
}

export const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export function roleCodeOf(value: string): RoleCode {
  const normalized = value.trim().toLowerCase();
  if (!ROLE_CODE_PATTERN.test(normalized)) {
    throw new ValidationError(
      `Invalid role code "${value}": expected snake_case, 2-64 characters`,
      IDENTITY_ERROR.invalidUserState,
    );
  }
  return toRoleCode(normalized);
}

export function roleGrant(
  effect: Effect,
  permission: string,
  scope: string = ROOT_SCOPE,
): RoleGrant {
  return { effect, permission: grantPattern(permission), scope: scopePath(scope) };
}

export function allow(permission: string, scope?: string): RoleGrant {
  return roleGrant("allow", permission, scope);
}

export function deny(permission: string, scope?: string): RoleGrant {
  return roleGrant("deny", permission, scope);
}

export function grantKey(grant: RoleGrant): string {
  return `${grant.effect}|${grant.permission}|${grant.scope}`;
}

interface RoleProps {
  code: RoleCode;
  name: string;
  description: string;
  grants: RoleGrant[];
  inherits: RoleCode[];
  /** System roles ship with the platform and cannot be edited or deleted by tenants. */
  system: boolean;
  /** Non-assignable roles exist only to be inherited by other roles. */
  assignable: boolean;
}

export class Role extends AggregateRoot<RoleProps> {
  private constructor(tenantId: TenantId, props: RoleProps, id?: Ulid, createdAt?: IsoDateTime) {
    super(tenantId, props, { id: id ?? newRoleId(), createdAt });
  }

  static create(input: {
    tenantId: TenantId;
    code: string;
    name: string;
    description?: string;
    grants?: readonly RoleGrant[];
    inherits?: readonly string[];
    system?: boolean;
    assignable?: boolean;
  }): Role {
    const role = new Role(input.tenantId, {
      code: roleCodeOf(input.code),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      grants: dedupeGrants(input.grants ?? []),
      inherits: (input.inherits ?? []).map(roleCodeOf),
      system: input.system ?? false,
      assignable: input.assignable ?? true,
    });
    if (role.props.name.length < 2) {
      throw new ValidationError("Role name is too short", IDENTITY_ERROR.invalidUserState);
    }
    if (role.props.inherits.includes(role.props.code)) {
      throw new IdentityError(
        `Role ${role.props.code} cannot inherit from itself`,
        IDENTITY_ERROR.roleCycle,
        422,
      );
    }
    role.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.roleCreated,
        aggregateType: "role",
        aggregateId: role.id,
        tenantId: role.tenantId,
        payload: {
          roleCode: role.props.code,
          name: role.props.name,
          grantCount: role.props.grants.length,
          inherits: [...role.props.inherits],
        },
      }),
    );
    return role;
  }

  get code(): RoleCode {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string {
    return this.props.description;
  }

  get grants(): readonly RoleGrant[] {
    return this.props.grants;
  }

  get inherits(): readonly RoleCode[] {
    return this.props.inherits;
  }

  get isSystem(): boolean {
    return this.props.system;
  }

  get isAssignable(): boolean {
    return this.props.assignable;
  }

  private assertMutable(): void {
    if (this.props.system) {
      throw new IdentityError(
        `System role ${this.props.code} cannot be modified`,
        IDENTITY_ERROR.systemRoleImmutable,
        409,
      );
    }
  }

  describe(input: { name?: string; description?: string; assignable?: boolean }): void {
    this.assertMutable();
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length < 2) {
        throw new ValidationError("Role name is too short", IDENTITY_ERROR.invalidUserState);
      }
      this.props.name = trimmed;
    }
    if (input.description !== undefined) this.props.description = input.description.trim();
    if (input.assignable !== undefined) this.props.assignable = input.assignable;
    this.raise(this.updatedEvent());
  }

  addGrant(grant: RoleGrant): void {
    this.assertMutable();
    if (this.props.grants.some((g) => grantKey(g) === grantKey(grant))) {
      throw new ConflictError(`Role ${this.props.code} already grants ${grantKey(grant)}`);
    }
    this.props.grants = dedupeGrants([...this.props.grants, grant]);
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.roleGrantAdded,
        aggregateType: "role",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          roleCode: this.props.code,
          effect: grant.effect,
          permission: grant.permission,
          scope: grant.scope,
        },
      }),
    );
  }

  removeGrant(grant: RoleGrant): void {
    this.assertMutable();
    const target = grantKey(grant);
    const next = this.props.grants.filter((g) => grantKey(g) !== target);
    if (next.length === this.props.grants.length) return;
    this.props.grants = next;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.roleGrantRemoved,
        aggregateType: "role",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          roleCode: this.props.code,
          effect: grant.effect,
          permission: grant.permission,
          scope: grant.scope,
        },
      }),
    );
  }

  replaceGrants(grants: readonly RoleGrant[]): void {
    this.assertMutable();
    this.props.grants = dedupeGrants(grants);
    this.raise(this.updatedEvent());
  }

  setInherits(codes: readonly string[]): void {
    this.assertMutable();
    const parsed = codes.map(roleCodeOf);
    if (parsed.includes(this.props.code)) {
      throw new IdentityError(
        `Role ${this.props.code} cannot inherit from itself`,
        IDENTITY_ERROR.roleCycle,
        422,
      );
    }
    this.props.inherits = [...new Set(parsed)];
    this.raise(this.updatedEvent());
  }

  /** True when the role's own grants (ignoring inheritance) mention the pattern. */
  hasGrant(effect: Effect, permission: GrantPattern): boolean {
    return this.props.grants.some((g) => g.effect === effect && g.permission === permission);
  }

  /** Copies this role's rules into a new tenant-owned, editable role. */
  cloneAs(code: string, name: string): Role {
    return Role.create({
      tenantId: this.tenantId,
      code,
      name,
      description: `Cloned from ${this.props.code}`,
      grants: this.props.grants,
      inherits: this.props.inherits,
      system: false,
      assignable: true,
    });
  }

  private updatedEvent() {
    return identityEvent({
      eventType: IDENTITY_EVENT.roleUpdated,
      aggregateType: "role",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        roleCode: this.props.code,
        name: this.props.name,
        grantCount: this.props.grants.length,
        inherits: [...this.props.inherits],
      },
    });
  }
}

/**
 * Removes exact duplicates and allow-grants already implied by a broader allow-grant at
 * the same or a wider scope. Deny grants are always kept: they are cheap to evaluate and
 * dropping one could silently widen access.
 */
export function dedupeGrants(grants: readonly RoleGrant[]): RoleGrant[] {
  const unique = new Map<string, RoleGrant>();
  for (const grant of grants) unique.set(grantKey(grant), grant);
  const all = [...unique.values()];
  const allows = all.filter((g) => g.effect === "allow");
  const kept = all.filter((grant) => {
    if (grant.effect === "deny") return true;
    return !allows.some(
      (other) =>
        grantKey(other) !== grantKey(grant) &&
        patternCovers(other.permission, grant.permission) &&
        coversScope(other.scope, grant.scope),
    );
  });
  return kept.sort(
    (a, b) =>
      a.effect.localeCompare(b.effect) ||
      bySpecificityDesc(a.permission, b.permission) ||
      a.scope.localeCompare(b.scope),
  );
}

function coversScope(outer: ScopePath, inner: ScopePath): boolean {
  if (outer === inner) return true;
  return inner.startsWith(`${outer}/`);
}

export function systemRoleCode(value: string): RoleCode {
  return brand<string, "RoleCode">(value);
}
