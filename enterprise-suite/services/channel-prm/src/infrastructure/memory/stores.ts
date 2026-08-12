import {
  nowIso,
  paginate,
  type EventEnvelope,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { ChannelOrder } from "../../domain/channel-order.js";
import type { ChannelQuote } from "../../domain/channel-quote.js";
import type { ConflictCase, DirectClaim } from "../../domain/conflict.js";
import type { DealRegistration } from "../../domain/deal-registration.js";
import { DEFAULT_TIER_POLICIES, type Partner, type PartnerTier, type TierPolicy } from "../../domain/partner.js";
import type { SequenceName } from "../../domain/numbering.js";
import { hasLapsed, isProtectedAt, remainingDays } from "../../domain/protection.js";
import type { Referral } from "../../domain/referral.js";
import { normalizeProductLine, territoryCovers, type CustomerKey } from "../../domain/territory.js";
import type {
  ChannelOrderFilter,
  ChannelOrderRepository,
  ChannelQuoteFilter,
  ChannelQuoteRepository,
  Clock,
  ConflictFilter,
  ConflictRepository,
  DirectClaimRepository,
  OutboxPort,
  PartnerFilter,
  PartnerRepository,
  ReferralFilter,
  ReferralRepository,
  RegistrationFilter,
  RegistrationRepository,
  SequencePort,
  TierPolicyRepository,
} from "../../application/ports.js";

/**
 * In-memory adapters.
 *
 * Aggregates are held by reference (single process, no serialization round
 * trip), and every map is keyed by tenant first so a missing tenant can never
 * see another tenant's rows. The query methods mirror the indexes the SQL
 * migrations declare, which keeps the Postgres port a mechanical exercise.
 */

class TenantKeyedStore<T> {
  private readonly byTenant = new Map<TenantId, Map<Ulid, T>>();

  private bucket(tenantId: TenantId): Map<Ulid, T> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    return bucket;
  }

  get(tenantId: TenantId, id: Ulid): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  set(tenantId: TenantId, id: Ulid, value: T): void {
    this.bucket(tenantId).set(id, value);
  }

  values(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }
}

function matchesSearch(haystack: readonly (string | undefined)[], needle: string | undefined): boolean {
  if (!needle) return true;
  const term = needle.trim().toLowerCase();
  return haystack.some((value) => value?.toLowerCase().includes(term));
}

export class InMemoryPartnerRepository implements PartnerRepository {
  private readonly store = new TenantKeyedStore<Partner>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Partner | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<Partner | undefined> {
    const normalized = code.trim().toUpperCase();
    return this.store.values(tenantId).find((p) => p.code === normalized);
  }

  async list(tenantId: TenantId, filter: PartnerFilter, page: PageRequest): Promise<Page<Partner>> {
    const productLine = filter.productLine ? normalizeProductLine(filter.productLine) : undefined;
    const matches = this.store
      .values(tenantId)
      .filter((p) => (filter.status ? p.status === filter.status : true))
      .filter((p) => (filter.tier ? p.tier === filter.tier : true))
      .filter((p) => (filter.territory ? territoryCovers(p.territories, filter.territory) : true))
      .filter((p) => (productLine ? p.productLines.includes(productLine) : true))
      .filter((p) => matchesSearch([p.code, p.name], filter.search))
      .sort((a, b) => a.code.localeCompare(b.code));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Partner[]> {
    return this.store.values(tenantId);
  }

  async save(partner: Partner): Promise<void> {
    this.store.set(partner.tenantId, partner.id, partner);
  }
}

export class InMemoryRegistrationRepository implements RegistrationRepository {
  private readonly store = new TenantKeyedStore<DealRegistration>();

  async byId(tenantId: TenantId, id: Ulid): Promise<DealRegistration | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<DealRegistration | undefined> {
    const normalized = number.trim().toUpperCase();
    return this.store.values(tenantId).find((r) => r.number === normalized);
  }

