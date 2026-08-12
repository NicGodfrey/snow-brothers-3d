/**
 * Repository ports. Implementations live in infrastructure; the in-memory
 * ones are behaviour-complete so the whole hub runs without Postgres.
 *
 * Reads are tenant-scoped, with one deliberate exception: the relay and
 * delivery workers are background processes that serve every tenant, so their
 * "what is due?" queries take an optional tenant filter instead.
 */
import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { AdapterKind, AdapterRegistration, AdapterStatus, AdapterDirection } from "./adapter.js";
import type { DeliveryStatus, WebhookDelivery } from "./delivery.js";
import type { IdempotencyRecord } from "./idempotency.js";
import type { InboxMessage, InboxStatus } from "./inbox.js";
import type { OutboxMessage, OutboxStatus } from "./outbox.js";
import type { RouteDestinationType, RouteRule } from "./routing.js";
import type { WebhookStatus, WebhookSubscription } from "./webhook.js";

export interface StatusCounts {
  readonly [status: string]: number;
}

export interface OutboxRepository {
  save(message: OutboxMessage): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<OutboxMessage | null>;
  /** De-duplicates re-ingestion of the same source event. */
  findByEventId(tenantId: TenantId, source: string, eventId: string): Promise<OutboxMessage | null>;
  list(
    tenantId: TenantId,
    filter?: { status?: OutboxStatus; source?: string; eventType?: string },
  ): Promise<OutboxMessage[]>;
  /**
   * Relay query: claimable messages ordered by enqueue time, at most one
   * in-flight message per partition key so per-aggregate order is preserved.
   */
  listClaimable(now: IsoDateTime, limit: number, filter?: { tenantId?: TenantId; source?: string }):
    Promise<OutboxMessage[]>;
  countsByStatus(tenantId?: TenantId): Promise<StatusCounts>;
}

export interface InboxRepository {
  save(message: InboxMessage): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<InboxMessage | null>;
  findByKey(tenantId: TenantId, source: string, messageKey: string): Promise<InboxMessage | null>;
  list(
    tenantId: TenantId,
    filter?: { status?: InboxStatus; source?: string; eventType?: string },
  ): Promise<InboxMessage[]>;
  listDue(now: IsoDateTime, limit: number, filter?: { tenantId?: TenantId; source?: string }):
    Promise<InboxMessage[]>;
  countsByStatus(tenantId?: TenantId): Promise<StatusCounts>;
}

export interface IdempotencyRepository {
  save(record: IdempotencyRecord): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<IdempotencyRecord | null>;
  findByKey(tenantId: TenantId, scope: string, key: string): Promise<IdempotencyRecord | null>;
  list(tenantId: TenantId, filter?: { scope?: string }): Promise<IdempotencyRecord[]>;
  /** Housekeeping: drops records past their TTL. Returns how many were removed. */
  purgeExpired(now: IsoDateTime, tenantId?: TenantId): Promise<number>;
}

export interface WebhookSubscriptionRepository {
  save(subscription: WebhookSubscription): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<WebhookSubscription | null>;
  findByName(tenantId: TenantId, name: string): Promise<WebhookSubscription | null>;
  list(
    tenantId: TenantId,
    filter?: { status?: WebhookStatus; eventType?: string },
  ): Promise<WebhookSubscription[]>;
  /** Active subscriptions whose patterns match, used by the fan-out. */
  listMatching(tenantId: TenantId, eventType: string): Promise<WebhookSubscription[]>;
  delete(tenantId: TenantId, id: Ulid): Promise<boolean>;
}

export interface DeliveryRepository {
  save(delivery: WebhookDelivery): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<WebhookDelivery | null>;
  list(
    tenantId: TenantId,
    filter?: { subscriptionId?: Ulid; status?: DeliveryStatus; eventType?: string },
  ): Promise<WebhookDelivery[]>;
  listDue(now: IsoDateTime, limit: number, filter?: { tenantId?: TenantId; subscriptionId?: Ulid }):
    Promise<WebhookDelivery[]>;
  countsByStatus(tenantId?: TenantId, subscriptionId?: Ulid): Promise<StatusCounts>;
}

export interface AdapterRepository {
  save(adapter: AdapterRegistration): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<AdapterRegistration | null>;
  findByName(tenantId: TenantId, name: string): Promise<AdapterRegistration | null>;
  list(
    tenantId: TenantId,
    filter?: { kind?: AdapterKind; status?: AdapterStatus; direction?: AdapterDirection },
  ): Promise<AdapterRegistration[]>;
}

export interface RouteRuleRepository {
  save(rule: RouteRule): Promise<void>;
  findById(tenantId: TenantId, id: Ulid): Promise<RouteRule | null>;
  findByName(tenantId: TenantId, name: string): Promise<RouteRule | null>;
  list(
    tenantId: TenantId,
    filter?: { enabled?: boolean; destinationType?: RouteDestinationType },
  ): Promise<RouteRule[]>;
  /** Enabled rules matching an event type, already in evaluation order. */
  listMatching(tenantId: TenantId, eventType: string): Promise<RouteRule[]>;
  delete(tenantId: TenantId, id: Ulid): Promise<boolean>;
}
