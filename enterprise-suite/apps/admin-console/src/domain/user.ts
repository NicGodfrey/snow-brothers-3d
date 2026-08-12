import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError } from "./errors.js";
import { AdminEventTypes } from "./events.js";

/**
 * Admin user aggregate.
 *
 * The console does not store credentials — identity-access owns those. What it
 * owns is the tenant-scoped membership record: who was invited, by whom, which
 * roles they hold, and whether the account may act right now.
 *
 * `invited → active ⇄ suspended → deactivated`. An invitation expires on a
 * clock the aggregate checks rather than a background job, so a stale link
 * fails closed even if the sweeper never ran.
 */

export const USER_STATUSES = ["invited", "active", "suspended", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  invited: ["active", "deactivated"],
  active: ["suspended", "deactivated"],
  suspended: ["active", "deactivated"],
  deactivated: [],
};

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface UserProps {
  email: string;
  displayName: string;
  status: UserStatus;
  roles: string[];
  invitedBy: string;
  invitedAt: IsoDateTime;
  inviteExpiresAt: IsoDateTime;
  inviteToken?: string;
  activatedAt?: IsoDateTime;
  lastLoginAt?: IsoDateTime;
  suspensionReason?: string;
  mfaEnabled: boolean;
  attributes: Record<string, string>;
}

export interface InviteUserInput {
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly invitedBy: string;
  readonly invitedAt: IsoDateTime;
  readonly inviteToken: string;
  readonly inviteTtlMs?: number;
  readonly attributes?: Readonly<Record<string, string>>;
}

export class AdminUser extends AggregateRoot<UserProps> {
  static invite(
    tenantId: TenantId,
    input: InviteUserInput,
    existing?: Partial<EntityProps>,
  ): AdminUser {
    const email = normalizeEmail(input.email);
    if (input.displayName.trim().length === 0) {
      throw ValidationError.single("displayName", "is required");
    }
    if (input.roles.length === 0) {
      throw ValidationError.single("roles", "at least one role must be assigned");
    }
    const expiresAt = new Date(
      Date.parse(input.invitedAt) + (input.inviteTtlMs ?? INVITE_TTL_MS),
    ).toISOString() as IsoDateTime;

    const user = new AdminUser(
      tenantId,
      {
        email,
        displayName: input.displayName.trim(),
        status: "invited",
        roles: dedupeRoles(input.roles),
        invitedBy: input.invitedBy,
        invitedAt: input.invitedAt,
        inviteExpiresAt: expiresAt,
        inviteToken: input.inviteToken,
        mfaEnabled: false,
        attributes: { ...(input.attributes ?? {}) },
      },
      existing,
    );
    user.raise(
      envelope({
        eventType: AdminEventTypes.userInvited,
        aggregateType: "AdminUser",
        aggregateId: user.id,
        tenantId,
        payload: { email, roles: user.props.roles, invitedBy: input.invitedBy, expiresAt },
      }),
    );
    return user;
  }

  get email(): string {
    return this.props.email;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get status(): UserStatus {
    return this.props.status;
  }
  get roles(): readonly string[] {
    return this.props.roles;
  }
  get mfaEnabled(): boolean {
    return this.props.mfaEnabled;
  }
  get inviteExpiresAt(): IsoDateTime {
    return this.props.inviteExpiresAt;
  }
  get attributes(): Readonly<Record<string, string>> {
    return this.props.attributes;
  }

  /** Only an active user may act; everything else is refused at the edge. */
  get canAct(): boolean {
    return this.props.status === "active";
  }

  isInviteExpired(now: IsoDateTime): boolean {
    return this.props.status === "invited" && Date.parse(now) > Date.parse(this.props.inviteExpiresAt);
  }

  acceptInvite(token: string, now: IsoDateTime): void {
    if (this.props.status !== "invited") {
      throw new InvalidStateError(`User ${this.props.email} has already accepted their invitation`);
    }
    if (this.isInviteExpired(now)) {
      throw new InvalidStateError(`The invitation for ${this.props.email} expired`, {
        expiredAt: this.props.inviteExpiresAt,
      });
    }
    if (!this.props.inviteToken || this.props.inviteToken !== token) {
      throw new InvalidStateError("Invitation token does not match");
    }
    this.transition("active");
    this.props.activatedAt = now;
    this.props.inviteToken = undefined;
    this.raise(
      envelope({
        eventType: AdminEventTypes.userActivated,
        aggregateType: "AdminUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, activatedAt: now },
      }),
    );
  }

  /** Re-issues an invitation, extending the window from `now`. */
  reissueInvite(token: string, now: IsoDateTime, ttlMs = INVITE_TTL_MS): void {
    if (this.props.status !== "invited") {
      throw new InvalidStateError(`User ${this.props.email} is not awaiting an invitation`);
    }
    this.props.inviteToken = token;
    this.props.invitedAt = now;
    this.props.inviteExpiresAt = new Date(Date.parse(now) + ttlMs).toISOString() as IsoDateTime;
    this.raise(
      envelope({
        eventType: AdminEventTypes.userInvited,
        aggregateType: "AdminUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          email: this.props.email,
          roles: this.props.roles,
          invitedBy: this.props.invitedBy,
          expiresAt: this.props.inviteExpiresAt,
          reissued: true,
        },
      }),
    );
  }

