import {
  AggregateRoot,
  ConflictError,
  brand,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from "./credential.js";
import { IDENTITY_ERROR, IdentityError } from "./errors.js";
import { IDENTITY_EVENT, identityEvent } from "./events.js";
import { slug as toSlug, type Slug } from "./ids.js";

export type TenantStatus = "pending" | "active" | "suspended" | "archived";

export interface SessionPolicy {
  /** Sliding window: a session dies this long after its last use. */
  readonly idleTtlSeconds: number;
  /** Hard ceiling regardless of activity. */
  readonly absoluteTtlSeconds: number;
  readonly maxConcurrentSessions: number;
  readonly refreshEnabled: boolean;
  /** Rotate the session token on every refresh (recommended). */
  readonly rotateOnRefresh: boolean;
}

export interface ApiKeyPolicy {
  readonly maxActiveKeys: number;
  readonly defaultTtlDays: number;
  /** Reject keys presented from outside their allowlist when one is configured. */
  readonly enforceIpAllowlist: boolean;
}

export interface LockoutPolicy {
  readonly maxFailedAttempts: number;
  readonly lockoutSeconds: number;
  /** Failed attempts older than this window no longer count toward lockout. */
  readonly attemptWindowSeconds: number;
}

export interface TenantSettings {
  readonly passwordPolicy: PasswordPolicy;
  readonly sessionPolicy: SessionPolicy;
  readonly apiKeyPolicy: ApiKeyPolicy;
  readonly lockoutPolicy: LockoutPolicy;
  readonly mfaRequired: boolean;
  /** Empty means any domain is accepted. */
  readonly allowedEmailDomains: readonly string[];
  /** When true, denied authorization checks are written to the audit log too. */
  readonly auditAllDecisions: boolean;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleTtlSeconds: 3600,
  absoluteTtlSeconds: 43_200,
  maxConcurrentSessions: 10,
  refreshEnabled: true,
  rotateOnRefresh: true,
};

export const DEFAULT_API_KEY_POLICY: ApiKeyPolicy = {
  maxActiveKeys: 25,
  defaultTtlDays: 365,
  enforceIpAllowlist: true,
};

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxFailedAttempts: 5,
  lockoutSeconds: 900,
  attemptWindowSeconds: 900,
};

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  passwordPolicy: DEFAULT_PASSWORD_POLICY,
  sessionPolicy: DEFAULT_SESSION_POLICY,
  apiKeyPolicy: DEFAULT_API_KEY_POLICY,
  lockoutPolicy: DEFAULT_LOCKOUT_POLICY,
  mfaRequired: false,
  allowedEmailDomains: [],
  auditAllDecisions: false,
};

export interface TenantSettingsPatch {
  readonly passwordPolicy?: Partial<PasswordPolicy>;
  readonly sessionPolicy?: Partial<SessionPolicy>;
  readonly apiKeyPolicy?: Partial<ApiKeyPolicy>;
  readonly lockoutPolicy?: Partial<LockoutPolicy>;
  readonly mfaRequired?: boolean;
  readonly allowedEmailDomains?: readonly string[];
  readonly auditAllDecisions?: boolean;
}

interface TenantProps {
  slug: Slug;
  name: string;
  status: TenantStatus;
  settings: TenantSettings;
  suspendedReason?: string;
  activatedAt?: IsoDateTime;
  archivedAt?: IsoDateTime;
}

/**
 * The tenant is the root of every other aggregate in this context. Its aggregate id and
 * its `tenantId` are deliberately the same value so that tenant-scoped repositories can
 * treat it like any other record.
 */
export class Tenant extends AggregateRoot<TenantProps> {
  private constructor(id: TenantId, props: TenantProps, existing?: { createdAt?: IsoDateTime }) {
    super(id, props, { id: brand<string, "Ulid">(id), createdAt: existing?.createdAt });
  }

