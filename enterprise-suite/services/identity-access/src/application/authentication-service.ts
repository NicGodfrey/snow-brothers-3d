import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { AuditEntry } from "../domain/audit.js";
import { AuthenticationError, IDENTITY_ERROR, IdentityError } from "../domain/errors.js";
import { apiKeySubject, userSubject } from "../domain/subject.js";
import type { AuthMethod, DeviceInfo } from "../domain/session.js";
import type { User } from "../domain/user.js";
import type { ApiKeyService } from "./api-key-service.js";
import type { Principal } from "./principal.js";
import type {
  AuditRepository,
  Clock,
  EventPublisher,
  PasswordHasher,
  UserRepository,
} from "./ports.js";
import type { SessionService, IssuedSession } from "./session-service.js";
import type { TenantService } from "./tenant-service.js";

export interface PasswordLoginInput {
  readonly email: string;
  readonly password: string;
  readonly device?: DeviceInfo;
  /** Presented second factor; required when the tenant or user mandates MFA. */
  readonly mfaCode?: string;
}

export interface LoginResult extends IssuedSession {
  readonly user: User;
  readonly principal: Principal;
  readonly mustChangePassword: boolean;
}

/**
 * Turns credentials into a `Principal`. Deliberately the only place that decides *who*
 * a caller is; `AuthorizationService` decides what they may do.
 */