  suspend(reason: string, now: IsoDateTime): void {
    if (reason.trim().length === 0) {
      throw ValidationError.single("reason", "a suspension reason is required");
    }
    this.transition("suspended");
    this.props.suspensionReason = reason.trim();
    this.raise(
      envelope({
        eventType: AdminEventTypes.userSuspended,
        aggregateType: "AdminUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, reason: this.props.suspensionReason, at: now },
      }),
    );
  }

  reinstate(now: IsoDateTime): void {
    if (this.props.status !== "suspended") {
      throw new InvalidStateError(`User ${this.props.email} is not suspended`);
    }
    this.transition("active");
    this.props.suspensionReason = undefined;
    this.raise(
      envelope({
        eventType: AdminEventTypes.userReinstated,
        aggregateType: "AdminUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, at: now },
      }),
    );
  }

  deactivate(now: IsoDateTime): void {
    this.transition("deactivated");
    this.props.inviteToken = undefined;
    this.raise(
      envelope({
        eventType: AdminEventTypes.userDeactivated,
        aggregateType: "AdminUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, at: now },
      }),
    );
  }

  assignRoles(roles: readonly string[]): void {
    if (this.props.status === "deactivated") {
      throw new InvalidStateError(`User ${this.props.email} is deactivated`);
    }
    if (roles.length === 0) {
      throw ValidationError.single("roles", "at least one role must be assigned");
    }
    const next = dedupeRoles(roles);
    const previous = this.props.roles;
    if (sameRoles(previous, next)) return;
    this.props.roles = next;
    this.raise(
      envelope({
        eventType: AdminEventTypes.userRolesChanged,
        aggregateType: "AdminUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, from: previous, to: next },
      }),
    );
  }

  updateProfile(patch: {
    displayName?: string;
    mfaEnabled?: boolean;
    attributes?: Readonly<Record<string, string>>;
  }): void {
    if (this.props.status === "deactivated") {
      throw new InvalidStateError(`User ${this.props.email} is deactivated`);
    }
    if (patch.displayName !== undefined) {
      if (patch.displayName.trim().length === 0) {
        throw ValidationError.single("displayName", "is required");
      }
      this.props.displayName = patch.displayName.trim();
    }
    if (patch.mfaEnabled !== undefined) this.props.mfaEnabled = patch.mfaEnabled;
    if (patch.attributes !== undefined) {
      this.props.attributes = { ...this.props.attributes, ...patch.attributes };
    }
    this.raise(
      envelope({
        eventType: AdminEventTypes.userProfileUpdated,
        aggregateType: "AdminUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          email: this.props.email,
          displayName: this.props.displayName,
          mfaEnabled: this.props.mfaEnabled,
        },
      }),
    );
  }

  recordLogin(at: IsoDateTime): void {
    if (!this.canAct) throw new InvalidStateError(`User ${this.props.email} cannot sign in`);
    this.props.lastLoginAt = at;
    this.touch();
  }

  /** Invite tokens never leave the aggregate in API responses. */
  toPublicJSON(): Record<string, unknown> {
    const { inviteToken, ...rest } = this.toJSON();
    void inviteToken;
    return { ...rest, inviteTokenPresent: this.props.inviteToken !== undefined };
  }

  private transition(to: UserStatus): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new InvalidStateError(
        `User ${this.props.email} cannot move from ${this.props.status} to ${to}`,
        { from: this.props.status, to, allowed: TRANSITIONS[this.props.status] },
      );
    }
    this.props.status = to;
  }
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw ValidationError.single("email", `"${value}" is not a valid address`);
  }
  return email;
}

function dedupeRoles(roles: readonly string[]): string[] {
  return [...new Set(roles.map((role) => role.trim().toLowerCase()).filter(Boolean))].sort();
}

function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((role, index) => role === b[index]);
}