  static provision(input: {
    tenantId: TenantId;
    slug: string;
    name: string;
    settings?: TenantSettingsPatch;
    now?: IsoDateTime;
  }): Tenant {
    const name = input.name.trim();
    if (name.length < 2) {
      throw new IdentityError("Tenant name is too short", IDENTITY_ERROR.invalidUserState, 422);
    }
    const tenant = new Tenant(input.tenantId, {
      slug: toSlug(input.slug),
      name,
      status: "pending",
      settings: mergeSettings(DEFAULT_TENANT_SETTINGS, input.settings ?? {}),
    });
    tenant.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.tenantProvisioned,
        aggregateType: "tenant",
        aggregateId: tenant.id,
        tenantId: tenant.tenantId,
        payload: { slug: tenant.props.slug, name: tenant.props.name },
      }),
    );
    return tenant;
  }

  get slug(): Slug {
    return this.props.slug;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): TenantStatus {
    return this.props.status;
  }

  get settings(): TenantSettings {
    return this.props.settings;
  }

  get isActive(): boolean {
    return this.props.status === "active";
  }

  activate(now: IsoDateTime = nowIso()): void {
    if (this.props.status === "active") return;
    if (this.props.status === "archived") {
      throw new ConflictError("An archived tenant cannot be reactivated");
    }
    this.props.status = "active";
    this.props.activatedAt = now;
    this.props.suspendedReason = undefined;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.tenantActivated,
        aggregateType: "tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { slug: this.props.slug, status: this.props.status },
      }),
    );
  }

  suspend(reason: string): void {
    if (this.props.status === "archived") {
      throw new ConflictError("An archived tenant cannot be suspended");
    }
    this.props.status = "suspended";
    this.props.suspendedReason = reason;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.tenantSuspended,
        aggregateType: "tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { slug: this.props.slug, status: this.props.status, reason },
      }),
    );
  }

  archive(now: IsoDateTime = nowIso()): void {
    if (this.props.status === "archived") return;
    this.props.status = "archived";
    this.props.archivedAt = now;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.tenantArchived,
        aggregateType: "tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { slug: this.props.slug, status: this.props.status },
      }),
    );
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new IdentityError("Tenant name is too short", IDENTITY_ERROR.invalidUserState, 422);
    }
    this.props.name = trimmed;
    this.touch();
  }

  updateSettings(patch: TenantSettingsPatch): void {
    this.props.settings = mergeSettings(this.props.settings, patch);
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.tenantSettingsUpdated,
        aggregateType: "tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { slug: this.props.slug, status: this.props.status },
      }),
    );
  }

  assertActive(): void {
    if (!this.isActive) {
      throw new IdentityError(
        `Tenant ${this.props.slug} is ${this.props.status}`,
        IDENTITY_ERROR.tenantInactive,
        403,
      );
    }
  }

  /** Email domain allowlist check used when inviting users. */
  allowsEmail(email: string): boolean {
    const allowed = this.props.settings.allowedEmailDomains;
    if (allowed.length === 0) return true;
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    return allowed.some((entry) => {
      const normalized = entry.toLowerCase().replace(/^@/, "");
      return domain === normalized || domain.endsWith(`.${normalized}`);
    });
  }
}

export function mergeSettings(base: TenantSettings, patch: TenantSettingsPatch): TenantSettings {
  const merged: TenantSettings = {
    passwordPolicy: { ...base.passwordPolicy, ...patch.passwordPolicy },
    sessionPolicy: { ...base.sessionPolicy, ...patch.sessionPolicy },
    apiKeyPolicy: { ...base.apiKeyPolicy, ...patch.apiKeyPolicy },
    lockoutPolicy: { ...base.lockoutPolicy, ...patch.lockoutPolicy },
    mfaRequired: patch.mfaRequired ?? base.mfaRequired,
    allowedEmailDomains: (patch.allowedEmailDomains ?? base.allowedEmailDomains).map((d) =>
      d.trim().toLowerCase().replace(/^@/, ""),
    ),
    auditAllDecisions: patch.auditAllDecisions ?? base.auditAllDecisions,
  };
  assertSaneSettings(merged);
  return merged;
}

function assertSaneSettings(settings: TenantSettings): void {
  const { sessionPolicy, passwordPolicy, lockoutPolicy, apiKeyPolicy } = settings;
  if (sessionPolicy.idleTtlSeconds < 60) {
    throw new IdentityError(
      "sessionPolicy.idleTtlSeconds must be at least 60",
      IDENTITY_ERROR.invalidUserState,
      422,
    );
  }
  if (sessionPolicy.absoluteTtlSeconds < sessionPolicy.idleTtlSeconds) {
    throw new IdentityError(
      "sessionPolicy.absoluteTtlSeconds must be >= idleTtlSeconds",
      IDENTITY_ERROR.invalidUserState,
      422,
    );
  }
  if (sessionPolicy.maxConcurrentSessions < 1) {
    throw new IdentityError(
      "sessionPolicy.maxConcurrentSessions must be at least 1",
      IDENTITY_ERROR.invalidUserState,
      422,
    );
  }
  if (passwordPolicy.minLength < 8) {
    throw new IdentityError(
      "passwordPolicy.minLength must be at least 8",
      IDENTITY_ERROR.invalidUserState,
      422,
    );
  }
  if (lockoutPolicy.maxFailedAttempts < 1) {
    throw new IdentityError(
      "lockoutPolicy.maxFailedAttempts must be at least 1",
      IDENTITY_ERROR.invalidUserState,
      422,
    );
  }
  if (apiKeyPolicy.maxActiveKeys < 1) {
    throw new IdentityError(
      "apiKeyPolicy.maxActiveKeys must be at least 1",
      IDENTITY_ERROR.invalidUserState,
      422,
    );
  }
}

export function tenantAggregateId(tenantId: TenantId): Ulid {
  return brand<string, "Ulid">(tenantId);
}
