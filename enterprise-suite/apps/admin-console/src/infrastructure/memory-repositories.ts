import {
  paginate,
  type EventEnvelope,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { matchesAuditQuery, type AuditEntry, type AuditQuery } from "../domain/audit.js";
import type { FeatureFlag } from "../domain/feature-flag.js";
import type { ReferenceDataSet } from "../domain/reference-data.js";
import type { Role } from "../domain/role.js";
import type { Tenant } from "../domain/tenant.js";
import type { AdminUser } from "../domain/user.js";
import type { WebhookDelivery, WebhookSubscription } from "../domain/webhook.js";
import type {
  AuditRepository,
  Clock,
  DeliveryRepository,
  FeatureFlagRepository,
  Outbox,
  ReferenceDataRepository,
  RoleRepository,
  TenantRepository,
  UserRepository,
  WebhookRepository,
} from "../application/ports.js";

/**
 * In-memory adapters.
 *
 * Every collection is keyed `<tenantId>:<naturalKey>` so a query that forgets
 * its tenant scope cannot accidentally read another tenant's row — the same
 * mistake a `WHERE tenant_id = $1` omission would make against Postgres, made
 * impossible here by construction.
 */

function scoped(tenantId: TenantId, key: string): string {
  return `${String(tenantId)}::${key}`;
}

export class InMemoryTenantRepository implements TenantRepository {
  private readonly byKeyMap = new Map<string, Tenant>();

  save(tenant: Tenant): void {
    this.byKeyMap.set(tenant.key, tenant);
  }

  byKey(key: string): Tenant | undefined {
    return this.byKeyMap.get(key);
  }

  list(filter: { status?: string; plan?: string; search?: string } = {}): Tenant[] {
    const search = filter.search?.toLowerCase();
    return [...this.byKeyMap.values()]
      .filter((tenant) => {
        if (filter.status && tenant.status !== filter.status) return false;
        if (filter.plan && tenant.plan !== filter.plan) return false;
        if (search && !`${tenant.key} ${tenant.name}`.toLowerCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  page(
    filter: { status?: string; plan?: string; search?: string },
    request: PageRequest,
  ): Page<Tenant> {
    return paginate(this.list(filter), request);
  }

  count(): number {
    return this.byKeyMap.size;
  }
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byIdMap = new Map<string, AdminUser>();
  private readonly byEmailMap = new Map<string, AdminUser>();

  save(user: AdminUser): void {
    this.byIdMap.set(scoped(user.tenantId, String(user.id)), user);
    this.byEmailMap.set(scoped(user.tenantId, user.email), user);
  }

  byId(tenantId: TenantId, id: Ulid): AdminUser | undefined {
    return this.byIdMap.get(scoped(tenantId, String(id)));
  }

  byEmail(tenantId: TenantId, email: string): AdminUser | undefined {
    return this.byEmailMap.get(scoped(tenantId, email));
  }

  list(
    tenantId: TenantId,
    filter: { status?: string; role?: string; search?: string } = {},
  ): AdminUser[] {
    const prefix = `${String(tenantId)}::`;
    const search = filter.search?.toLowerCase();
    return [...this.byIdMap.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, user]) => user)
      .filter((user) => {
        if (filter.status && user.status !== filter.status) return false;
        if (filter.role && !user.roles.includes(filter.role)) return false;
        if (search && !`${user.email} ${user.displayName}`.toLowerCase().includes(search)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  countActive(tenantId: TenantId): number {
    return this.list(tenantId, { status: "active" }).length;
  }

  count(tenantId: TenantId): number {
    return this.list(tenantId).filter((user) => user.status !== "deactivated").length;
  }
}

export class InMemoryRoleRepository implements RoleRepository {
  private readonly store = new Map<string, Role>();

  save(role: Role): void {
    this.store.set(scoped(role.tenantId, role.code), role);
  }

  byCode(tenantId: TenantId, code: string): Role | undefined {
    return this.store.get(scoped(tenantId, code));
  }

  list(tenantId: TenantId): Role[] {
    const prefix = `${String(tenantId)}::`;
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, role]) => role)
      .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.code.localeCompare(b.code));
  }

  map(tenantId: TenantId): Map<string, Role> {
    return new Map(this.list(tenantId).map((role) => [role.code, role]));
  }

  remove(tenantId: TenantId, code: string): void {
    this.store.delete(scoped(tenantId, code));
  }

  count(tenantId: TenantId): number {
    return this.list(tenantId).length;
  }
}

export class InMemoryReferenceDataRepository implements ReferenceDataRepository {
  private readonly store = new Map<string, ReferenceDataSet>();

  save(set: ReferenceDataSet): void {
    this.store.set(scoped(set.tenantId, set.code), set);
  }

  byCode(tenantId: TenantId, code: string): ReferenceDataSet | undefined {
    return this.store.get(scoped(tenantId, code));
  }

  list(tenantId: TenantId, filter: { status?: string; search?: string } = {}): ReferenceDataSet[] {
    const prefix = `${String(tenantId)}::`;
    const search = filter.search?.toLowerCase();
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, set]) => set)
      .filter((set) => {
        if (filter.status && set.status !== filter.status) return false;
        if (search && !`${set.code} ${set.name}`.toLowerCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  count(tenantId: TenantId): number {
    return this.list(tenantId).length;
  }
}

export class InMemoryWebhookRepository implements WebhookRepository {
  private readonly store = new Map<string, WebhookSubscription>();

  save(webhook: WebhookSubscription): void {
    this.store.set(scoped(webhook.tenantId, String(webhook.id)), webhook);
  }

  byId(tenantId: TenantId, id: Ulid): WebhookSubscription | undefined {
    return this.store.get(scoped(tenantId, String(id)));
  }

  list(tenantId: TenantId, filter: { status?: string } = {}): WebhookSubscription[] {
    const prefix = `${String(tenantId)}::`;
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, webhook]) => webhook)
      .filter((webhook) => (filter.status ? webhook.status === filter.status : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  subscribersFor(tenantId: TenantId, eventType: string): WebhookSubscription[] {
    return this.list(tenantId).filter((webhook) => webhook.isInterestedIn(eventType));
  }

  count(tenantId: TenantId): number {
    return this.list(tenantId).filter((webhook) => webhook.status !== "disabled").length;
  }
}

export class InMemoryDeliveryRepository implements DeliveryRepository {
  private readonly store = new Map<string, WebhookDelivery>();

  save(delivery: WebhookDelivery): void {
    this.store.set(String(delivery.id), delivery);
  }

  byId(id: Ulid): WebhookDelivery | undefined {
    return this.store.get(String(id));
  }

  due(now: IsoDateTime, limit: number): WebhookDelivery[] {
    return [...this.store.values()]
      .filter((delivery) => delivery.isDue(now))
      .sort((a, b) => Date.parse(a.nextAttemptAt) - Date.parse(b.nextAttemptAt))
      .slice(0, limit);
  }

  forWebhook(tenantId: TenantId, webhookId: Ulid, limit = 20): WebhookDelivery[] {
    return [...this.store.values()]
      .filter(
        (delivery) =>
          String(delivery.tenantId) === String(tenantId) &&
          String(delivery.webhookId) === String(webhookId),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  list(tenantId: TenantId, filter: { status?: string } = {}): WebhookDelivery[] {
    return [...this.store.values()]
      .filter((delivery) => String(delivery.tenantId) === String(tenantId))
      .filter((delivery) => (filter.status ? delivery.status === filter.status : true))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  private readonly store = new Map<string, FeatureFlag>();

  save(flag: FeatureFlag): void {
    this.store.set(scoped(flag.tenantId, flag.key), flag);
  }

  byKey(tenantId: TenantId, key: string): FeatureFlag | undefined {
    return this.store.get(scoped(tenantId, key));
  }

  list(
    tenantId: TenantId,
    filter: { enabled?: boolean; tag?: string; archived?: boolean } = {},
  ): FeatureFlag[] {
    const prefix = `${String(tenantId)}::`;
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, flag]) => flag)
      .filter((flag) => {
        if (filter.enabled !== undefined && flag.enabled !== filter.enabled) return false;
        if (filter.tag && !flag.tags.includes(filter.tag)) return false;
        if (filter.archived !== undefined && flag.archived !== filter.archived) return false;
        return true;
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  count(tenantId: TenantId): number {
    return this.list(tenantId, { archived: false }).length;
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  query(tenantId: TenantId, query: AuditQuery, request: PageRequest): Page<AuditEntry> {
    const matches = this.entries
      .filter((entry) => String(entry.tenantId) === String(tenantId))
      .filter((entry) => matchesAuditQuery(entry, query))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
    return paginate(matches, request);
  }

  all(tenantId: TenantId): readonly AuditEntry[] {
    return this.entries.filter((entry) => String(entry.tenantId) === String(tenantId));
  }
}

/**
 * Transactional outbox stand-in. Events are appended in order and can be
 * replayed per tenant; `subscribe` lets the webhook dispatcher fan out without
 * the command handlers knowing it exists.
 */
export class InMemoryOutbox implements Outbox {
  private readonly events: EventEnvelope[] = [];
  private readonly listeners: ((event: EventEnvelope) => void)[] = [];

  publish(events: readonly EventEnvelope[]): void {
    for (const event of events) {
      this.events.push(event);
      for (const listener of this.listeners) listener(event);
    }
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  entries(tenantId: TenantId): readonly EventEnvelope[] {
    return this.events.filter((event) => String(event.tenantId) === String(tenantId));
  }

  ofType(tenantId: TenantId, eventType: string): readonly EventEnvelope[] {
    return this.entries(tenantId).filter((event) => event.eventType === eventType);
  }

  get size(): number {
    return this.events.length;
  }

  clear(): void {
    this.events.length = 0;
  }
}

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return new Date().toISOString() as IsoDateTime;
  }
  nowMs(): number {
    return Date.now();
  }
}

export class FixedClock implements Clock {
  private ms: number;

  constructor(iso = "2026-03-01T09:00:00.000Z") {
    this.ms = Date.parse(iso);
  }

  now(): IsoDateTime {
    return new Date(this.ms).toISOString() as IsoDateTime;
  }

  nowMs(): number {
    return this.ms;
  }

  advance(ms: number): this {
    this.ms += ms;
    return this;
  }
}
