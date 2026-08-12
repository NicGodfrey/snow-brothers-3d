import { NotFoundError, type RoleCode, type TenantId } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "../domain/errors.js";
import type { PermissionCatalog } from "../domain/permission.js";
import {
  grantPattern,
  matchesPermission,
  permissionKey,
  type GrantPattern,
} from "../domain/permission-key.js";
import { Role, roleCodeOf, roleGrant, type RoleGrant } from "../domain/role.js";
import { scopePath } from "../domain/scope.js";
import { resolveRole, type ResolvedRole } from "./policy/effective-permissions.js";
import type {
  Clock,
  EventPublisher,
  PolicyVersionStore,
  RoleBindingRepository,
  RoleRepository,
} from "./ports.js";

export interface GrantInput {
  readonly effect?: "allow" | "deny";
  readonly permission: string;
  readonly scope?: string;
}

export interface CreateRoleInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly grants?: readonly GrantInput[];
  readonly inherits?: readonly string[];
  readonly assignable?: boolean;
  readonly system?: boolean;
}

export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly bindings: RoleBindingRepository,
    private readonly catalog: PermissionCatalog,
    private readonly policyVersions: PolicyVersionStore,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  create(tenantId: TenantId, input: CreateRoleInput): Role {
    const code = roleCodeOf(input.code);
    if (this.roles.byCode(tenantId, code)) {
      throw new IdentityError(`Role "${code}" already exists`, IDENTITY_ERROR.roleCodeTaken, 409);
    }
    const grants = (input.grants ?? []).map((grant) => this.toGrant(grant));
    const role = Role.create({
      tenantId,
      code,
      name: input.name,
      description: input.description,
      grants,
      inherits: input.inherits,
      assignable: input.assignable,
      system: input.system,
    });
    this.assertNoCycle(tenantId, role);
    this.persist(tenantId, role);
    return role;
  }

  get(tenantId: TenantId, code: RoleCode): Role {
    const role = this.roles.byCode(tenantId, code);
    if (!role) throw new NotFoundError("Role", code);
    return role;
  }

  list(tenantId: TenantId, options: { assignableOnly?: boolean } = {}): readonly Role[] {
    const all = [...this.roles.list(tenantId)].sort((a, b) => a.code.localeCompare(b.code));
    return options.assignableOnly ? all.filter((role) => role.isAssignable) : all;
  }

  describe(
    tenantId: TenantId,
    code: RoleCode,
    input: { name?: string; description?: string; assignable?: boolean },
  ): Role {
    const role = this.get(tenantId, code);
    role.describe(input);
    this.persist(tenantId, role);
    return role;
  }

  addGrant(tenantId: TenantId, code: RoleCode, input: GrantInput): Role {
    const role = this.get(tenantId, code);
    role.addGrant(this.toGrant(input));
    this.persist(tenantId, role);
    return role;
  }

  removeGrant(tenantId: TenantId, code: RoleCode, input: GrantInput): Role {
    const role = this.get(tenantId, code);
    role.removeGrant(this.toGrant(input));
    this.persist(tenantId, role);
    return role;
  }

  replaceGrants(tenantId: TenantId, code: RoleCode, grants: readonly GrantInput[]): Role {
    const role = this.get(tenantId, code);
    role.replaceGrants(grants.map((grant) => this.toGrant(grant)));
    this.persist(tenantId, role);
    return role;
  }

  setInherits(tenantId: TenantId, code: RoleCode, inherits: readonly string[]): Role {
    const role = this.get(tenantId, code);
    const previous = [...role.inherits];
    role.setInherits(inherits);
    try {
      this.assertNoCycle(tenantId, role);
    } catch (error) {
      role.setInherits(previous);
      throw error;
    }
    this.persist(tenantId, role);
    return role;
  }

  clone(tenantId: TenantId, source: RoleCode, code: string, name: string): Role {
    const original = this.get(tenantId, source);
    if (this.roles.byCode(tenantId, roleCodeOf(code))) {
      throw new IdentityError(`Role "${code}" already exists`, IDENTITY_ERROR.roleCodeTaken, 409);
    }
    const clone = original.cloneAs(code, name);
    this.persist(tenantId, clone);
    return clone;
  }

  /** Refuses to delete system roles and roles that still have active bindings. */
  delete(tenantId: TenantId, code: RoleCode): void {
    const role = this.get(tenantId, code);
    if (role.isSystem) {
      throw new IdentityError(
        `System role ${code} cannot be deleted`,
        IDENTITY_ERROR.systemRoleImmutable,
        409,
      );
    }
    const now = this.clock.now();
    const active = this.bindings.byRole(tenantId, code).filter((binding) => binding.isActiveAt(now));
    if (active.length > 0) {
      throw new IdentityError(
        `Role ${code} still has ${active.length} active binding(s)`,
        IDENTITY_ERROR.roleInUse,
        409,
      );
    }
    const dependents = this.roles
      .list(tenantId)
      .filter((other) => other.inherits.includes(code))
      .map((other) => other.code);
    if (dependents.length > 0) {
      throw new IdentityError(
        `Role ${code} is inherited by ${dependents.join(", ")}`,
        IDENTITY_ERROR.roleInUse,
        409,
      );
    }
    this.roles.delete(tenantId, role.id);
    this.policyVersions.bump(tenantId);
  }

  /** Flattens inheritance so callers can see exactly what a role confers. */
  resolve(tenantId: TenantId, code: RoleCode): ResolvedRole {
    this.get(tenantId, code);
    return resolveRole(this.roles.map(tenantId), code);
  }

  /** Roles that would grant a given permission, for "who can do this?" queries. */
  rolesGranting(tenantId: TenantId, permission: string): readonly RoleCode[] {
    const key = permissionKey(permission);
    const map = this.roles.map(tenantId);
    const cache = new Map<RoleCode, ResolvedRole>();
    return [...map.keys()]
      .filter((code) => {
        const resolved = resolveRole(map, code, cache);
        const denied = resolved.grants.some(
          (grant) => grant.effect === "deny" && matchesPermission(grant.permission, key),
        );
        if (denied) return false;
        return resolved.grants.some(
          (grant) => grant.effect === "allow" && matchesPermission(grant.permission, key),
        );
      })
      .sort((a, b) => a.localeCompare(b));
  }

  private toGrant(input: GrantInput): RoleGrant {
    const pattern = grantPattern(input.permission);
    this.assertPatternKnown(pattern);
    return roleGrant(input.effect ?? "allow", pattern, input.scope ?? undefined);
  }

  /**
   * A concrete pattern must exist in the catalog; a wildcard pattern must match at least
   * one known permission, which catches typos like `sales.ordr:*` early.
   */
  private assertPatternKnown(pattern: GrantPattern): void {
    const known = this.catalog.list();
    if (known.length === 0) return;
    const matches = known.some((definition) => matchesPermission(pattern, definition.key));
    if (!matches) {
      throw new IdentityError(
        `Grant pattern "${pattern}" matches no registered permission`,
        IDENTITY_ERROR.unknownPermission,
        422,
      );
    }
  }

  private assertNoCycle(tenantId: TenantId, role: Role): void {
    const map = new Map(this.roles.map(tenantId));
    map.set(role.code, role);
    resolveRole(map, role.code);
  }

  private persist(tenantId: TenantId, role: Role): void {
    this.roles.save(role);
    this.policyVersions.bump(tenantId);
    this.publisher.publish(role.pullEvents());
  }

  /** Convenience for seeding: parses "allow sales.order:read @ tenant/bu:emea". */
  static parseGrantExpression(expression: string): GrantInput {
    const [head, scope] = expression.split("@").map((part) => part.trim());
    const parts = head.split(/\s+/);
    const effect = parts.length > 1 ? (parts[0] as "allow" | "deny") : "allow";
    const permission = parts.length > 1 ? parts[1] : parts[0];
    return { effect, permission, scope: scope ? scopePath(scope) : undefined };
  }
}
