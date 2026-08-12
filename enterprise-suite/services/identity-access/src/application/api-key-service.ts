import {
  NotFoundError,
  brand,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { ApiKey, formatApiKeyToken, parseApiKeyToken } from "../domain/api-key.js";
import { AuditEntry } from "../domain/audit.js";
import { IDENTITY_ERROR, IdentityError } from "../domain/errors.js";
import { grantPattern, type GrantPattern } from "../domain/permission-key.js";
import { apiKeySubject } from "../domain/subject.js";
import type {
  ApiKeyRepository,
  AuditRepository,
  Clock,
  EventPublisher,
  PolicyVersionStore,
  SecretHasher,
  TokenGenerator,
} from "./ports.js";
import type { RoleBindingService } from "./role-binding-service.js";
import type { TenantService } from "./tenant-service.js";

export interface IssueApiKeyInput {
  readonly name: string;
  readonly restrictions?: readonly string[];
  readonly expiresInDays?: number;
  readonly createdBy?: Ulid;
  readonly ipAllowlist?: readonly string[];
  /** Roles to bind to the key's own subject at issue time. */
  readonly roleCodes?: readonly string[];
  readonly scope?: string;
}

export interface IssuedApiKey {
  readonly apiKey: ApiKey;
  /** Returned exactly once; only the digest is persisted. */
  readonly token: string;
}

export interface VerifiedApiKey {
  readonly apiKey: ApiKey;
  readonly tenantId: TenantId;
}

export class ApiKeyService {
  constructor(
    private readonly apiKeys: ApiKeyRepository,
    private readonly tenants: TenantService,
    private readonly roleBindings: RoleBindingService,
    private readonly audit: AuditRepository,
    private readonly policyVersions: PolicyVersionStore,
    private readonly hasher: SecretHasher,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  issue(tenantId: TenantId, input: IssueApiKeyInput): IssuedApiKey {
    const tenant = this.tenants.requireActive(tenantId);
    const now = this.clock.now();
    const policy = tenant.settings.apiKeyPolicy;
    if (this.apiKeys.activeCount(tenantId, now) >= policy.maxActiveKeys) {
      throw new IdentityError(
        `Tenant ${tenant.slug} already has ${policy.maxActiveKeys} active API keys`,
        IDENTITY_ERROR.apiKeyLimitReached,
        409,
      );
    }

    const prefix = this.uniquePrefix();
    const secret = this.tokens.secret(32);
    const ttlDays = input.expiresInDays ?? policy.defaultTtlDays;
    const expiresAt =
      ttlDays > 0
        ? brand<string, "IsoDateTime">(
            new Date(Date.parse(now) + ttlDays * 86_400_000).toISOString(),
          )
        : undefined;

    const apiKey = ApiKey.issue({
      tenantId,
      name: input.name,
      prefix,
      secret: this.hasher.hash(secret),
      restrictions: (input.restrictions ?? []).map(grantPattern),
      expiresAt,
      createdBy: input.createdBy,
      ipAllowlist: input.ipAllowlist,
    });
    this.persist(apiKey);

    for (const roleCode of input.roleCodes ?? []) {
      this.roleBindings.grant(tenantId, {
        subject: apiKeySubject(apiKey.id),
        roleCode,
        scope: input.scope,
        validUntil: expiresAt,
        grantedBy: input.createdBy,
        reason: `issued with API key ${apiKey.name}`,
      });
    }

    this.recordAdmin(tenantId, "admin.api_key.issued", apiKey, input.createdBy);
    return { apiKey, token: formatApiKeyToken(prefix, secret) };
  }

  get(tenantId: TenantId, id: Ulid): ApiKey {
    const key = this.apiKeys.byId(tenantId, id);
    if (!key) throw new NotFoundError("ApiKey", id);
    return key;
  }

  list(tenantId: TenantId, options: { activeOnly?: boolean } = {}): readonly ApiKey[] {
    const now = this.clock.now();
    return this.apiKeys
      .list(tenantId)
      .filter((key) => (options.activeOnly ? key.isUsableAt(now) : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Verifies a presented token. Failures are deliberately uniform from the caller's
   * point of view (a 401 with a specific code) but the audit log records the detail.
   */
  verify(token: string, options: { ip?: string } = {}): VerifiedApiKey {
    const parsed = parseApiKeyToken(token);
    const apiKey = this.apiKeys.byPrefix(parsed.prefix);
    if (!apiKey) {
      throw new IdentityError("Unknown API key", IDENTITY_ERROR.invalidCredentials, 401);
    }
    const now = this.clock.now();
    if (!this.hasher.verify(parsed.secret, apiKey.secret)) {
      this.recordAuthn(apiKey, "failure", "secret_mismatch", options.ip);
      throw new IdentityError("Invalid API key", IDENTITY_ERROR.invalidCredentials, 401);
    }
    try {
      apiKey.assertUsableAt(now);
    } catch (error) {
      this.recordAuthn(apiKey, "failure", (error as IdentityError).code, options.ip);
      throw error;
    }
    const tenant = this.tenants.get(apiKey.tenantId);
    if (!tenant.isActive) {
      this.recordAuthn(apiKey, "failure", IDENTITY_ERROR.tenantInactive, options.ip);
      throw new IdentityError(
        `Tenant ${tenant.slug} is ${tenant.status}`,
        IDENTITY_ERROR.tenantInactive,
        403,
      );
    }
    if (tenant.settings.apiKeyPolicy.enforceIpAllowlist && !apiKey.allowsIp(options.ip)) {
      this.recordAuthn(apiKey, "failure", IDENTITY_ERROR.ipNotAllowed, options.ip);
      throw new IdentityError(
        `Source address is not in the allowlist for key ${apiKey.prefix}`,
        IDENTITY_ERROR.ipNotAllowed,
        403,
      );
    }

    apiKey.recordUse(now);
    this.persist(apiKey);
    this.recordAuthn(apiKey, "success", undefined, options.ip);
    return { apiKey, tenantId: apiKey.tenantId };
  }

  rotate(tenantId: TenantId, id: Ulid, actorId?: Ulid): IssuedApiKey {
    const apiKey = this.get(tenantId, id);
    const secret = this.tokens.secret(32);
    apiKey.rotate(this.hasher.hash(secret), this.clock.now());
    this.persist(apiKey);
    this.recordAdmin(tenantId, "admin.api_key.rotated", apiKey, actorId);
    return { apiKey, token: formatApiKeyToken(apiKey.prefix, secret) };
  }

  restrict(tenantId: TenantId, id: Ulid, patterns: readonly string[]): ApiKey {
    const apiKey = this.get(tenantId, id);
    apiKey.restrictTo(patterns.map(grantPattern) as GrantPattern[]);
    this.persist(apiKey);
    return apiKey;
  }

  revoke(
    tenantId: TenantId,
    id: Ulid,
    options: { by?: Ulid; reason?: string } = {},
  ): ApiKey {
    const apiKey = this.get(tenantId, id);
    apiKey.revoke({ at: this.clock.now(), by: options.by, reason: options.reason });
    this.persist(apiKey);
    // The key stops being a usable subject immediately, so cached allows must go.
    this.policyVersions.bump(tenantId);
    this.roleBindings.revokeAllFor(tenantId, apiKeySubject(apiKey.id), {
      by: options.by,
      reason: "api_key_revoked",
    });
    this.recordAdmin(tenantId, "admin.api_key.revoked", apiKey, options.by, options.reason);
    return apiKey;
  }

  /** Revokes keys that lapsed, so listings and counts stay honest. */
  sweepExpired(tenantId: TenantId): number {
    const now = this.clock.now();
    let swept = 0;
    for (const key of this.apiKeys.list(tenantId)) {
      if (key.status !== "active" || !key.isExpiredAt(now)) continue;
      key.revoke({ at: now, reason: "expired" });
      this.persist(key);
      swept += 1;
    }
    return swept;
  }

  private uniquePrefix(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.tokens.prefix(10);
      if (!this.apiKeys.byPrefix(candidate)) return candidate;
    }
    throw new IdentityError(
      "Could not allocate a unique API key prefix",
      IDENTITY_ERROR.apiKeyMalformed,
      500,
    );
  }

  private recordAuthn(
    apiKey: ApiKey,
    outcome: "success" | "failure",
    reason?: string,
    ip?: string,
  ): void {
    this.audit.append(
      AuditEntry.record({
        tenantId: apiKey.tenantId,
        at: this.clock.now(),
        category: "authn",
        action: "authn.api_key",
        outcome,
        subject: apiKeySubject(apiKey.id),
        reason,
        resourceType: "api_key",
        resourceId: apiKey.id,
        ip,
        metadata: { prefix: apiKey.prefix },
      }),
    );
  }

  private recordAdmin(
    tenantId: TenantId,
    action: string,
    apiKey: ApiKey,
    actorId?: Ulid,
    reason?: string,
  ): void {
    this.audit.append(
      AuditEntry.record({
        tenantId,
        at: this.clock.now(),
        category: "admin",
        action,
        outcome: "success",
        subject: apiKeySubject(apiKey.id),
        resourceType: "api_key",
        resourceId: apiKey.id,
        actorId,
        reason,
        metadata: { name: apiKey.name, prefix: apiKey.prefix },
      }),
    );
  }

  private persist(apiKey: ApiKey): void {
    this.apiKeys.save(apiKey);
    this.publisher.publish(apiKey.pullEvents());
  }
}
