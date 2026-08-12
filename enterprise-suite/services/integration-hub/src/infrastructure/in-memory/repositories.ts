/**
 * In-memory repositories (identity-map style). Tenant scoping is enforced on
 * every read; a Postgres implementation would translate the same interfaces
 * to SQL against the tables in /migrations.
 *
 * The ordering rules matter and are part of the contract, not an accident of
 * the data structure:
 *  - the outbox hands out claimable messages oldest-first and at most one
 *    in-flight message per partition key, preserving per-aggregate order;
 *  - deliveries and inbox messages come back oldest-due first, so a backlog
 *    drains fairly instead of starving old work.
 */
import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { matchAnyTopic } from "@enterprise-suite/event-bus";
import type {
  AdapterDirection,
  AdapterKind,
  AdapterRegistration,
  AdapterStatus,
} from "../../domain/adapter.js";
import type { DeliveryStatus, WebhookDelivery } from "../../domain/delivery.js";
import type { IdempotencyRecord } from "../../domain/idempotency.js";
import type { InboxMessage, InboxStatus } from "../../domain/inbox.js";
import type { OutboxMessage, OutboxStatus } from "../../domain/outbox.js";
import type {
  AdapterRepository,
  DeliveryRepository,
  IdempotencyRepository,
  InboxRepository,
  OutboxRepository,
  RouteRuleRepository,
  StatusCounts,
  WebhookSubscriptionRepository,
} from "../../domain/repositories.js";
import { compareRules, type RouteDestinationType, type RouteRule } from "../../domain/routing.js";
import { atOrBefore, epochMs } from "../../domain/time.js";
import type { WebhookStatus, WebhookSubscription } from "../../domain/webhook.js";

abstract class InMemoryStore<T extends { id: Ulid; tenantId: TenantId }> {
  protected readonly byId = new Map<Ulid, T>();
  /** Insertion order, used wherever "oldest first" is the required order. */
  protected readonly order: Ulid[] = [];

