import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError } from "../domain/errors.js";
import { PortalUser, type PortalRole } from "../domain/portal-user.js";
import type {
  Clock,
  OutboxPort,
  PartnerRepository,
  PortalUserFilter,
  PortalUserRepository,
  TokenIssuer,
} from "./ports.js";

export interface InvitePortalUserCommand {
  readonly partnerId: Ulid;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly jobTitle?: string;
  readonly phone?: string;
  readonly roles: readonly PortalRole[];
  readonly locale?: string;
  readonly inviteValidDays?: number;
}

/**
 * Portal user administration.
 *
 * The rule that spans the aggregate: a partner must always keep at least one
 * usable portal administrator. Removing the role from the last admin, or
 * disabling them, is refused — otherwise the partner locks itself out and
 * needs vendor-side intervention to invite anyone again.
 */
export class PortalService {
  constructor(
    private readonly users: PortalUserRepository,
    private readonly partners: PartnerRepository,
    private readonly tokens: TokenIssuer,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async invite(ctx: TenantContext, command: InvitePortalUserCommand): Promise<PortalUser> {
    const partner = await this.partners.byId(ctx.tenantId, command.partnerId);
    if (!partner) throw new NotFoundError("Partner", command.partnerId);
    if (partner.status === "terminated" || partner.status === "rejected") {
      throw new InvalidStateError(`${partner.number} is ${partner.status}; portal access is closed`);
    }
    const existing = await this.users.byEmail(ctx.tenantId, command.email);
    if (existing) {
      throw new ConflictError(`${existing.email} already has a portal account`);
    }
    const user = PortalUser.invite(ctx.tenantId, {
      ...command,
      at: this.clock.now(),
      by: ctx.userId,
      inviteTokenRef: this.tokens.issue("portal-invite"),
    });
    await this.commit(user);
    return user;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<PortalUser> {
    const user = await this.users.byId(ctx.tenantId, id);
    if (!user) throw new NotFoundError("PortalUser", id);
    return user;
  }

  async byEmail(ctx: TenantContext, email: string): Promise<PortalUser> {
    const user = await this.users.byEmail(ctx.tenantId, email);
    if (!user) throw new NotFoundError("PortalUser", email);
    return user;
  }

  async list(ctx: TenantContext, filter: PortalUserFilter, page?: Partial<PageRequest>): Promise<Page<PortalUser>> {
    return this.users.list(ctx.tenantId, filter, normalizePage(page));
  }

  async forPartner(ctx: TenantContext, partnerId: Ulid): Promise<readonly PortalUser[]> {
    return this.users.byPartner(ctx.tenantId, partnerId);
  }

  async resendInvite(ctx: TenantContext, id: Ulid, validDays?: number): Promise<PortalUser> {
    const user = await this.get(ctx, id);
    user.resendInvite({
      at: this.clock.now(),
      inviteTokenRef: this.tokens.issue("portal-invite"),
      validDays,
    });
    await this.commit(user);
    return user;
  }

  async acceptInvite(ctx: TenantContext, id: Ulid): Promise<PortalUser> {
    const user = await this.get(ctx, id);
    user.acceptInvite(this.clock.now());
    await this.commit(user);
    return user;
  }

  async updateProfile(
    ctx: TenantContext,
    id: Ulid,
    input: Parameters<PortalUser["updateProfile"]>[0],
  ): Promise<PortalUser> {
    const user = await this.get(ctx, id);
    user.updateProfile(input);
    await this.commit(user);
    return user;
  }

  async setRoles(ctx: TenantContext, id: Ulid, roles: readonly PortalRole[]): Promise<PortalUser> {
    const user = await this.get(ctx, id);
    if (user.hasRole("portal_admin") && !roles.includes("portal_admin")) {
      await this.assertNotLastAdmin(ctx, user, "remove the portal_admin role from");
    }
    user.setRoles(roles);
    await this.commit(user);
    return user;
  }

  async recordLogin(ctx: TenantContext, id: Ulid): Promise<PortalUser> {
    const user = await this.get(ctx, id);
    user.recordLogin(this.clock.now());
    await this.commit(user);
    return user;
  }

  async disable(ctx: TenantContext, id: Ulid, reason: string): Promise<PortalUser> {
    const user = await this.get(ctx, id);
    if (user.hasRole("portal_admin")) {
      await this.assertNotLastAdmin(ctx, user, "disable");
    }
    user.disable({ at: this.clock.now(), reason });
    await this.commit(user);
    return user;
  }

  async enable(ctx: TenantContext, id: Ulid): Promise<PortalUser> {
    const user = await this.get(ctx, id);
    user.enable(this.clock.now());
    await this.commit(user);
    return user;
  }

  /** Disables every portal account of a partner (suspension or termination). */
  async disableAllForPartner(ctx: TenantContext, partnerId: Ulid, reason: string): Promise<number> {
    const users = await this.users.byPartner(ctx.tenantId, partnerId);
    let disabled = 0;
    for (const user of users) {
      if (user.status === "disabled") continue;
      user.disable({ at: this.clock.now(), reason });
      await this.commit(user);
      disabled += 1;
    }
    return disabled;
  }

  private async assertNotLastAdmin(ctx: TenantContext, user: PortalUser, action: string): Promise<void> {
    const peers = await this.users.byPartner(ctx.tenantId, user.partnerId);
    const otherAdmins = peers.filter(
      (u) => u.id !== user.id && u.hasRole("portal_admin") && u.status !== "disabled",
    );
    if (otherAdmins.length === 0) {
      throw new InvalidStateError(
        `Cannot ${action} ${user.email}: a partner must keep at least one portal administrator`,
      );
    }
  }

  private async commit(user: PortalUser): Promise<void> {
    await this.users.save(user);
    await this.outbox.publish(user.pullEvents());
  }
}