  async list(tenantId: TenantId, filter: RegistrationFilter, page: PageRequest): Promise<Page<DealRegistration>> {
    const at = filter.at ?? nowIso();
    const productLine = filter.productLine ? normalizeProductLine(filter.productLine) : undefined;
    const matches = this.store
      .values(tenantId)
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .filter((r) => (filter.partnerId ? r.partnerId === filter.partnerId : true))
      .filter((r) => (filter.customerKey ? r.customerKey === filter.customerKey : true))
      .filter((r) => (filter.stage ? r.stage === filter.stage : true))
      .filter((r) => (filter.source ? r.source === filter.source : true))
      .filter((r) => (productLine ? r.productLines.includes(productLine) : true))
      .filter((r) => {
        if (filter.expiringWithinDays === undefined) return true;
        const protection = r.protection;
        if (!protection || r.status !== "approved") return false;
        const left = remainingDays(protection, at);
        return left > 0 && left <= filter.expiringWithinDays;
      })
      .filter((r) => matchesSearch([r.number, r.endCustomer.name, r.endCustomer.domain], filter.search))
      .sort((a, b) => b.number.localeCompare(a.number));
    return paginate(matches, page);
  }

  async byCustomerKey(tenantId: TenantId, key: CustomerKey): Promise<readonly DealRegistration[]> {
    return this.store
      .values(tenantId)
      .filter((r) => r.customerKey === key)
      .sort((a, b) => a.number.localeCompare(b.number));
  }

  async protectedAt(tenantId: TenantId, at: IsoDateTime): Promise<readonly DealRegistration[]> {
    return this.store
      .values(tenantId)
      .filter((r) => r.status === "approved" && !!r.protection && isProtectedAt(r.protection, at));
  }

  async lapsedAt(tenantId: TenantId, at: IsoDateTime): Promise<readonly DealRegistration[]> {
    return this.store
      .values(tenantId)
      .filter((r) => r.status === "approved" && !!r.protection && hasLapsed(r.protection, at));
  }

  async all(tenantId: TenantId): Promise<readonly DealRegistration[]> {
    return this.store.values(tenantId);
  }

  async save(registration: DealRegistration): Promise<void> {
    this.store.set(registration.tenantId, registration.id, registration);
  }
}

export class InMemoryReferralRepository implements ReferralRepository {
  private readonly store = new TenantKeyedStore<Referral>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Referral | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<Referral | undefined> {
    const normalized = number.trim().toUpperCase();
    return this.store.values(tenantId).find((r) => r.number === normalized);
  }

  async list(tenantId: TenantId, filter: ReferralFilter, page: PageRequest): Promise<Page<Referral>> {
    const matches = this.store
      .values(tenantId)
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .filter((r) => (filter.partnerId ? r.partnerId === filter.partnerId : true))
      .filter((r) => (filter.customerKey ? r.customerKey === filter.customerKey : true))
      .filter((r) => (filter.commissionStatus ? r.commission?.status === filter.commissionStatus : true))
      .sort((a, b) => b.number.localeCompare(a.number));
    return paginate(matches, page);
  }

  async dueForExpiry(tenantId: TenantId, at: IsoDateTime): Promise<readonly Referral[]> {
    return this.store.values(tenantId).filter((r) => {
      if (r.status === "submitted") return Date.parse(at) >= Date.parse(r.decisionDueAt);
      if (r.status === "accepted") return !!r.attribution && hasLapsed(r.attribution, at);
      return false;
    });
  }

  async all(tenantId: TenantId): Promise<readonly Referral[]> {
    return this.store.values(tenantId);
  }

  async save(referral: Referral): Promise<void> {
    this.store.set(referral.tenantId, referral.id, referral);
  }
}

export class InMemoryChannelQuoteRepository implements ChannelQuoteRepository {
  private readonly store = new TenantKeyedStore<ChannelQuote>();

  async byId(tenantId: TenantId, id: Ulid): Promise<ChannelQuote | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<ChannelQuote | undefined> {
    const normalized = number.trim().toUpperCase();
    return this.store.values(tenantId).find((q) => q.number === normalized);
  }