  async save(entity: T): Promise<void> {
    if (!this.byId.has(entity.id)) this.order.push(entity.id);
    this.byId.set(entity.id, entity);
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<T | null> {
    const entity = this.byId.get(id);
    return entity && entity.tenantId === tenantId ? entity : null;
  }

  async deleteById(tenantId: TenantId, id: Ulid): Promise<boolean> {
    const entity = this.byId.get(id);
    if (!entity || entity.tenantId !== tenantId) return false;
    this.byId.delete(id);
    const index = this.order.indexOf(id);
    if (index !== -1) this.order.splice(index, 1);
    return true;
  }

  protected all(): T[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  protected inTenant(tenantId: TenantId): T[] {
    return this.all().filter((entity) => entity.tenantId === tenantId);
  }

  get size(): number {
    return this.byId.size;
  }
}

function tally(items: readonly { status: string }[]): StatusCounts {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

export class InMemoryOutboxRepository
  extends InMemoryStore<OutboxMessage>
  implements OutboxRepository
{
  async findByEventId(tenantId: TenantId, source: string, eventId: string): Promise<OutboxMessage | null> {
    return (
      this.inTenant(tenantId).find(
        (message) => message.source === source && message.eventId === eventId,
      ) ?? null
    );
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: OutboxStatus; source?: string; eventType?: string },
  ): Promise<OutboxMessage[]> {
    return this.inTenant(tenantId).filter(
      (message) =>
        (filter?.status === undefined || message.status === filter.status) &&
        (filter?.source === undefined || message.source === filter.source) &&
        (filter?.eventType === undefined || message.eventType === filter.eventType),
    );
  }

  async listClaimable(
    now: IsoDateTime,
    limit: number,
    filter?: { tenantId?: TenantId; source?: string },
  ): Promise<OutboxMessage[]> {
    const scoped = this.all().filter(
      (message) =>
        (filter?.tenantId === undefined || message.tenantId === filter.tenantId) &&
        (filter?.source === undefined || message.source === filter.source),
    );
    // Partitions with a live in-flight message are skipped so a slow message
    // cannot be overtaken by a newer one from the same aggregate.
    const busyPartitions = new Set(
      scoped
        .filter((message) => message.status === "in-flight" && !message.isClaimable(now))
        .map((message) => `${String(message.tenantId)}:${message.partitionKey}`),
    );

    const claimable: OutboxMessage[] = [];
    for (const message of scoped) {
      if (claimable.length >= limit) break;
      const partition = `${String(message.tenantId)}:${message.partitionKey}`;
      if (busyPartitions.has(partition)) continue;
      if (!message.isClaimable(now)) continue;
      claimable.push(message);
      busyPartitions.add(partition);
    }
    return claimable;
  }

  async countsByStatus(tenantId?: TenantId): Promise<StatusCounts> {
    return tally(tenantId ? this.inTenant(tenantId) : this.all());
  }
}

export class InMemoryInboxRepository extends InMemoryStore<InboxMessage> implements InboxRepository {
  async findByKey(tenantId: TenantId, source: string, messageKey: string): Promise<InboxMessage | null> {
    return (
      this.inTenant(tenantId).find(
        (message) => message.source === source && message.messageKey === messageKey,
      ) ?? null
    );
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: InboxStatus; source?: string; eventType?: string },
  ): Promise<InboxMessage[]> {
    return this.inTenant(tenantId).filter(
      (message) =>
        (filter?.status === undefined || message.status === filter.status) &&
        (filter?.source === undefined || message.source === filter.source) &&
        (filter?.eventType === undefined || message.eventType === filter.eventType),
    );
  }

  async listDue(
    now: IsoDateTime,
    limit: number,
    filter?: { tenantId?: TenantId; source?: string },
  ): Promise<InboxMessage[]> {
    return this.all()
      .filter(
        (message) =>
          message.isDue(now) &&
          (filter?.tenantId === undefined || message.tenantId === filter.tenantId) &&
          (filter?.source === undefined || message.source === filter.source),
      )
      .sort((a, b) => epochMs(a.availableAt) - epochMs(b.availableAt))
      .slice(0, limit);
  }

  async countsByStatus(tenantId?: TenantId): Promise<StatusCounts> {
    return tally(tenantId ? this.inTenant(tenantId) : this.all());
  }
}

export class InMemoryIdempotencyRepository
  extends InMemoryStore<IdempotencyRecord>
  implements IdempotencyRepository
{
  async findByKey(tenantId: TenantId, scope: string, key: string): Promise<IdempotencyRecord | null> {
    return (
      this.inTenant(tenantId).find((record) => record.scope === scope && record.key === key) ?? null
    );
  }

  async list(tenantId: TenantId, filter?: { scope?: string }): Promise<IdempotencyRecord[]> {
    return this.inTenant(tenantId).filter(
      (record) => filter?.scope === undefined || record.scope === filter.scope,
    );
  }

  async purgeExpired(now: IsoDateTime, tenantId?: TenantId): Promise<number> {
    const doomed = (tenantId ? this.inTenant(tenantId) : this.all()).filter((record) =>
      record.isExpired(now),
    );
    for (const record of doomed) await this.deleteById(record.tenantId, record.id);
    return doomed.length;
  }
}

export class InMemoryWebhookSubscriptionRepository
  extends InMemoryStore<WebhookSubscription>
  implements WebhookSubscriptionRepository
{
  async findByName(tenantId: TenantId, name: string): Promise<WebhookSubscription | null> {
    return this.inTenant(tenantId).find((subscription) => subscription.name === name) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: WebhookStatus; eventType?: string },
  ): Promise<WebhookSubscription[]> {
    return this.inTenant(tenantId).filter(
      (subscription) =>
        (filter?.status === undefined || subscription.status === filter.status) &&
        (filter?.eventType === undefined || subscription.matches(filter.eventType)),
    );
  }

  async listMatching(tenantId: TenantId, eventType: string): Promise<WebhookSubscription[]> {
    return this.inTenant(tenantId).filter(
      (subscription) => subscription.isActive && subscription.matches(eventType),
    );
  }

