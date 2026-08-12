import {
  NotFoundError,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { AuditEntry } from "../domain/audit.js";
import { IDENTITY_ERROR, IdentityError } from "../domain/errors.js";
import { newSessionId } from "../domain/ids.js";
import {
  Session,
  formatSessionToken,
  parseSessionToken,
  type AuthMethod,
  type DeviceInfo,
} from "../domain/session.js";
import { userSubject } from "../domain/subject.js";
import type { SessionPolicy } from "../domain/tenant.js";
import type {
  AuditRepository,
  Clock,
  EventPublisher,
  SecretHasher,
  SessionRepository,
  TokenGenerator,
  UserRepository,
} from "./ports.js";
import type { TenantService } from "./tenant-service.js";

export interface IssueSessionInput {
  readonly userId: Ulid;
  readonly amr: readonly AuthMethod[];
  readonly mfaSatisfied?: boolean;
  readonly device?: DeviceInfo;
  readonly impersonatedBy?: Ulid;
}

export interface IssuedSession {
  readonly session: Session;
  /** Returned once at issue time; storage keeps only digests. */
  readonly token: string;
  readonly refreshToken?: string;
}

export interface VerifiedSession {
  readonly session: Session;
  readonly tenantId: TenantId;
}

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly tenants: TenantService,
    private readonly audit: AuditRepository,
    private readonly hasher: SecretHasher,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  /**
   * Issues a session for an already-authenticated user. Concurrency is capped per tenant
   * policy by evicting the least recently seen session rather than refusing the login,
   * which is what users expect from a "you were signed out on your old laptop" flow.
   */
  issue(tenantId: TenantId, input: IssueSessionInput): IssuedSession {
    const tenant = this.tenants.requireActive(tenantId);
    const policy = tenant.settings.sessionPolicy;
    const user = this.users.require(tenantId, input.userId);
    const now = this.clock.now();
    if (!user.isEnabledAt(now)) {
      throw new IdentityError(
        `User ${user.email} is ${user.status}${user.isLockedAt(now) ? " and locked" : ""}`,
        IDENTITY_ERROR.userNotActive,
        403,
      );
    }
    this.enforceConcurrency(tenantId, input.userId, policy, now);

    const sessionId = newSessionId();
    const secret = this.tokens.secret(32);
    const refreshSecret = policy.refreshEnabled ? this.tokens.secret(32) : undefined;
    const session = Session.issue({
      tenantId,
      sessionId,
      userId: input.userId,
      tokenHash: this.hasher.hash(secret),
      refreshTokenHash: refreshSecret ? this.hasher.hash(refreshSecret) : undefined,
      issuedAt: now,
      idleTtlSeconds: policy.idleTtlSeconds,
      absoluteTtlSeconds: policy.absoluteTtlSeconds,
      amr: input.amr,
      mfaSatisfied: input.mfaSatisfied ?? false,
      device: input.device,
      impersonatedBy: input.impersonatedBy,
    });
    this.persist(session);
    this.record(session, "authn.session.issued", "success", input.device?.ip);

    return {
      session,
      token: formatSessionToken(sessionId, secret),
      refreshToken: refreshSecret ? formatSessionToken(sessionId, refreshSecret) : undefined,
    };
  }

  /** Verifies a bearer session token and slides its idle deadline forward. */
  verify(token: string, options: { touch?: boolean; ip?: string } = {}): VerifiedSession {
    const parsed = parseSessionToken(token);
    const session = this.sessions.byIdAnyTenant(parsed.sessionId);
    if (!session) {
      throw new IdentityError("Unknown session", IDENTITY_ERROR.invalidCredentials, 401);
    }
    const now = this.clock.now();
    if (!this.hasher.verify(parsed.secret, session.tokenHash)) {
      this.record(session, "authn.session.verify", "failure", options.ip, "token_mismatch");
      throw new IdentityError("Invalid session token", IDENTITY_ERROR.invalidCredentials, 401);
    }
    if (session.status === "active" && !session.isValidAt(now)) {
      session.markExpired(now);
      this.persist(session);
    }
    session.assertValidAt(now);

    const tenant = this.tenants.get(session.tenantId);
    if (!tenant.isActive) {
      throw new IdentityError(
        `Tenant ${tenant.slug} is ${tenant.status}`,
        IDENTITY_ERROR.tenantInactive,
        403,
      );
    }
    if (options.touch !== false) {
      session.touchSeen(now, tenant.settings.sessionPolicy.idleTtlSeconds);
      this.persist(session);
    }
    return { session, tenantId: session.tenantId };
  }

  /**
   * Exchanges a refresh token for a fresh session token. With `rotateOnRefresh` both
   * halves are replaced, so a stolen refresh token is single-use.
   */
  refresh(refreshToken: string, options: { ip?: string } = {}): IssuedSession {
    const parsed = parseSessionToken(refreshToken);
    const session = this.sessions.byIdAnyTenant(parsed.sessionId);
    if (!session) {
      throw new IdentityError("Unknown session", IDENTITY_ERROR.invalidCredentials, 401);
    }
    const tenant = this.tenants.get(session.tenantId);
    const policy = tenant.settings.sessionPolicy;
    if (!policy.refreshEnabled || !session.refreshTokenHash) {
      throw new IdentityError(
        "Refresh is disabled for this tenant",
        IDENTITY_ERROR.refreshNotEnabled,
        409,
      );
    }
    if (!this.hasher.verify(parsed.secret, session.refreshTokenHash)) {
      // A bad refresh secret against a real session is a strong signal of replay;
      // kill the session rather than merely rejecting the call.
      const now = this.clock.now();
      session.revoke("refresh_token_mismatch", now);
      this.persist(session);
      this.record(session, "authn.session.refresh", "failure", options.ip, "token_mismatch");
      throw new IdentityError("Invalid refresh token", IDENTITY_ERROR.invalidCredentials, 401);
    }

    const now = this.clock.now();
    const nextSecret = policy.rotateOnRefresh ? this.tokens.secret(32) : undefined;
    const nextRefresh = policy.rotateOnRefresh ? this.tokens.secret(32) : undefined;
    session.refresh({
      now,
      idleTtlSeconds: policy.idleTtlSeconds,
      tokenHash: nextSecret ? this.hasher.hash(nextSecret) : undefined,
      refreshTokenHash: nextRefresh ? this.hasher.hash(nextRefresh) : undefined,
    });
    this.persist(session);
    this.record(session, "authn.session.refreshed", "success", options.ip);

    return {
      session,
      token: nextSecret ? formatSessionToken(session.id, nextSecret) : "",
      refreshToken: nextRefresh ? formatSessionToken(session.id, nextRefresh) : undefined,
    };
  }

  satisfyMfa(tenantId: TenantId, sessionId: Ulid, method: AuthMethod): Session {
    const session = this.get(tenantId, sessionId);
    session.satisfyMfa(method, this.clock.now());
    this.persist(session);
    return session;
  }

  get(tenantId: TenantId, sessionId: Ulid): Session {
    const session = this.sessions.byId(tenantId, sessionId);
    if (!session) throw new NotFoundError("Session", sessionId);
    return session;
  }

  listForUser(tenantId: TenantId, userId: Ulid, options: { activeOnly?: boolean } = {}): readonly Session[] {
    const now = this.clock.now();
    const all = this.sessions.byUser(tenantId, userId);
    const filtered = options.activeOnly ? all.filter((session) => session.isValidAt(now)) : all;
    return [...filtered].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }

  revoke(tenantId: TenantId, sessionId: Ulid, reason = "logout"): Session {
    const session = this.get(tenantId, sessionId);
    session.revoke(reason, this.clock.now());
    this.persist(session);
    this.record(session, "authn.session.revoked", "success", undefined, reason);
    return session;
  }

  revokeByToken(token: string, reason = "logout"): Session {
    const { session } = this.verify(token, { touch: false });
    session.revoke(reason, this.clock.now());
    this.persist(session);
    this.record(session, "authn.session.revoked", "success", undefined, reason);
    return session;
  }

  revokeAllForUser(tenantId: TenantId, userId: Ulid, reason: string): number {
    const now = this.clock.now();
    let count = 0;
    for (const session of this.sessions.activeForUser(tenantId, userId, now)) {
      session.revoke(reason, now);
      this.persist(session);
      count += 1;
    }
    return count;
  }

  /** Marks lapsed sessions expired; a scheduled job would call this per tenant. */
  sweepExpired(tenantId: TenantId): number {
    const now = this.clock.now();
    let swept = 0;
    for (const session of this.sessions.list(tenantId)) {
      if (session.status !== "active" || session.isValidAt(now)) continue;
      session.markExpired(now);
      this.persist(session);
      swept += 1;
    }
    return swept;
  }

  private enforceConcurrency(
    tenantId: TenantId,
    userId: Ulid,
    policy: SessionPolicy,
    now: IsoDateTime,
  ): void {
    const active = [...this.sessions.activeForUser(tenantId, userId, now)].sort((a, b) =>
      a.lastSeenAt.localeCompare(b.lastSeenAt),
    );
    const surplus = active.length - policy.maxConcurrentSessions + 1;
    for (let i = 0; i < surplus && i < active.length; i += 1) {
      active[i].revoke("session_limit_reached", now);
      this.persist(active[i]);
    }
  }

  private record(
    session: Session,
    action: string,
    outcome: "success" | "failure",
    ip?: string,
    reason?: string,
  ): void {
    this.audit.append(
      AuditEntry.record({
        tenantId: session.tenantId,
        at: this.clock.now(),
        category: "authn",
        action,
        outcome,
        subject: userSubject(session.userId),
        resourceType: "session",
        resourceId: session.id,
        reason,
        ip: ip ?? session.device.ip,
        metadata: { amr: session.amr, refreshCount: session.refreshCount },
      }),
    );
  }

  private persist(session: Session): void {
    this.sessions.save(session);
    this.publisher.publish(session.pullEvents());
  }
}