  async list(tenantId: TenantId, filter: ChannelQuoteFilter, page: PageRequest): Promise<Page<ChannelQuote>> {
    const matches = this.store
      .values(tenantId)
      .filter((q) => (filter.status ? q.status === filter.status : true))
      .filter((q) => (filter.partnerId ? q.partnerId === filter.partnerId : true))
      .filter((q) => (filter.registrationId ? q.registrationId === filter.registrationId : true))
      .filter((q) => (filter.customerKey ? q.customerKey === filter.customerKey : true))
      .sort((a, b) => b.number.localeCompare(a.number));
    return paginate(matches, page);
  }

  async byRegistration(tenantId: TenantId, registrationId: Ulid): Promise<readonly ChannelQuote[]> {
    return this.store.values(tenantId).filter((q) => q.registrationId === registrationId);
  }

  async dueForExpiry(tenantId: TenantId, at: IsoDateTime): Promise<readonly ChannelQuote[]> {
    return this.store
      .values(tenantId)
      .filter((q) => (q.status === "submitted" || q.status === "approved") && q.isExpiredAt(at));
  }

  async all(tenantId: TenantId): Promise<readonly ChannelQuote[]> {
    return this.store.values(tenantId);
  }

  async save(quote: ChannelQuote): Promise<void> {
    this.store.set(quote.tenantId, quote.id, quote);
  }
}

export class InMemoryChannelOrderRepository implements ChannelOrderRepository {
  private readonly store = new TenantKeyedStore<ChannelOrder>();

  async byId(tenantId: TenantId, id: Ulid): Promise<ChannelOrder | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<ChannelOrder | undefined> {
    const normalized = number.trim().toUpperCase();
    return this.store.values(tenantId).find((o) => o.number === normalized);
  }

  async bySalesOrderRef(tenantId: TenantId, ref: string): Promise<ChannelOrder | undefined> {
    const normalized = ref.trim();
    return this.store.values(tenantId).find((o) => o.salesOrderRef.id === normalized);
  }

  async list(tenantId: TenantId, filter: ChannelOrderFilter, page: PageRequest): Promise<Page<ChannelOrder>> {
    const matches = this.store
      .values(tenantId)
      .filter((o) => (filter.status ? o.status === filter.status : true))
      .filter((o) => (filter.partnerId ? o.partnerId === filter.partnerId : true))
      .filter((o) => (filter.registrationId ? o.registrationId === filter.registrationId : true))
      .filter((o) => (filter.sourceType ? o.sourceType === filter.sourceType : true))
      .filter((o) => (filter.from ? Date.parse(o.orderedAt) >= Date.parse(filter.from) : true))
      .filter((o) => (filter.to ? Date.parse(o.orderedAt) <= Date.parse(filter.to) : true))
      .sort((a, b) => Date.parse(b.orderedAt) - Date.parse(a.orderedAt));
    return paginate(matches, page);
  }

  async byRegistration(tenantId: TenantId, registrationId: Ulid): Promise<readonly ChannelOrder[]> {
    return this.store.values(tenantId).filter((o) => o.registrationId === registrationId);
  }

  async all(tenantId: TenantId): Promise<readonly ChannelOrder[]> {
    return this.store.values(tenantId);
  }

  async save(order: ChannelOrder): Promise<void> {
    this.store.set(order.tenantId, order.id, order);
  }
}

export class InMemoryConflictRepository implements ConflictRepository {
  private readonly store = new TenantKeyedStore<ConflictCase>();

  async byId(tenantId: TenantId, id: Ulid): Promise<ConflictCase | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<ConflictCase | undefined> {
    const normalized = number.trim().toUpperCase();
    return this.store.values(tenantId).find((c) => c.number === normalized);
  }