  async delete(tenantId: TenantId, id: Ulid): Promise<boolean> {
    return this.deleteById(tenantId, id);
  }
}

export class InMemoryDeliveryRepository
  extends InMemoryStore<WebhookDelivery>
  implements DeliveryRepository
{
  async list(
    tenantId: TenantId,
    filter?: { subscriptionId?: Ulid; status?: DeliveryStatus; eventType?: string },
  ): Promise<WebhookDelivery[]> {
    return this.inTenant(tenantId).filter(
      (delivery) =>
        (filter?.subscriptionId === undefined || delivery.subscriptionId === filter.subscriptionId) &&
        (filter?.status === undefined || delivery.status === filter.status) &&
        (filter?.eventType === undefined || delivery.eventType === filter.eventType),
    );
  }

  async listDue(
    now: IsoDateTime,
    limit: number,
    filter?: { tenantId?: TenantId; subscriptionId?: Ulid },
  ): Promise<WebhookDelivery[]> {
    return this.all()
      .filter(
        (delivery) =>
          delivery.isDue(now) &&
          (filter?.tenantId === undefined || delivery.tenantId === filter.tenantId) &&
          (filter?.subscriptionId === undefined || delivery.subscriptionId === filter.subscriptionId),
      )
      .sort((a, b) => epochMs(a.availableAt) - epochMs(b.availableAt))
      .slice(0, limit);
  }

  async countsByStatus(tenantId?: TenantId, subscriptionId?: Ulid): Promise<StatusCounts> {
    const scoped = (tenantId ? this.inTenant(tenantId) : this.all()).filter(
      (delivery) => subscriptionId === undefined || delivery.subscriptionId === subscriptionId,
    );
    return tally(scoped);
  }

  /** Diagnostics helper: deliveries scheduled but not yet due. */
  async listScheduled(now: IsoDateTime, tenantId?: TenantId): Promise<WebhookDelivery[]> {
    return (tenantId ? this.inTenant(tenantId) : this.all()).filter(
      (delivery) => delivery.status === "pending" && !atOrBefore(delivery.availableAt, now),
    );
  }
}

export class InMemoryAdapterRepository
  extends InMemoryStore<AdapterRegistration>
  implements AdapterRepository
{
  async findByName(tenantId: TenantId, name: string): Promise<AdapterRegistration | null> {
    return this.inTenant(tenantId).find((adapter) => adapter.name === name) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { kind?: AdapterKind; status?: AdapterStatus; direction?: AdapterDirection },
  ): Promise<AdapterRegistration[]> {
    return this.inTenant(tenantId).filter(
      (adapter) =>
        (filter?.kind === undefined || adapter.kind === filter.kind) &&
        (filter?.status === undefined || adapter.status === filter.status) &&
        (filter?.direction === undefined || adapter.direction === filter.direction),
    );
  }
}

export class InMemoryRouteRuleRepository
  extends InMemoryStore<RouteRule>
  implements RouteRuleRepository
{
  async findByName(tenantId: TenantId, name: string): Promise<RouteRule | null> {
    return this.inTenant(tenantId).find((rule) => rule.name === name) ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { enabled?: boolean; destinationType?: RouteDestinationType },
  ): Promise<RouteRule[]> {
    return this.inTenant(tenantId)
      .filter(
        (rule) =>
          (filter?.enabled === undefined || rule.enabled === filter.enabled) &&
          (filter?.destinationType === undefined || rule.destination.type === filter.destinationType),
      )
      .sort(compareRules);
  }

  async listMatching(tenantId: TenantId, eventType: string): Promise<RouteRule[]> {
    return this.inTenant(tenantId)
      .filter((rule) => rule.enabled && matchAnyTopic(rule.eventPatterns, eventType))
      .sort(compareRules);
  }

  async delete(tenantId: TenantId, id: Ulid): Promise<boolean> {
    return this.deleteById(tenantId, id);
  }
}