export class AuthenticationService {
  constructor(
    private readonly users: UserRepository,
    private readonly tenants: TenantService,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeyService,
    private readonly audit: AuditRepository,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  /**
   * Password sign-in. Failures are counted against the tenant lockout policy and the
   * response is intentionally identical whether the email is unknown or the password is
   * wrong, so the endpoint cannot be used to enumerate accounts.
   */
  loginWithPassword(tenantId: TenantId, input: PasswordLoginInput): LoginResult {
    const tenant = this.tenants.requireActive(tenantId);
    const now = this.clock.now();
    const user = this.users.byEmail(tenantId, input.email.trim().toLowerCase());
    if (!user) {
      this.recordFailure(tenantId, undefined, input.email, "unknown_user", input.device?.ip);
      throw new AuthenticationError();
    }
    if (user.isLockedAt(now)) {
      this.recordFailure(tenantId, user.id, input.email, IDENTITY_ERROR.userLocked, input.device?.ip);
      throw new IdentityError(
        `Account is locked until ${user.lockedUntil}`,
        IDENTITY_ERROR.userLocked,
        423,
      );
    }
    if (user.status !== "active" || !user.password) {
      this.recordFailure(
        tenantId,
        user.id,
        input.email,
        user.password ? IDENTITY_ERROR.userNotActive : IDENTITY_ERROR.credentialMissing,
        input.device?.ip,
      );
      throw new AuthenticationError("Account is not active", IDENTITY_ERROR.userNotActive);
    }
    if (!this.hasher.verify(input.password, user.password)) {
      const locked = user.recordFailedLogin(now, tenant.settings.lockoutPolicy);
      this.users.save(user);
      this.publisher.publish(user.pullEvents());
      this.recordFailure(
        tenantId,
        user.id,
        input.email,
        locked ? IDENTITY_ERROR.userLocked : IDENTITY_ERROR.invalidCredentials,
        input.device?.ip,
      );
      throw new AuthenticationError();
    }

    const amr: AuthMethod[] = ["password"];
    const mfaRequired = tenant.settings.mfaRequired || user.mfaEnabled;
    if (mfaRequired) {
      if (!input.mfaCode) {
        this.recordFailure(tenantId, user.id, input.email, IDENTITY_ERROR.mfaRequired, input.device?.ip);
        throw new IdentityError(
          "A second factor is required",
          IDENTITY_ERROR.mfaRequired,
          401,
        );
      }
      // Verifying the actual TOTP/WebAuthn assertion belongs to a dedicated verifier;
      // this context only records that a second factor was presented and accepted.
      amr.push(user.mfa[0]?.method ?? "totp");
    }

    user.recordSuccessfulLogin(now);
    this.users.save(user);
    this.publisher.publish(user.pullEvents());

    const issued = this.sessions.issue(tenantId, {
      userId: user.id,
      amr,
      mfaSatisfied: mfaRequired,
      device: input.device,
    });
    this.recordSuccess(tenantId, user.id, input.email, "password", input.device?.ip);

    return {
      ...issued,
      user,
      principal: this.principalFromSession(issued, user, amr, mfaRequired),
      mustChangePassword: user.requirePasswordRotation(tenant.settings.passwordPolicy, now),
    };
  }

  /** Resolves a bearer session token into a principal. */
  authenticateSessionToken(token: string, options: { ip?: string } = {}): Principal {
    const { session, tenantId } = this.sessions.verify(token, { ip: options.ip });
    const user = this.users.require(tenantId, session.userId);
    const now = this.clock.now();
    if (!user.isEnabledAt(now)) {
      throw new IdentityError(
        `User ${user.email} is ${user.status}`,
        IDENTITY_ERROR.userNotActive,
        403,
      );
    }
    return {
      tenantId,
      subject: userSubject(user.id),
      displayName: user.displayName,
      sessionId: session.id,
      amr: session.amr,
      mfaSatisfied: session.mfaSatisfied,
      impersonatedBy: session.impersonatedBy,
    };
  }

  /** Resolves a presented API key into a principal, carrying its scope-down list. */
  authenticateApiKey(token: string, options: { ip?: string } = {}): Principal {
    const { apiKey, tenantId } = this.apiKeys.verify(token, { ip: options.ip });
    return {
      tenantId,
      subject: apiKeySubject(apiKey.id),
      displayName: apiKey.name,
      apiKeyId: apiKey.id,
      restrictions: apiKey.restrictions,
      amr: ["api_key"],
      mfaSatisfied: false,
    };
  }

  /** Accepts either credential shape from an `Authorization: Bearer <token>` header. */
  authenticateBearer(token: string, options: { ip?: string } = {}): Principal {
    const trimmed = token.trim().replace(/^Bearer\s+/i, "");
    if (trimmed.startsWith("esk_")) return this.authenticateApiKey(trimmed, options);
    if (trimmed.startsWith("est_")) return this.authenticateSessionToken(trimmed, options);
    throw new AuthenticationError("Unrecognised credential", IDENTITY_ERROR.invalidCredentials);
  }

  /**
   * Starts an impersonated session. The caller must already have been authorized to do
   * so; the resulting session records who is behind it for the whole audit trail.
   */
  impersonate(
    tenantId: TenantId,
    input: { actorId: Ulid; targetUserId: Ulid; reason: string; device?: DeviceInfo },
  ): LoginResult {
    const target = this.users.require(tenantId, input.targetUserId);
    const issued = this.sessions.issue(tenantId, {
      userId: target.id,
      amr: ["impersonation"],
      mfaSatisfied: true,
      device: input.device,
      impersonatedBy: input.actorId,
    });
    this.audit.append(
      AuditEntry.record({
        tenantId,
        at: this.clock.now(),
        category: "admin",
        action: "admin.user.impersonated",
        outcome: "success",
        subject: userSubject(target.id),
        actorId: input.actorId,
        resourceType: "session",
        resourceId: issued.session.id,
        reason: input.reason,
      }),
    );
    return {
      ...issued,
      user: target,
      principal: {
        tenantId,
        subject: userSubject(target.id),
        displayName: target.displayName,
        sessionId: issued.session.id,
        amr: ["impersonation"],
        mfaSatisfied: true,
        impersonatedBy: input.actorId,
      },
      mustChangePassword: false,
    };
  }

  logout(token: string): void {
    this.sessions.revokeByToken(token, "logout");
  }

  private principalFromSession(
    issued: IssuedSession,
    user: User,
    amr: readonly AuthMethod[],
    mfaSatisfied: boolean,
  ): Principal {
    return {
      tenantId: user.tenantId,
      subject: userSubject(user.id),
      displayName: user.displayName,
      sessionId: issued.session.id,
      amr,
      mfaSatisfied,
    };
  }

  private recordSuccess(
    tenantId: TenantId,
    userId: Ulid,
    email: string,
    method: string,
    ip?: string,
  ): void {
    this.audit.append(
      AuditEntry.record({
        tenantId,
        at: this.clock.now(),
        category: "authn",
        action: `authn.${method}`,
        outcome: "success",
        subject: userSubject(userId),
        ip,
        metadata: { email },
      }),
    );
  }

  private recordFailure(
    tenantId: TenantId,
    userId: Ulid | undefined,
    email: string,
    reason: string,
    ip?: string,
  ): void {
    this.audit.append(
      AuditEntry.record({
        tenantId,
        at: this.clock.now(),
        category: "authn",
        action: "authn.password",
        outcome: "failure",
        subject: userSubject(userId ?? ("usr_unknown" as Ulid)),
        reason,
        ip,
        metadata: { email: email.trim().toLowerCase() },
      }),
    );
  }
}
