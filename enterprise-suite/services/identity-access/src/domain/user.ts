import {
  AggregateRoot,
  ConflictError,
  brand,
  nowIso,
  type Email,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { PasswordHash, PasswordPolicy } from "./credential.js";
import { isPasswordExpired } from "./credential.js";
import { IDENTITY_ERROR, IdentityError, ValidationError } from "./errors.js";
import { IDENTITY_EVENT, identityEvent } from "./events.js";
import { newUserId } from "./ids.js";
import type { LockoutPolicy } from "./tenant.js";

export type UserStatus = "invited" | "active" | "suspended" | "deactivated";

export type MfaMethod = "totp" | "webauthn" | "sms";

export interface MfaEnrollment {
  readonly method: MfaMethod;
  readonly label: string;
  /** Digest of the shared secret / credential id — never the secret itself. */
  readonly secretHashB64: string;
  readonly enrolledAt: IsoDateTime;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(value: string): Email {
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new ValidationError(`Invalid email "${value}"`, IDENTITY_ERROR.invalidEmail);
  }
  return brand<string, "Email">(normalized);
}

interface UserProps {
  email: Email;
  displayName: string;
  status: UserStatus;
  password?: PasswordHash;
  passwordHistory: PasswordHash[];
  mustChangePassword: boolean;
  mfa: MfaEnrollment[];
  failedAttempts: number;
  lastFailedAt?: IsoDateTime;
  lockedUntil?: IsoDateTime;
  lastLoginAt?: IsoDateTime;
  invitedBy?: Ulid;
  invitedAt?: IsoDateTime;
  activatedAt?: IsoDateTime;
  suspendedReason?: string;
  /** Free-form attributes usable by scope resolution, e.g. `{ bu: "emea" }`. */
  attributes: Record<string, string>;
}

export class User extends AggregateRoot<UserProps> {
  private constructor(tenantId: TenantId, props: UserProps, id?: Ulid, createdAt?: IsoDateTime) {
    super(tenantId, props, { id: id ?? newUserId(), createdAt });
  }

  static invite(input: {
    tenantId: TenantId;
    email: string;
    displayName: string;
    invitedBy?: Ulid;
    attributes?: Record<string, string>;
    now?: IsoDateTime;
  }): User {
    const now = input.now ?? nowIso();
    const displayName = input.displayName.trim();
    if (displayName.length < 2) {
      throw new ValidationError("displayName is too short", IDENTITY_ERROR.invalidUserState);
    }
    const user = new User(input.tenantId, {
      email: email(input.email),
      displayName,
      status: "invited",
      passwordHistory: [],
      mustChangePassword: false,
      mfa: [],
      failedAttempts: 0,
      invitedBy: input.invitedBy,
      invitedAt: now,
      attributes: { ...(input.attributes ?? {}) },
    });
    user.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userInvited,
        aggregateType: "user",
        aggregateId: user.id,
        tenantId: user.tenantId,
        payload: {
          email: user.props.email,
          displayName: user.props.displayName,
          invitedBy: input.invitedBy,
        },
      }),
    );
    return user;
  }

  get email(): Email {
    return this.props.email;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get password(): PasswordHash | undefined {
    return this.props.password;
  }

  get passwordHistory(): readonly PasswordHash[] {
    return this.props.passwordHistory;
  }

  get mfa(): readonly MfaEnrollment[] {
    return this.props.mfa;
  }

  get mfaEnabled(): boolean {
    return this.props.mfa.length > 0;
  }

  get failedAttempts(): number {
    return this.props.failedAttempts;
  }

  get lockedUntil(): IsoDateTime | undefined {
    return this.props.lockedUntil;
  }

  get lastLoginAt(): IsoDateTime | undefined {
    return this.props.lastLoginAt;
  }

  get mustChangePassword(): boolean {
    return this.props.mustChangePassword;
  }

  get attributes(): Readonly<Record<string, string>> {
    return this.props.attributes;
  }

  isLockedAt(now: IsoDateTime): boolean {
    return this.props.lockedUntil !== undefined && Date.parse(this.props.lockedUntil) > Date.parse(now);
  }

  /** Subject is usable for authorization only while active and unlocked. */
  isEnabledAt(now: IsoDateTime): boolean {
    return this.props.status === "active" && !this.isLockedAt(now);
  }

  /** Completes an invitation by setting the first password. */
  activateWithPassword(hash: PasswordHash, now: IsoDateTime = nowIso()): void {
    if (this.props.status === "deactivated") {
      throw new ConflictError("A deactivated user cannot be activated; re-invite instead");
    }
    this.props.password = hash;
    this.props.status = "active";
    this.props.activatedAt = now;
    this.props.mustChangePassword = false;
    this.props.failedAttempts = 0;
    this.props.lockedUntil = undefined;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userActivated,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status },
      }),
    );
  }

  /**
   * Replaces the password. Reuse detection needs the hasher (salts differ per hash), so
   * the caller checks history and passes `historyMatches` in.
   */
  setPassword(
    hash: PasswordHash,
    policy: PasswordPolicy,
    options: { historyMatches?: boolean; mustChangeNext?: boolean } = {},
  ): void {
    if (options.historyMatches) {
      throw new IdentityError(
        `Password matches one of the last ${policy.historySize} passwords`,
        IDENTITY_ERROR.passwordReused,
        422,
      );
    }
    if (this.props.password && policy.historySize > 0) {
      this.props.passwordHistory = [this.props.password, ...this.props.passwordHistory].slice(
        0,
        policy.historySize,
      );
    }
    this.props.password = hash;
    this.props.mustChangePassword = options.mustChangeNext ?? false;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userPasswordChanged,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status },
      }),
    );
  }

  requirePasswordRotation(policy: PasswordPolicy, now: IsoDateTime): boolean {
    if (this.props.mustChangePassword) return true;
    return this.props.password ? isPasswordExpired(this.props.password, policy, now) : false;
  }

  suspend(reason: string): void {
    if (this.props.status === "deactivated") {
      throw new ConflictError("A deactivated user cannot be suspended");
    }
    this.props.status = "suspended";
    this.props.suspendedReason = reason;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userSuspended,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status, reason },
      }),
    );
  }

  reactivate(): void {
    if (this.props.status !== "suspended") {
      throw new ConflictError(`Only suspended users can be reactivated (was ${this.props.status})`);
    }
    this.props.status = this.props.password ? "active" : "invited";
    this.props.suspendedReason = undefined;
    this.props.failedAttempts = 0;
    this.props.lockedUntil = undefined;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userReactivated,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status },
      }),
    );
  }

  /** Terminal state: credentials are dropped, the record stays for audit joins. */
  deactivate(reason: string): void {
    this.props.status = "deactivated";
    this.props.password = undefined;
    this.props.passwordHistory = [];
    this.props.mfa = [];
    this.props.suspendedReason = reason;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userDeactivated,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status, reason },
      }),
    );
  }

  changeEmail(value: string): void {
    const next = email(value);
    if (next === this.props.email) return;
    this.props.email = next;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userEmailChanged,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: next, status: this.props.status },
      }),
    );
  }

  rename(displayName: string): void {
    const trimmed = displayName.trim();
    if (trimmed.length < 2) {
      throw new ValidationError("displayName is too short", IDENTITY_ERROR.invalidUserState);
    }
    this.props.displayName = trimmed;
    this.touch();
  }

  setAttribute(key: string, value: string | undefined): void {
    if (value === undefined) delete this.props.attributes[key];
    else this.props.attributes[key] = value;
    this.touch();
  }

  recordSuccessfulLogin(now: IsoDateTime): void {
    this.props.lastLoginAt = now;
    this.props.failedAttempts = 0;
    this.props.lastFailedAt = undefined;
    this.props.lockedUntil = undefined;
    this.touch();
  }

  /**
   * Counts a failed attempt and locks the account when the tenant threshold is reached.
   * Attempts outside the policy window are forgotten rather than accumulating forever.
   */
  recordFailedLogin(now: IsoDateTime, policy: LockoutPolicy): boolean {
    const withinWindow =
      this.props.lastFailedAt !== undefined &&
      Date.parse(now) - Date.parse(this.props.lastFailedAt) <= policy.attemptWindowSeconds * 1000;
    this.props.failedAttempts = withinWindow ? this.props.failedAttempts + 1 : 1;
    this.props.lastFailedAt = now;
    if (this.props.failedAttempts >= policy.maxFailedAttempts) {
      const lockedUntil = brand<string, "IsoDateTime">(
        new Date(Date.parse(now) + policy.lockoutSeconds * 1000).toISOString(),
      );
      this.props.lockedUntil = lockedUntil;
      this.raise(
        identityEvent({
          eventType: IDENTITY_EVENT.userLockedOut,
          aggregateType: "user",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            email: this.props.email,
            failedAttempts: this.props.failedAttempts,
            lockedUntil,
          },
        }),
      );
      return true;
    }
    this.touch();
    return false;
  }

  unlock(): void {
    if (this.props.lockedUntil === undefined && this.props.failedAttempts === 0) return;
    this.props.lockedUntil = undefined;
    this.props.failedAttempts = 0;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userUnlocked,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status },
      }),
    );
  }

  enrollMfa(enrollment: MfaEnrollment): void {
    if (this.props.mfa.some((m) => m.method === enrollment.method && m.label === enrollment.label)) {
      throw new ConflictError(`MFA ${enrollment.method} "${enrollment.label}" already enrolled`);
    }
    this.props.mfa = [...this.props.mfa, enrollment];
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userMfaEnrolled,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status, reason: enrollment.method },
      }),
    );
  }

  removeMfa(method: MfaMethod, label: string): void {
    const next = this.props.mfa.filter((m) => !(m.method === method && m.label === label));
    if (next.length === this.props.mfa.length) return;
    this.props.mfa = next;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.userMfaDisabled,
        aggregateType: "user",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { email: this.props.email, status: this.props.status, reason: method },
      }),
    );
  }

  /** API-safe projection: no hashes, no history, no MFA secrets. */
  toPublicJSON(): Record<string, unknown> {
    return {
      id: this.id,
      tenantId: this.tenantId,
      email: this.props.email,
      displayName: this.props.displayName,
      status: this.props.status,
      mfaEnabled: this.mfaEnabled,
      mfaMethods: this.props.mfa.map((m) => ({ method: m.method, label: m.label })),
      mustChangePassword: this.props.mustChangePassword,
      failedAttempts: this.props.failedAttempts,
      lockedUntil: this.props.lockedUntil,
      lastLoginAt: this.props.lastLoginAt,
      attributes: this.props.attributes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      version: this.version,
    };
  }
}
