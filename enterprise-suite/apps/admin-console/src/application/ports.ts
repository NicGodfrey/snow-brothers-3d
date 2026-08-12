import type {
  EventEnvelope,
  IsoDateTime,
  Page,
  PageRequest,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { AuditEntry, AuditQuery } from "../domain/audit.js";
import type { FeatureFlag } from "../domain/feature-flag.js";
import type { ReferenceDataSet } from "../domain/reference-data.js";
import type { Role } from "../domain/role.js";
import type { AdminUser } from "../domain/user.js";
import type { Tenant } from "../domain/tenant.js";
import type { WebhookDelivery, WebhookSubscription } from "../domain/webhook.js";

/**
 * Ports the application layer depends on. Everything here is implemented
 * in-memory today and is shaped so a Postgres adapter can slot in without the
 * services changing: repositories are tenant-scoped, writes are explicit
 * `save` calls, and the outbox is the only path events take out of a command.
 */

export interface Clock {
  now(): IsoDateTime;
  nowMs(): number;
}

export interface Outbox {
  publish(events: readonly EventEnvelope[]): void | Promise<void>;
  entries(tenantId: TenantId): readonly EventEnvelope[];
}

export interface SecretGenerator {
  /** URL-safe random string used for webhook secrets and invite tokens. */
  generate(bytes?: number): string;
}

export interface Signer {
  /** Hex HMAC-SHA256 of `<timestamp>.<body>`, matching Stripe-style headers. */
  sign(secret: string, timestamp: string, body: string): string;
}

export interface WebhookHttpResponse {
  readonly statusCode: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface WebhookSender {
  send(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: string,
    timeoutMs: number,
  ): Promise<WebhookHttpResponse>;
}

export interface TenantRepository {
  save(tenant: Tenant): void;
  byKey(key: string): Tenant | undefined;
  list(filter?: { status?: string; plan?: string; search?: string }): Tenant[];
  page(filter: { status?: string; plan?: string; search?: string }, request: PageRequest): Page<Tenant>;
  count(): number;
}

/** Every non-tenant repository is scoped by `tenantId` on every read. */
export interface UserRepository {
  save(user: AdminUser): void;
  byId(tenantId: TenantId, id: Ulid): AdminUser | undefined;
  byEmail(tenantId: TenantId, email: string): AdminUser | undefined;
  list(tenantId: TenantId, filter?: { status?: string; role?: string; search?: string }): AdminUser[];
  countActive(tenantId: TenantId): number;
  count(tenantId: TenantId): number;
}

export interface RoleRepository {
  save(role: Role): void;
  byCode(tenantId: TenantId, code: string): Role | undefined;
  list(tenantId: TenantId): Role[];
  map(tenantId: TenantId): Map<string, Role>;
  remove(tenantId: TenantId, code: string): void;
  count(tenantId: TenantId): number;
}

export interface ReferenceDataRepository {
  save(set: ReferenceDataSet): void;
  byCode(tenantId: TenantId, code: string): ReferenceDataSet | undefined;
  list(tenantId: TenantId, filter?: { status?: string; search?: string }): ReferenceDataSet[];
  count(tenantId: TenantId): number;
}

export interface WebhookRepository {
  save(webhook: WebhookSubscription): void;
  byId(tenantId: TenantId, id: Ulid): WebhookSubscription | undefined;
  list(tenantId: TenantId, filter?: { status?: string }): WebhookSubscription[];
  /** All active subscriptions across tenants that match an event type. */
  subscribersFor(tenantId: TenantId, eventType: string): WebhookSubscription[];
  count(tenantId: TenantId): number;
}

export interface DeliveryRepository {
  save(delivery: WebhookDelivery): void;
  byId(id: Ulid): WebhookDelivery | undefined;
  due(now: IsoDateTime, limit: number): WebhookDelivery[];
  forWebhook(tenantId: TenantId, webhookId: Ulid, limit?: number): WebhookDelivery[];
  list(tenantId: TenantId, filter?: { status?: string }): WebhookDelivery[];
}

export interface FeatureFlagRepository {
  save(flag: FeatureFlag): void;
  byKey(tenantId: TenantId, key: string): FeatureFlag | undefined;
  list(tenantId: TenantId, filter?: { enabled?: boolean; tag?: string; archived?: boolean }): FeatureFlag[];
  count(tenantId: TenantId): number;
}

export interface AuditRepository {
  append(entry: AuditEntry): void;
  query(tenantId: TenantId, query: AuditQuery, request: PageRequest): Page<AuditEntry>;
  all(tenantId: TenantId): readonly AuditEntry[];
}

/** Context every command carries: who is acting, in which tenant, from where. */
export interface CommandContext {
  readonly tenantId: TenantId;
  readonly actor: string;
  readonly roles: readonly string[];
  readonly requestId?: string;
  readonly sourceIp?: string;
}
