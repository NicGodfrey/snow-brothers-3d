import {
  AggregateRoot,
  ConflictError,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { SecretHash } from "./credential.js";
import { IDENTITY_ERROR, IdentityError, ValidationError } from "./errors.js";
import { IDENTITY_EVENT, identityEvent } from "./events.js";
import { newApiKeyId } from "./ids.js";
import { matchesPermission, type GrantPattern, type PermissionKey } from "./permission-key.js";

export type ApiKeyStatus = "active" | "revoked";

/**
 * Presented keys look like `esk_<prefix>_<secret>`: the prefix is stored in clear so a
 * lookup is a single indexed read, the secret is only ever kept as a salted digest.
 */
export const API_KEY_TOKEN_PREFIX = "esk";

export interface ParsedApiKeyToken {
  readonly prefix: string;
  readonly secret: string;
}

export function formatApiKeyToken(prefix: string, secret: string): string {
  return `${API_KEY_TOKEN_PREFIX}_${prefix}_${secret}`;
}

export function parseApiKeyToken(token: string): ParsedApiKeyToken {
  const parts = token.trim().split("_");
  if (parts.length !== 3 || parts[0] !== API_KEY_TOKEN_PREFIX || !parts[1] || !parts[2]) {
    throw new ValidationError(
      "Malformed API key token; expected esk_<prefix>_<secret>",
      IDENTITY_ERROR.apiKeyMalformed,
    );
  }
  return { prefix: parts[1], secret: parts[2] };
}

interface ApiKeyProps {
  name: string;
  prefix: string;
  secret: SecretHash;
  status: ApiKeyStatus;
  /**
   * Optional scope-down list. When present the key can never exercise a permission
   * outside these patterns, even if its role bindings would allow it.
   */
  restrictions: GrantPattern[];
  expiresAt?: IsoDateTime;
  lastUsedAt?: IsoDateTime;
  useCount: number;
  createdBy?: Ulid;
  /** Exact IPs or CIDR-ish `a.b.c.*` entries. Empty means any source address. */
  ipAllowlist: string[];
  revokedAt?: IsoDateTime;
  revokedBy?: Ulid;
  revokedReason?: string;
  rotatedAt?: IsoDateTime;
}

export class ApiKey extends AggregateRoot<ApiKeyProps> {
  private constructor(tenantId: TenantId, props: ApiKeyProps, id?: Ulid, createdAt?: IsoDateTime) {
    super(tenantId, props, { id: id ?? newApiKeyId(), createdAt });
  }

  static issue(input: {
    tenantId: TenantId;
    name: string;
    prefix: string;
    secret: SecretHash;
    restrictions?: readonly GrantPattern[];
    expiresAt?: IsoDateTime;
    createdBy?: Ulid;
    ipAllowlist?: readonly string[];
  }): ApiKey {
    const name = input.name.trim();
    if (name.length < 3) {
      throw new ValidationError("API key name is too short", IDENTITY_ERROR.invalidUserState);
    }
    const key = new ApiKey(input.tenantId, {
      name,
      prefix: input.prefix,
      secret: input.secret,
      status: "active",
      restrictions: [...(input.restrictions ?? [])],
      expiresAt: input.expiresAt,
      useCount: 0,
      createdBy: input.createdBy,
      ipAllowlist: [...(input.ipAllowlist ?? [])],
    });
    key.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.apiKeyIssued,
        aggregateType: "api_key",
        aggregateId: key.id,
        tenantId: key.tenantId,
        payload: { name, prefix: input.prefix, expiresAt: input.expiresAt },
      }),
    );
    return key;
  }

  get name(): string {
    return this.props.name;
  }

  get prefix(): string {
    return this.props.prefix;
  }

  get secret(): SecretHash {
    return this.props.secret;
  }

  get status(): ApiKeyStatus {
    return this.props.status;
  }

  get restrictions(): readonly GrantPattern[] {
    return this.props.restrictions;
  }

  get expiresAt(): IsoDateTime | undefined {
    return this.props.expiresAt;
  }

  get lastUsedAt(): IsoDateTime | undefined {
    return this.props.lastUsedAt;
  }

  get useCount(): number {
    return this.props.useCount;
  }

  get ipAllowlist(): readonly string[] {
    return this.props.ipAllowlist;
  }

  isExpiredAt(now: IsoDateTime): boolean {
    return this.props.expiresAt !== undefined && Date.parse(now) >= Date.parse(this.props.expiresAt);
  }

  isUsableAt(now: IsoDateTime): boolean {
    return this.props.status === "active" && !this.isExpiredAt(now);
  }

  /** Throws the specific reason the key cannot be used, for precise 401 responses. */
  assertUsableAt(now: IsoDateTime): void {
    if (this.props.status === "revoked") {
      throw new IdentityError(`API key ${this.props.prefix} is revoked`, IDENTITY_ERROR.apiKeyRevoked, 401);
    }
    if (this.isExpiredAt(now)) {
      throw new IdentityError(`API key ${this.props.prefix} expired`, IDENTITY_ERROR.apiKeyExpired, 401);
    }
  }

  allowsIp(ip: string | undefined): boolean {
    if (this.props.ipAllowlist.length === 0) return true;
    if (!ip) return false;
    return this.props.ipAllowlist.some((entry) => {
      if (entry === ip) return true;
      if (!entry.endsWith("*")) return false;
      return ip.startsWith(entry.slice(0, -1));
    });
  }

  /** With no restrictions the key inherits its bindings unchanged. */
  permits(permission: PermissionKey): boolean {
    if (this.props.restrictions.length === 0) return true;
    return this.props.restrictions.some((pattern) => matchesPermission(pattern, permission));
  }

  restrictTo(patterns: readonly GrantPattern[]): void {
    this.props.restrictions = [...patterns];
    this.touch();
  }

  recordUse(now: IsoDateTime): void {
    this.props.lastUsedAt = now;
    this.props.useCount += 1;
    this.touch();
  }

  rotate(secret: SecretHash, now: IsoDateTime): void {
    if (this.props.status !== "active") {
      throw new ConflictError(`Cannot rotate a ${this.props.status} API key`);
    }
    this.props.secret = secret;
    this.props.rotatedAt = now;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.apiKeyRotated,
        aggregateType: "api_key",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, prefix: this.props.prefix },
      }),
    );
  }

  revoke(input: { at: IsoDateTime; by?: Ulid; reason?: string }): void {
    if (this.props.status === "revoked") return;
    this.props.status = "revoked";
    this.props.revokedAt = input.at;
    this.props.revokedBy = input.by;
    this.props.revokedReason = input.reason;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.apiKeyRevoked,
        aggregateType: "api_key",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, prefix: this.props.prefix, reason: input.reason },
      }),
    );
  }

  /** API-safe projection: never exposes the digest or salt. */
  toPublicJSON(): Record<string, unknown> {
    return {
      id: this.id,
      tenantId: this.tenantId,
      name: this.props.name,
      prefix: this.props.prefix,
      status: this.props.status,
      restrictions: this.props.restrictions,
      ipAllowlist: this.props.ipAllowlist,
      expiresAt: this.props.expiresAt,
      lastUsedAt: this.props.lastUsedAt,
      useCount: this.props.useCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
