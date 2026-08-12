import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { addDays, isAfter, parseIso } from "./dates.js";
import { InvalidStateError, ValidationError, type ValidationIssue } from "./errors.js";
import { PrmEventTypes } from "./events.js";

/**
 * A named person at a partner who can sign in to the partner portal.
 *
 *   invited → active ⇄ disabled
 *
 * Portal users are the subject of entitlement checks: what someone may do in
 * the portal is a function of their roles, their partner's tier and contract
 * state, and the certifications they personally hold. The aggregate owns the
 * identity and role set; entitlement resolution lives in entitlement.ts so it
 * stays a pure function over facts.
 */

export type PortalRole =
  | "portal_admin"
  | "sales_rep"
  | "marketing_manager"
  | "technical_lead"
  | "finance"
  | "support_agent";

export const PORTAL_ROLES: readonly PortalRole[] = [
  "portal_admin",
  "sales_rep",
  "marketing_manager",
  "technical_lead",
  "finance",
  "support_agent",
];

export type PortalUserStatus = "invited" | "active" | "disabled";

export const PORTAL_USER_STATUSES: readonly PortalUserStatus[] = ["invited", "active", "disabled"];

export interface PortalUserProps {
  partnerId: Ulid;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  phone?: string;
  status: PortalUserStatus;
  roles: PortalRole[];
  locale: string;
  invitedAt: IsoDateTime;
  invitedBy: UserId;
  inviteExpiresAt: IsoDateTime;
  /** Opaque handle for the invite mail; the token itself never lands here. */
  inviteTokenRef: string;
  inviteResends: number;
  activatedAt?: IsoDateTime;
  lastLoginAt?: IsoDateTime;
  loginCount: number;
  disabledAt?: IsoDateTime;
  disabledReason?: string;
}

export interface InvitePortalUserInput {
  readonly partnerId: Ulid;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly jobTitle?: string;
  readonly phone?: string;
  readonly roles: readonly PortalRole[];
  readonly locale?: string;
  readonly at: IsoDateTime;
  readonly by: UserId;
  readonly inviteTokenRef: string;
  readonly inviteValidDays?: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRoles(roles: readonly PortalRole[]): PortalRole[] {
  const unique = [...new Set(roles.map((r) => r.trim().toLowerCase() as PortalRole))];
  if (unique.length === 0) throw ValidationError.single("roles", "at least one role is required");
  for (const role of unique) {
    if (!PORTAL_ROLES.includes(role)) {
      throw ValidationError.single("roles", `unknown role "${role}"; expected one of [${PORTAL_ROLES.join(", ")}]`);
    }
  }
  return unique.sort();
}

export class PortalUser extends AggregateRoot<PortalUserProps> {
  static invite(tenantId: TenantId, input: InvitePortalUserInput): PortalUser {
    const issues: ValidationIssue[] = [];
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) issues.push({ field: "email", message: "must be a valid email address" });
    if (input.firstName.trim().length === 0) issues.push({ field: "firstName", message: "is required" });
    if (input.lastName.trim().length === 0) issues.push({ field: "lastName", message: "is required" });
    if (input.inviteTokenRef.trim().length === 0) {
      issues.push({ field: "inviteTokenRef", message: "is required" });
    }
    if (issues.length > 0) throw new ValidationError("Invalid portal user", issues);
    const inviteValidDays = input.inviteValidDays ?? 14;
    if (!Number.isInteger(inviteValidDays) || inviteValidDays < 1 || inviteValidDays > 90) {
      throw ValidationError.single("inviteValidDays", "must be an integer between 1 and 90");
    }
    const at = parseIso(input.at, "at");

    const user = new PortalUser(tenantId, {
      partnerId: input.partnerId,
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      jobTitle: input.jobTitle?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      status: "invited",
      roles: normalizeRoles(input.roles),
      locale: (input.locale ?? "en-US").trim(),
      invitedAt: at,
      invitedBy: input.by,
      inviteExpiresAt: addDays(at, inviteValidDays),
      inviteTokenRef: input.inviteTokenRef.trim(),
      inviteResends: 0,
      loginCount: 0,
    });
    user.raise(user.userEvent(PrmEventTypes.PortalUserInvited));
    return user;
  }

  static fromSnapshot(snapshot: EntityProps & PortalUserProps): PortalUser {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new PortalUser(tenantId, { ...props, roles: [...props.roles] }, { id, createdAt, updatedAt, version });
  }

  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get email(): string {
    return this.props.email;
  }
  get fullName(): string {
    return `${this.props.firstName} ${this.props.lastName}`;
  }
  get status(): PortalUserStatus {
    return this.props.status;
  }
  get roles(): readonly PortalRole[] {
    return this.props.roles;
  }
  get inviteExpiresAt(): IsoDateTime {
    return this.props.inviteExpiresAt;
  }
  get lastLoginAt(): IsoDateTime | undefined {
    return this.props.lastLoginAt;
  }
  get loginCount(): number {
    return this.props.loginCount;
  }
  get disabledReason(): string | undefined {
    return this.props.disabledReason;
  }

