import {
  NotFoundError,
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { DuplicateError, InvalidStateError, ValidationError } from "../domain/errors.js";
import { AdminUser, normalizeEmail } from "../domain/user.js";
import type { AuditService } from "./audit-service.js";
import type { RoleService } from "./role-service.js";
import type { TenantService } from "./tenant-service.js";
import type {
  Clock,
  CommandContext,
  Outbox,
  SecretGenerator,
  UserRepository,
} from "./ports.js";

/**
 * Membership administration: invitations, lifecycle and role assignment.
 *
 * Two rules exist to stop an administrator locking a tenant out of itself:
 * the last user holding an admin role cannot be deactivated or demoted, and
 * roles must exist in the tenant before they can be assigned.
 */

export interface InviteUserRequest {
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly attributes?: Readonly<Record<string, string>>;
  readonly inviteTtlMs?: number;
}

export interface InviteResult {
  readonly user: AdminUser;
  /** Returned once, at invitation time; never stored in a response again. */
  readonly inviteToken: string;
}

const ADMIN_PERMISSION = "user:write" as const;

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly roleService: RoleService,
    private readonly tenantService: TenantService,
    private readonly secrets: SecretGenerator,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async invite(ctx: CommandContext, input: InviteUserRequest): Promise<InviteResult> {
    const tenant = this.tenantService.requireOperational(ctx.tenantId);
    const email = normalizeEmail(input.email);
    if (this.users.byEmail(ctx.tenantId, email)) {
      throw new DuplicateError("User", "email", email);
    }
    tenant.assertWithinQuota("users", this.users.count(ctx.tenantId));
    this.assertRolesExist(ctx.tenantId, input.roles);

    const inviteToken = this.secrets.generate(24);
    const user = AdminUser.invite(ctx.tenantId, {
      email,
      displayName: input.displayName,
      roles: input.roles,
      invitedBy: ctx.actor,
      invitedAt: this.clock.now(),
      inviteToken,
      inviteTtlMs: input.inviteTtlMs,
      attributes: input.attributes,
    });
    this.users.save(user);

    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.invite",
      resourceType: "AdminUser",
      resourceId: email,
      after: user.toPublicJSON(),
    });
    return { user, inviteToken };
  }

  require(tenantId: TenantId, idOrEmail: string): AdminUser {
    const user =
      this.users.byId(tenantId, idOrEmail as Ulid) ??
      (idOrEmail.includes("@")
        ? this.users.byEmail(tenantId, idOrEmail.trim().toLowerCase())
        : undefined);
    if (!user) throw new NotFoundError("AdminUser", idOrEmail);
    return user;
  }

  list(
    tenantId: TenantId,
    filter: { status?: string; role?: string; search?: string } = {},
  ): AdminUser[] {
    return this.users.list(tenantId, filter);
  }

  page(
    tenantId: TenantId,
    filter: { status?: string; role?: string; search?: string },
    page?: Partial<PageRequest>,
  ): Page<AdminUser> {
    const request: PageRequest = normalizePage(page);
    return paginate(this.users.list(tenantId, filter), request);
  }

  async acceptInvite(ctx: CommandContext, idOrEmail: string, token: string): Promise<AdminUser> {
    const user = this.require(ctx.tenantId, idOrEmail);
    user.acceptInvite(token, this.clock.now());
    this.users.save(user);
    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.accept-invite",
      resourceType: "AdminUser",
      resourceId: user.email,
      after: user.toPublicJSON(),
    });
    return user;
  }

  async reissueInvite(ctx: CommandContext, idOrEmail: string): Promise<InviteResult> {
    const user = this.require(ctx.tenantId, idOrEmail);
    const inviteToken = this.secrets.generate(24);
    user.reissueInvite(inviteToken, this.clock.now());
    this.users.save(user);
    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.reissue-invite",
      resourceType: "AdminUser",
      resourceId: user.email,
    });
    return { user, inviteToken };
  }

  async suspend(ctx: CommandContext, idOrEmail: string, reason: string): Promise<AdminUser> {
    const user = this.require(ctx.tenantId, idOrEmail);
    this.assertNotLastAdmin(ctx.tenantId, user, "suspend");
    const before = user.toPublicJSON();
    user.suspend(reason, this.clock.now());
    this.users.save(user);
    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.suspend",
      resourceType: "AdminUser",
      resourceId: user.email,
      before,
      after: user.toPublicJSON(),
      reason,
    });
    return user;
  }

  async reinstate(ctx: CommandContext, idOrEmail: string): Promise<AdminUser> {
    const user = this.require(ctx.tenantId, idOrEmail);
    user.reinstate(this.clock.now());
    this.users.save(user);
    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.reinstate",
      resourceType: "AdminUser",
      resourceId: user.email,
      after: user.toPublicJSON(),
    });
    return user;
  }

  async deactivate(ctx: CommandContext, idOrEmail: string): Promise<AdminUser> {
    const user = this.require(ctx.tenantId, idOrEmail);
    this.assertNotLastAdmin(ctx.tenantId, user, "deactivate");
    const before = user.toPublicJSON();
    user.deactivate(this.clock.now());
    this.users.save(user);
    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.deactivate",
      resourceType: "AdminUser",
      resourceId: user.email,
      before,
      after: user.toPublicJSON(),
    });
    return user;
  }

  async assignRoles(
    ctx: CommandContext,
    idOrEmail: string,
    roles: readonly string[],
  ): Promise<AdminUser> {
    const user = this.require(ctx.tenantId, idOrEmail);
    this.assertRolesExist(ctx.tenantId, roles);
    const keepsAdmin = this.roleService.can(ctx.tenantId, roles, ADMIN_PERMISSION);
    if (!keepsAdmin) this.assertNotLastAdmin(ctx.tenantId, user, "demote");

    const before = user.toPublicJSON();
    user.assignRoles(roles);
    this.users.save(user);
    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.assign-roles",
      resourceType: "AdminUser",
      resourceId: user.email,
      before,
      after: user.toPublicJSON(),
    });
    return user;
  }

  async updateProfile(
    ctx: CommandContext,
    idOrEmail: string,
    patch: { displayName?: string; mfaEnabled?: boolean; attributes?: Record<string, string> },
  ): Promise<AdminUser> {
    const user = this.require(ctx.tenantId, idOrEmail);
    const before = user.toPublicJSON();
    user.updateProfile(patch);
    this.users.save(user);
    await this.outbox.publish(user.pullEvents());
    this.audit.record(ctx, {
      action: "user.update-profile",
      resourceType: "AdminUser",
      resourceId: user.email,
      before,
      after: user.toPublicJSON(),
    });
    return user;
  }

  /** Permission set a user actually holds, following role inheritance. */
  effectivePermissions(tenantId: TenantId, idOrEmail: string): string[] {
    const user = this.require(tenantId, idOrEmail);
    return [...this.roleService.permissionsForUser(tenantId, user.roles)].sort();
  }

  /** Invitations past their expiry, for the console's "needs attention" list. */
  expiredInvitations(tenantId: TenantId): AdminUser[] {
    const now = this.clock.now();
    return this.users
      .list(tenantId, { status: "invited" })
      .filter((user) => user.isInviteExpired(now));
  }

  private assertRolesExist(tenantId: TenantId, roles: readonly string[]): void {
    const missing = roles
      .map((role) => role.trim().toLowerCase())
      .filter((role) => !this.roleService.list(tenantId).some((known) => known.code === role));
    if (missing.length > 0) {
      throw ValidationError.from(
        missing.map((role) => ({ field: "roles", message: `role "${role}" does not exist` })),
      );
    }
  }

  /** Refuses a change that would leave the tenant with no acting administrator. */
  private assertNotLastAdmin(tenantId: TenantId, user: AdminUser, operation: string): void {
    const isAdmin = this.roleService.can(tenantId, user.roles, ADMIN_PERMISSION);
    if (!isAdmin) return;
    const otherAdmins = this.users
      .list(tenantId)
      .filter(
        (other) =>
          other.id !== user.id &&
          other.status === "active" &&
          this.roleService.can(tenantId, other.roles, ADMIN_PERMISSION),
      );
    if (otherAdmins.length === 0) {
      throw new InvalidStateError(
        `Cannot ${operation} ${user.email}: it is the last active administrator of the tenant`,
      );
    }
  }
}
