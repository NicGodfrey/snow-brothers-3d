import {
  AggregateRoot,
  brand,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { SecretHash } from "./credential.js";
import { IDENTITY_ERROR, IdentityError } from "./errors.js";
import { IDENTITY_EVENT, identityEvent } from "./events.js";
import { newSessionId } from "./ids.js";

export type SessionStatus = "active" | "revoked" | "expired";

/** Authentication methods that produced the session, in the spirit of the OIDC `amr` claim. */
export type AuthMethod =
  | "password"
  | "api_key"
  | "totp"
  | "webauthn"
  | "sms"
  | "sso"
  | "impersonation";

export interface DeviceInfo {
  readonly userAgent?: string;
  readonly ip?: string;
  readonly deviceLabel?: string;
}

export const SESSION_TOKEN_PREFIX = "est";

export function formatSessionToken(sessionId: Ulid, secret: string): string {
  return `${SESSION_TOKEN_PREFIX}_${sessionId}_${secret}`;
}

export function parseSessionToken(token: string): { sessionId: Ulid; secret: string } {
  // Only the first three segments are structural (`est`, then the two halves of the
  // session id). The secret is base64url, whose alphabet includes `_`, so everything
  // after them is rejoined rather than counted.
  const parts = token.trim().split("_");
  const secret = parts.slice(3).join("_");
  if (parts[0] !== SESSION_TOKEN_PREFIX || !parts[1] || !parts[2] || !secret) {
    throw new IdentityError("Malformed session token", IDENTITY_ERROR.invalidCredentials, 401);
  }
  return { sessionId: brand<string, "Ulid">(`${parts[1]}_${parts[2]}`), secret };
}

interface SessionProps {
  userId: Ulid;
  tokenHash: SecretHash;
  refreshTokenHash?: SecretHash;
  status: SessionStatus;
  issuedAt: IsoDateTime;
  /** Sliding idle deadline; moved forward by `touch`. */
  expiresAt: IsoDateTime;
  /** Hard deadline set at issue time; never extended. */
  absoluteExpiresAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  amr: AuthMethod[];
  mfaSatisfied: boolean;
  device: DeviceInfo;
  impersonatedBy?: Ulid;
  refreshCount: number;
  revokedAt?: IsoDateTime;
  revokedReason?: string;
}

export class Session extends AggregateRoot<SessionProps> {
  private constructor(tenantId: TenantId, props: SessionProps, id?: Ulid, createdAt?: IsoDateTime) {
    super(tenantId, props, { id: id ?? newSessionId(), createdAt });
  }

  static issue(input: {
    tenantId: TenantId;
    sessionId?: Ulid;
    userId: Ulid;
    tokenHash: SecretHash;
    refreshTokenHash?: SecretHash;
    issuedAt: IsoDateTime;
    idleTtlSeconds: number;
    absoluteTtlSeconds: number;
    amr: readonly AuthMethod[];
    mfaSatisfied?: boolean;
    device?: DeviceInfo;
    impersonatedBy?: Ulid;
  }): Session {
    const issuedMs = Date.parse(input.issuedAt);
    const session = new Session(
      input.tenantId,
      {
        userId: input.userId,
        tokenHash: input.tokenHash,
        refreshTokenHash: input.refreshTokenHash,
        status: "active",
        issuedAt: input.issuedAt,
        expiresAt: isoAt(issuedMs + input.idleTtlSeconds * 1000),
        absoluteExpiresAt: isoAt(issuedMs + input.absoluteTtlSeconds * 1000),
        lastSeenAt: input.issuedAt,
        amr: [...input.amr],
        mfaSatisfied: input.mfaSatisfied ?? false,
        device: input.device ?? {},
        impersonatedBy: input.impersonatedBy,
        refreshCount: 0,
      },
      input.sessionId,
      input.issuedAt,
    );
    session.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.sessionIssued,
        aggregateType: "session",
        aggregateId: session.id,
        tenantId: session.tenantId,
        payload: {
          userId: input.userId,
          expiresAt: session.props.expiresAt,
          absoluteExpiresAt: session.props.absoluteExpiresAt,
          amr: [...session.props.amr],
        },
      }),
    );
    return session;
  }

  get userId(): Ulid {
    return this.props.userId;
  }

  get tokenHash(): SecretHash {
    return this.props.tokenHash;
  }

  get refreshTokenHash(): SecretHash | undefined {
    return this.props.refreshTokenHash;
  }

  get status(): SessionStatus {
    return this.props.status;
  }

  get issuedAt(): IsoDateTime {
    return this.props.issuedAt;
  }

  get expiresAt(): IsoDateTime {
    return this.props.expiresAt;
  }

  get absoluteExpiresAt(): IsoDateTime {
    return this.props.absoluteExpiresAt;
  }

  get lastSeenAt(): IsoDateTime {
    return this.props.lastSeenAt;
  }

  get amr(): readonly AuthMethod[] {
    return this.props.amr;
  }

  get mfaSatisfied(): boolean {
    return this.props.mfaSatisfied;
  }

  get device(): DeviceInfo {
    return this.props.device;
  }

  get refreshCount(): number {
    return this.props.refreshCount;
  }

  get impersonatedBy(): Ulid | undefined {
    return this.props.impersonatedBy;
  }

  isValidAt(now: IsoDateTime): boolean {
    if (this.props.status !== "active") return false;
    const at = Date.parse(now);
    return at < Date.parse(this.props.expiresAt) && at < Date.parse(this.props.absoluteExpiresAt);
  }

  assertValidAt(now: IsoDateTime): void {
    if (this.props.status === "revoked") {
      throw new IdentityError("Session was revoked", IDENTITY_ERROR.sessionRevoked, 401);
    }
    if (!this.isValidAt(now)) {
      throw new IdentityError("Session expired", IDENTITY_ERROR.sessionExpired, 401);
    }
  }

  /** Slides the idle deadline forward, never past the absolute deadline. */
  touchSeen(now: IsoDateTime, idleTtlSeconds: number): void {
    if (this.props.status !== "active") return;
    const candidate = Date.parse(now) + idleTtlSeconds * 1000;
    const ceiling = Date.parse(this.props.absoluteExpiresAt);
    this.props.lastSeenAt = now;
    this.props.expiresAt = isoAt(Math.min(candidate, ceiling));
    this.touch();
  }

  refresh(input: {
    now: IsoDateTime;
    idleTtlSeconds: number;
    tokenHash?: SecretHash;
    refreshTokenHash?: SecretHash;
  }): void {
    this.assertValidAt(input.now);
    if (input.tokenHash) this.props.tokenHash = input.tokenHash;
    if (input.refreshTokenHash) this.props.refreshTokenHash = input.refreshTokenHash;
    this.props.refreshCount += 1;
    this.props.lastSeenAt = input.now;
    this.props.expiresAt = isoAt(
      Math.min(
        Date.parse(input.now) + input.idleTtlSeconds * 1000,
        Date.parse(this.props.absoluteExpiresAt),
      ),
    );
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.sessionRefreshed,
        aggregateType: "session",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          userId: this.props.userId,
          expiresAt: this.props.expiresAt,
          absoluteExpiresAt: this.props.absoluteExpiresAt,
          amr: [...this.props.amr],
        },
      }),
    );
  }

  satisfyMfa(method: AuthMethod, now: IsoDateTime): void {
    this.props.mfaSatisfied = true;
    if (!this.props.amr.includes(method)) this.props.amr = [...this.props.amr, method];
    this.props.lastSeenAt = now;
    this.touch();
  }

  revoke(reason: string, now: IsoDateTime): void {
    if (this.props.status !== "active") return;
    this.props.status = "revoked";
    this.props.revokedAt = now;
    this.props.revokedReason = reason;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.sessionRevoked,
        aggregateType: "session",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          userId: this.props.userId,
          expiresAt: this.props.expiresAt,
          absoluteExpiresAt: this.props.absoluteExpiresAt,
          amr: [...this.props.amr],
          reason,
        },
      }),
    );
  }

  /** Marks a naturally lapsed session so sweeps do not revisit it. */
  markExpired(now: IsoDateTime): void {
    if (this.props.status !== "active" || this.isValidAt(now)) return;
    this.props.status = "expired";
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.sessionExpired,
        aggregateType: "session",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          userId: this.props.userId,
          expiresAt: this.props.expiresAt,
          absoluteExpiresAt: this.props.absoluteExpiresAt,
          amr: [...this.props.amr],
        },
      }),
    );
  }

  toPublicJSON(): Record<string, unknown> {
    return {
      id: this.id,
      tenantId: this.tenantId,
      userId: this.props.userId,
      status: this.props.status,
      issuedAt: this.props.issuedAt,
      expiresAt: this.props.expiresAt,
      absoluteExpiresAt: this.props.absoluteExpiresAt,
      lastSeenAt: this.props.lastSeenAt,
      amr: this.props.amr,
      mfaSatisfied: this.props.mfaSatisfied,
      device: this.props.device,
      refreshCount: this.props.refreshCount,
      impersonatedBy: this.props.impersonatedBy,
    };
  }
}

function isoAt(epochMs: number): IsoDateTime {
  return brand<string, "IsoDateTime">(new Date(epochMs).toISOString());
}