  hasRole(role: PortalRole): boolean {
    return this.props.roles.includes(role);
  }

  isSignedIn(): boolean {
    return this.props.status === "active";
  }

  /** Redeems the invite. Expired invites must be resent, not force-accepted. */
  acceptInvite(at: IsoDateTime): void {
    if (this.props.status !== "invited") {
      throw new InvalidStateError(`${this.props.email} is ${this.props.status}, not invited`);
    }
    const now = parseIso(at, "at");
    if (isAfter(now, this.props.inviteExpiresAt)) {
      throw new InvalidStateError(
        `The invite for ${this.props.email} expired on ${this.props.inviteExpiresAt}; send a new one`,
        { inviteExpiresAt: this.props.inviteExpiresAt },
      );
    }
    this.props.status = "active";
    this.props.activatedAt = now;
    this.raise(this.userEvent(PrmEventTypes.PortalUserActivated));
  }

  resendInvite(input: { readonly at: IsoDateTime; readonly inviteTokenRef: string; readonly validDays?: number }): void {
    if (this.props.status !== "invited") {
      throw new InvalidStateError(`${this.props.email} has already accepted the invite`);
    }
    if (input.inviteTokenRef.trim().length === 0) {
      throw ValidationError.single("inviteTokenRef", "is required");
    }
    const at = parseIso(input.at, "at");
    this.props.inviteTokenRef = input.inviteTokenRef.trim();
    this.props.inviteExpiresAt = addDays(at, input.validDays ?? 14);
    this.props.inviteResends += 1;
    this.touch();
  }

  updateProfile(input: {
    readonly firstName?: string;
    readonly lastName?: string;
    readonly jobTitle?: string;
    readonly phone?: string;
    readonly locale?: string;
  }): void {
    if (this.props.status === "disabled") {
      throw new InvalidStateError(`${this.props.email} is disabled`);
    }
    if (input.firstName !== undefined) {
      if (input.firstName.trim().length === 0) throw ValidationError.single("firstName", "is required");
      this.props.firstName = input.firstName.trim();
    }
    if (input.lastName !== undefined) {
      if (input.lastName.trim().length === 0) throw ValidationError.single("lastName", "is required");
      this.props.lastName = input.lastName.trim();
    }
    if (input.jobTitle !== undefined) this.props.jobTitle = input.jobTitle.trim() || undefined;
    if (input.phone !== undefined) this.props.phone = input.phone.trim() || undefined;
    if (input.locale !== undefined) this.props.locale = input.locale.trim() || this.props.locale;
    this.touch();
  }

  setRoles(roles: readonly PortalRole[]): void {
    if (this.props.status === "disabled") {
      throw new InvalidStateError(`Cannot change roles: ${this.props.email} is disabled`);
    }
    const next = normalizeRoles(roles);
    const previous = [...this.props.roles];
    if (next.join(",") === previous.join(",")) return;
    this.props.roles = next;
    this.raise(
      envelope({
        eventType: PrmEventTypes.PortalUserRolesChanged,
        aggregateType: "PortalUser",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          portalUserId: this.id,
          partnerId: this.props.partnerId,
          email: this.props.email,
          roles: next,
          previousRoles: previous,
        },
      }),
    );
  }

  recordLogin(at: IsoDateTime): void {
    if (this.props.status !== "active") {
      throw new InvalidStateError(`${this.props.email} is ${this.props.status} and cannot sign in`);
    }
    this.props.lastLoginAt = parseIso(at, "at");
    this.props.loginCount += 1;
    this.touch();
  }

  disable(input: { readonly at: IsoDateTime; readonly reason: string }): void {
    if (this.props.status === "disabled") {
      throw new InvalidStateError(`${this.props.email} is already disabled`);
    }
    if (input.reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.status = "disabled";
    this.props.disabledAt = parseIso(input.at, "at");
    this.props.disabledReason = input.reason.trim();
    this.raise(this.userEvent(PrmEventTypes.PortalUserDisabled));
  }

  /** Re-enables a disabled user; someone who never accepted goes back to invited. */
  enable(at: IsoDateTime): void {
    if (this.props.status !== "disabled") {
      throw new InvalidStateError(`${this.props.email} is ${this.props.status}, not disabled`);
    }
    this.props.status = this.props.activatedAt ? "active" : "invited";
    this.props.disabledAt = undefined;
    this.props.disabledReason = undefined;
    if (this.props.status === "invited") {
      this.props.inviteExpiresAt = addDays(parseIso(at, "at"), 14);
    }
    this.raise(this.userEvent(PrmEventTypes.PortalUserReenabled));
  }

  private userEvent(eventType: string) {
    return envelope({
      eventType,
      aggregateType: "PortalUser",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        portalUserId: this.id,
        partnerId: this.props.partnerId,
        email: this.props.email,
        roles: [...this.props.roles],
      },
    });
  }
}
