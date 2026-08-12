import {
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { checkPasswordComplexity, type PasswordPolicy } from "../domain/credential.js";
import { IDENTITY_ERROR, IdentityError, ValidationError } from "../domain/errors.js";
import { User, email as toEmail, type MfaEnrollment, type MfaMethod } from "../domain/user.js";
import type { UserFilter } from "./ports.js";
import type {
  AuditRepository,
  Clock,
  EventPublisher,
  PasswordHasher,
  SecretHasher,
  SessionRepository,
  UserRepository,
} from "./ports.js";
import { AuditEntry } from "../domain/audit.js";
import { userSubject } from "../domain/subject.js";
import type { TenantService } from "./tenant-service.js";

export interface InviteUserInput {
  readonly email: string;
  readonly displayName: string;
  readonly invitedBy?: Ulid;
  readonly attributes?: Record<string, string>;
}

export interface SetPasswordInput {
  readonly userId: Ulid;
  readonly password: string;
  readonly actorId?: Ulid;
  /** Force a change at next sign-in, used when an admin sets a temporary password. */
  readonly mustChangeNext?: boolean;
}

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly tenants: TenantService,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditRepository,
    private readonly hasher: PasswordHasher,
    private readonly secrets: SecretHasher,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  invite(tenantId: TenantId, input: InviteUserInput): User {
    const tenant = this.tenants.requireActive(tenantId);
    const normalized = toEmail(input.email);
    if (!tenant.allowsEmail(normalized)) {
      throw new IdentityError(
        `Email domain of "${normalized}" is not allowed for tenant ${tenant.slug}`,
        IDENTITY_ERROR.emailDomainNotAllowed,
        422,
      );
    }
    if (this.users.byEmail(tenantId, normalized)) {
      throw new IdentityError(
        `Email "${normalized}" is already registered`,
        IDENTITY_ERROR.emailTaken,
        409,
      );
    }
    const user = User.invite({
      tenantId,
      email: normalized,
      displayName: input.displayName,
      invitedBy: input.invitedBy,
      attributes: input.attributes,
      now: this.clock.now(),
    });
    this.persist(user);
    this.recordAdmin(tenantId, "admin.user.invited", user.id, input.invitedBy, {
      email: normalized,
    });
    return user;
  }

  get(tenantId: TenantId, userId: Ulid): User {
    const user = this.users.byId(tenantId, userId);
    if (!user) throw new NotFoundError("User", userId);
    return user;
  }

  findByEmail(tenantId: TenantId, email: string): User | undefined {
    return this.users.byEmail(tenantId, email.trim().toLowerCase());
  }

  list(tenantId: TenantId, filter?: UserFilter): readonly User[] {
    return this.users.list(tenantId, filter);
  }

  page(tenantId: TenantId, request?: Partial<PageRequest>, filter?: UserFilter): Page<User> {
    return this.users.page(tenantId, normalizePage(request), filter);
  }

  /** Completes an invitation: validates the password against tenant policy, then activates. */
  activate(tenantId: TenantId, input: SetPasswordInput): User {
    const user = this.get(tenantId, input.userId);
    const policy = this.tenants.settings(tenantId).passwordPolicy;
    this.assertPasswordAcceptable(input.password, policy);
    user.activateWithPassword(this.hasher.hash(input.password, this.clock.now()), this.clock.now());
    this.persist(user);
    this.recordAdmin(tenantId, "admin.user.activated", user.id, input.actorId);
    return user;
  }

  setPassword(tenantId: TenantId, input: SetPasswordInput): User {
    const user = this.get(tenantId, input.userId);
    const policy = this.tenants.settings(tenantId).passwordPolicy;
    this.assertPasswordAcceptable(input.password, policy);
    const historyMatches = this.matchesHistory(user, input.password, policy);
    user.setPassword(this.hasher.hash(input.password, this.clock.now()), policy, {
      historyMatches,
      mustChangeNext: input.mustChangeNext,
    });
    this.persist(user);
    this.recordAdmin(tenantId, "admin.user.password_set", user.id, input.actorId);
    return user;
  }

  /** Self-service change: the current password must verify first. */
  changePassword(
    tenantId: TenantId,
    input: { userId: Ulid; currentPassword: string; newPassword: string },
  ): User {
    const user = this.get(tenantId, input.userId);
    const current = user.password;
    if (!current) {
      throw new IdentityError(
        "User has no password set; complete the invitation instead",
        IDENTITY_ERROR.credentialMissing,
        409,
      );
    }
    if (!this.hasher.verify(input.currentPassword, current)) {
      throw new IdentityError(
        "Current password is incorrect",
        IDENTITY_ERROR.invalidCredentials,
        401,
      );
    }
    const result = this.setPassword(tenantId, { userId: input.userId, password: input.newPassword });
    this.revokeSessionsFor(tenantId, input.userId, "password_changed");
    return result;
  }

  suspend(tenantId: TenantId, userId: Ulid, reason: string, actorId?: Ulid): User {
    const user = this.get(tenantId, userId);
    user.suspend(reason);
    this.persist(user);
    this.revokeSessionsFor(tenantId, userId, "user_suspended");
    this.recordAdmin(tenantId, "admin.user.suspended", user.id, actorId, { reason });
    return user;
  }

  reactivate(tenantId: TenantId, userId: Ulid, actorId?: Ulid): User {
    const user = this.get(tenantId, userId);
    user.reactivate();
    this.persist(user);
    this.recordAdmin(tenantId, "admin.user.reactivated", user.id, actorId);
    return user;
  }

  deactivate(tenantId: TenantId, userId: Ulid, reason: string, actorId?: Ulid): User {
    const user = this.get(tenantId, userId);
    user.deactivate(reason);
    this.persist(user);
    this.revokeSessionsFor(tenantId, userId, "user_deactivated");
    this.recordAdmin(tenantId, "admin.user.deactivated", user.id, actorId, { reason });
    return user;
  }

  unlock(tenantId: TenantId, userId: Ulid, actorId?: Ulid): User {
    const user = this.get(tenantId, userId);
    user.unlock();
    this.persist(user);
    this.recordAdmin(tenantId, "admin.user.unlocked", user.id, actorId);
    return user;
  }

  rename(tenantId: TenantId, userId: Ulid, displayName: string): User {
    const user = this.get(tenantId, userId);
    user.rename(displayName);
    this.persist(user);
    return user;
  }

  changeEmail(tenantId: TenantId, userId: Ulid, email: string): User {
    const tenant = this.tenants.get(tenantId);
    const normalized = toEmail(email);
    if (!tenant.allowsEmail(normalized)) {
      throw new IdentityError(
        `Email domain of "${normalized}" is not allowed`,
        IDENTITY_ERROR.emailDomainNotAllowed,
        422,
      );
    }
    const clash = this.users.byEmail(tenantId, normalized);
    if (clash && clash.id !== userId) {
      throw new IdentityError(
        `Email "${normalized}" is already registered`,
        IDENTITY_ERROR.emailTaken,
        409,
      );
    }
    const user = this.get(tenantId, userId);
    user.changeEmail(normalized);
    this.persist(user);
    return user;
  }

  setAttribute(tenantId: TenantId, userId: Ulid, key: string, value: string | undefined): User {
    const user = this.get(tenantId, userId);
    user.setAttribute(key, value);
    this.persist(user);
    return user;
  }

  /** Stores only a digest of the MFA secret; the plaintext stays with the enrolling device. */
  enrollMfa(
    tenantId: TenantId,
    input: { userId: Ulid; method: MfaMethod; label: string; secret: string },
  ): User {
    const user = this.get(tenantId, input.userId);
    const enrollment: MfaEnrollment = {
      method: input.method,
      label: input.label,
      secretHashB64: this.secrets.hash(input.secret).hashB64,
      enrolledAt: this.clock.now(),
    };
    user.enrollMfa(enrollment);
    this.persist(user);
    this.recordAdmin(tenantId, "admin.user.mfa_enrolled", user.id, input.userId, {
      method: input.method,
    });
    return user;
  }

  removeMfa(tenantId: TenantId, userId: Ulid, method: MfaMethod, label: string): User {
    const user = this.get(tenantId, userId);
    user.removeMfa(method, label);
    this.persist(user);
    return user;
  }

  /** Password rules are evaluated eagerly so the caller gets every violation at once. */
  assertPasswordAcceptable(password: string, policy: PasswordPolicy): void {
    const complaints = checkPasswordComplexity(password, policy);
    if (complaints.length > 0) {
      throw new ValidationError(
        `Password rejected: ${complaints.map((c) => c.message).join("; ")}`,
        IDENTITY_ERROR.weakPassword,
        complaints,
      );
    }
  }

  private matchesHistory(user: User, password: string, policy: PasswordPolicy): boolean {
    if (policy.historySize <= 0) return false;
    const candidates = [
      ...(user.password ? [user.password] : []),
      ...user.passwordHistory.slice(0, policy.historySize),
    ];
    return candidates.some((hash) => this.hasher.verify(password, hash));
  }

  private revokeSessionsFor(tenantId: TenantId, userId: Ulid, reason: string): number {
    const now = this.clock.now();
    let revoked = 0;
    for (const session of this.sessions.activeForUser(tenantId, userId, now)) {
      session.revoke(reason, now);
      this.sessions.save(session);
      this.publisher.publish(session.pullEvents());
      revoked += 1;
    }
    return revoked;
  }

  private recordAdmin(
    tenantId: TenantId,
    action: string,
    userId: Ulid,
    actorId?: Ulid,
    metadata?: Record<string, unknown>,
  ): void {
    this.audit.append(
      AuditEntry.record({
        tenantId,
        at: this.clock.now(),
        category: "admin",
        action,
        outcome: "success",
        subject: userSubject(userId),
        resourceType: "user",
        resourceId: userId,
        actorId,
        metadata,
      }),
    );
  }

  private persist(user: User): void {
    this.users.save(user);
    this.publisher.publish(user.pullEvents());
  }
}
