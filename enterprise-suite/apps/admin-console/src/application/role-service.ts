import { NotFoundError, type TenantId } from "@enterprise-suite/shared-kernel";
import { DuplicateError, ImmutableRecordError, InvalidStateError, ValidationError } from "../domain/errors.js";
import {
  hasPermission,
  permissionsForRoles,
  resolveRolePermissions,
  Role,
  type CreateRoleInput,
  type Permission,
} from "../domain/role.js";
import type { AuditService } from "./audit-service.js";
import type { Clock, CommandContext, Outbox, RoleRepository, UserRepository } from "./ports.js";

/**
 * Role administration and permission resolution.
 *
 * Two invariants matter here. A role that users still hold cannot be deleted —
 * otherwise a caller ends up with a role code nothing resolves. And a role's
 * inheritance parent must exist and must not close a cycle, which is checked
 * against the whole tenant graph rather than the single role being edited.
 */
export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: CommandContext, input: CreateRoleInput): Promise<Role> {
    const code = input.code.trim().toLowerCase();
    if (this.roles.byCode(ctx.tenantId, code)) {
      throw new DuplicateError("Role", "code", code);
    }
    if (input.inheritsFrom && !this.roles.byCode(ctx.tenantId, input.inheritsFrom)) {
      throw ValidationError.single("inheritsFrom", `role "${input.inheritsFrom}" does not exist`);
    }
    const role = Role.create(ctx.tenantId, { ...input, system: false });
    this.roles.save(role);
    this.assertGraphIsAcyclic(ctx.tenantId, role.code);

    await this.outbox.publish(role.pullEvents());
    this.audit.record(ctx, {
      action: "role.create",
      resourceType: "Role",
      resourceId: role.code,
      after: role.toJSON(),
    });
    return role;
  }

  require(tenantId: TenantId, code: string): Role {
    const role = this.roles.byCode(tenantId, code.trim().toLowerCase());
    if (!role) throw new NotFoundError("Role", code);
    return role;
  }

  list(tenantId: TenantId): Role[] {
    return this.roles.list(tenantId);
  }

  async update(
    ctx: CommandContext,
    code: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: readonly string[];
      inheritsFrom?: string | null;
    },
  ): Promise<Role> {
    const role = this.require(ctx.tenantId, code);
    const before = role.toJSON();
    if (patch.inheritsFrom && !this.roles.byCode(ctx.tenantId, patch.inheritsFrom)) {
      throw ValidationError.single("inheritsFrom", `role "${patch.inheritsFrom}" does not exist`);
    }
    // Checked before the aggregate is touched: the in-memory adapter hands out
    // live objects, so a mutation that fails validation would otherwise leave a
    // cyclic role graph behind.
    if (patch.inheritsFrom !== undefined) {
      this.assertParentIsReachable(ctx.tenantId, role.code, patch.inheritsFrom ?? undefined);
    }
    role.update(patch);
    this.roles.save(role);
    this.assertGraphIsAcyclic(ctx.tenantId, role.code);

    await this.outbox.publish(role.pullEvents());
    this.audit.record(ctx, {
      action: "role.update",
      resourceType: "Role",
      resourceId: role.code,
      before,
      after: role.toJSON(),
    });
    return role;
  }

  async remove(ctx: CommandContext, code: string): Promise<void> {
    const role = this.require(ctx.tenantId, code);
    if (role.isSystem) throw new ImmutableRecordError("Role", role.code);

    const holders = this.users
      .list(ctx.tenantId)
      .filter((user) => user.roles.includes(role.code) && user.status !== "deactivated");
    if (holders.length > 0) {
      throw new InvalidStateError(
        `Role ${role.code} is still assigned to ${holders.length} user(s)`,
        { users: holders.map((user) => user.email).slice(0, 10) },
      );
    }
    const dependents = this.roles
      .list(ctx.tenantId)
      .filter((other) => other.inheritsFrom === role.code);
    if (dependents.length > 0) {
      throw new InvalidStateError(
        `Role ${role.code} is inherited by ${dependents.map((r) => r.code).join(", ")}`,
      );
    }

    this.roles.remove(ctx.tenantId, role.code);
    this.audit.record(ctx, {
      action: "role.delete",
      resourceType: "Role",
      resourceId: role.code,
      before: role.toJSON(),
    });
  }

  /** Copies a system role into an editable custom role. */
  async clone(ctx: CommandContext, source: string, code: string, name: string): Promise<Role> {
    const original = this.require(ctx.tenantId, source);
    return this.create(ctx, {
      code,
      name,
      description: `Copied from ${original.code}`,
      permissions: [...original.permissions],
      inheritsFrom: original.inheritsFrom,
    });
  }

  effectivePermissions(tenantId: TenantId, code: string): Permission[] {
    return [...resolveRolePermissions(code, this.roles.map(tenantId))].sort();
  }

  permissionsForUser(tenantId: TenantId, roleCodes: readonly string[]): Set<Permission> {
    return permissionsForRoles(roleCodes, this.roles.map(tenantId));
  }

  can(tenantId: TenantId, roleCodes: readonly string[], permission: Permission): boolean {
    return hasPermission(this.permissionsForUser(tenantId, roleCodes), permission);
  }

  /** Roles a tenant may assign, with their resolved permission sets. */
  matrix(tenantId: TenantId): {
    code: string;
    name: string;
    system: boolean;
    inheritsFrom?: string;
    permissions: Permission[];
    userCount: number;
  }[] {
    const users = this.users.list(tenantId);
    return this.roles.list(tenantId).map((role) => ({
      code: role.code,
      name: role.name,
      system: role.isSystem,
      inheritsFrom: role.inheritsFrom,
      permissions: this.effectivePermissions(tenantId, role.code),
      userCount: users.filter((user) => user.roles.includes(role.code)).length,
    }));
  }

  private assertGraphIsAcyclic(tenantId: TenantId, code: string): void {
    // resolveRolePermissions throws InvalidStateError on a cycle.
    resolveRolePermissions(code, this.roles.map(tenantId));
  }

  /**
   * Walks up from the proposed parent to see whether `code` is already an
   * ancestor, which is the only way an edit can close a cycle.
   */
  private assertParentIsReachable(
    tenantId: TenantId,
    code: string,
    parent: string | undefined,
  ): void {
    if (!parent) return;
    const roles = this.roles.map(tenantId);
    const chain: string[] = [code];
    let cursor: string | undefined = parent;
    while (cursor) {
      if (chain.includes(cursor)) {
        throw new InvalidStateError(
          `Role inheritance cycle: ${[...chain, cursor].join(" -> ")}`,
          { chain: [...chain, cursor] },
        );
      }
      chain.push(cursor);
      cursor = roles.get(cursor)?.inheritsFrom;
    }
  }
}