  async list(tenantId: TenantId, filter: ConflictFilter, page: PageRequest): Promise<Page<ConflictCase>> {
    const matches = this.store
      .values(tenantId)
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.kind ? c.kind === filter.kind : true))
      .filter((c) =>
        filter.partnerId ? c.claimantPartnerId === filter.partnerId || c.incumbentPartnerId === filter.partnerId : true,
      )
      .filter((c) => (filter.customerKey ? c.customerKey === filter.customerKey : true))
      .filter((c) => (filter.overdueAt ? c.isOverdueAt(filter.overdueAt) : true))
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async byRegistration(tenantId: TenantId, registrationId: Ulid): Promise<readonly ConflictCase[]> {
    return this.store
      .values(tenantId)
      .filter((c) => c.claimantRegistrationId === registrationId || c.incumbentRegistrationId === registrationId);
  }

  async all(tenantId: TenantId): Promise<readonly ConflictCase[]> {
    return this.store.values(tenantId);
  }

  async save(conflict: ConflictCase): Promise<void> {
    this.store.set(conflict.tenantId, conflict.id, conflict);
  }
}

export class InMemoryDirectClaimRepository implements DirectClaimRepository {
  private readonly byTenant = new Map<TenantId, Map<CustomerKey, DirectClaim>>();

  async list(tenantId: TenantId): Promise<readonly DirectClaim[]> {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }

  async add(tenantId: TenantId, claim: DirectClaim): Promise<void> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    bucket.set(claim.customerKey, claim);
  }

  async remove(tenantId: TenantId, customerKey: CustomerKey): Promise<void> {
    this.byTenant.get(tenantId)?.delete(customerKey);
  }
}

/** Falls back to the shipped defaults until a tenant overrides a tier. */
export class InMemoryTierPolicyRepository implements TierPolicyRepository {
  private readonly byTenant = new Map<TenantId, Map<PartnerTier, TierPolicy>>();

  async get(tenantId: TenantId, tier: PartnerTier): Promise<TierPolicy> {
    return this.byTenant.get(tenantId)?.get(tier) ?? DEFAULT_TIER_POLICIES[tier];
  }

  async all(tenantId: TenantId): Promise<readonly TierPolicy[]> {
    const overrides = this.byTenant.get(tenantId);
    return (Object.keys(DEFAULT_TIER_POLICIES) as PartnerTier[]).map(
      (tier) => overrides?.get(tier) ?? DEFAULT_TIER_POLICIES[tier],
    );
  }

  async save(tenantId: TenantId, policy: TierPolicy): Promise<void> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    bucket.set(policy.tier, policy);
  }
}

export class InMemorySequences implements SequencePort {
  private readonly byTenant = new Map<TenantId, Map<SequenceName, number>>();

  async next(tenantId: TenantId, sequence: SequenceName): Promise<number> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    const next = (bucket.get(sequence) ?? 0) + 1;
    bucket.set(sequence, next);
    return next;
  }
}

export type OutboxSubscriber = (event: EventEnvelope) => void;

/**
 * In-memory stand-in for a transactional outbox: events are appended to a log
 * and fanned out synchronously. The full history stays available so tests and
 * `GET /events` can inspect what a use case actually published.
 */
export class InMemoryOutbox implements OutboxPort {
  private readonly log: EventEnvelope[] = [];
  private readonly subscribers: OutboxSubscriber[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      this.log.push(event);
      for (const subscriber of this.subscribers) subscriber(event);
    }
  }

  subscribe(subscriber: OutboxSubscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  entries(tenantId?: TenantId): readonly EventEnvelope[] {
    return tenantId ? this.log.filter((e) => e.tenantId === tenantId) : [...this.log];
  }

  ofType(eventType: string, tenantId?: TenantId): readonly EventEnvelope[] {
    return this.entries(tenantId).filter((e) => e.eventType === eventType);
  }
}

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }
}

/** Deterministic clock for tests: fixed start, manual ticks. */
export class FixedClock implements Clock {
  private current: number;

  constructor(startIso = "2026-01-01T00:00:00.000Z") {
    this.current = Date.parse(startIso);
  }

  now(): IsoDateTime {
    return new Date(this.current).toISOString() as IsoDateTime;
  }

  advanceDays(days: number): void {
    this.current += days * 86_400_000;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}
