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
import type { Certification } from "../../domain/certification.js";
import type { PartnerContract } from "../../domain/contract.js";
import type { EntitlementDefinition, EntitlementGrant } from "../../domain/entitlement.js";
import type { MdfBudget } from "../../domain/mdf-budget.js";
import type { MdfClaim } from "../../domain/mdf-claim.js";
import type { MdfRequest } from "../../domain/mdf-request.js";
import type { Partner } from "../../domain/partner.js";
import type { PerformanceSnapshot } from "../../domain/performance.js";
import type { PortalUser } from "../../domain/portal-user.js";
import type { TierDefinition } from "../../domain/tier.js";
import type { CertificationDefinition, Course, Enrollment } from "../../domain/training.js";
import type {
  CertificationDefinitionRepository,
  CertificationFilter,
  CertificationRepository,
  Clock,
  ContractFilter,
  ContractRepository,
  CourseRepository,
  EnrollmentFilter,
  EnrollmentRepository,
  EntitlementDefinitionRepository,
  EntitlementGrantRepository,
  MdfBudgetFilter,
  MdfBudgetRepository,
  MdfClaimFilter,
  MdfClaimRepository,
  MdfRequestFilter,
  MdfRequestRepository,
  OutboxPort,
  PartnerFilter,
  PartnerRepository,
  PerformanceRepository,
  PortalUserFilter,
  PortalUserRepository,
  SequenceRepository,
  TierDefinitionRepository,
  TokenIssuer,
} from "../../application/ports.js";

/**
 * In-memory adapters.
 *
 * Aggregates are held by reference (single-process semantics) and tenant
 * isolation is structural: every map is keyed by tenant first, so a query for
 * a tenant that has no bucket physically cannot see another tenant's rows.
 */

class TenantKeyedStore<T> {
  private readonly byTenant = new Map<TenantId, Map<string, T>>();

  private bucket(tenantId: TenantId): Map<string, T> {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    return bucket;
  }

  get(tenantId: TenantId, id: string): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  set(tenantId: TenantId, id: string, value: T): void {
    this.bucket(tenantId).set(id, value);
  }

  delete(tenantId: TenantId, id: string): void {
    this.byTenant.get(tenantId)?.delete(id);
  }

  values(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }
}

function matchesSearch(needle: string | undefined, ...haystack: (string | undefined)[]): boolean {
  if (!needle) return true;
  const wanted = needle.trim().toLowerCase();
  return haystack.some((value) => value !== undefined && value.toLowerCase().includes(wanted));
}

export class InMemoryPartnerRepository implements PartnerRepository {
  private readonly store = new TenantKeyedStore<Partner>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Partner | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<Partner | undefined> {
    const wanted = number.trim().toUpperCase();
    return this.store.values(tenantId).find((p) => p.number === wanted);
  }

  async byLegalName(tenantId: TenantId, legalName: string): Promise<Partner | undefined> {
    const wanted = legalName.trim().toLowerCase();
    return this.store.values(tenantId).find((p) => p.legalName.toLowerCase() === wanted);
  }

  async children(tenantId: TenantId, parentPartnerId: Ulid): Promise<readonly Partner[]> {
    return this.store.values(tenantId).filter((p) => p.parentPartnerId === parentPartnerId);
  }

  async list(tenantId: TenantId, filter: PartnerFilter, page: PageRequest): Promise<Page<Partner>> {
    const matches = this.store
      .values(tenantId)
      .filter((p) => (filter.status ? p.status === filter.status : true))
      .filter((p) => (filter.type ? p.type === filter.type : true))
      .filter((p) => (filter.tierCode ? p.tierCode === filter.tierCode : true))
      .filter((p) => (filter.territory ? p.coversTerritory(filter.territory) : true))
      .filter((p) => (filter.parentPartnerId ? p.parentPartnerId === filter.parentPartnerId : true))
      .filter((p) => matchesSearch(filter.search, p.number, p.legalName, p.displayName))
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Partner[]> {
    return this.store.values(tenantId);
  }

  async save(partner: Partner): Promise<void> {
    this.store.set(partner.tenantId, partner.id, partner);
  }
}

export class InMemoryTierDefinitionRepository implements TierDefinitionRepository {
  private readonly store = new TenantKeyedStore<TierDefinition>();

  async byId(tenantId: TenantId, id: Ulid): Promise<TierDefinition | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<TierDefinition | undefined> {
    const wanted = code.trim().toLowerCase();
    return this.store.values(tenantId).find((t) => t.code === wanted);
  }

  async byRank(tenantId: TenantId, rank: number): Promise<TierDefinition | undefined> {
    return this.store.values(tenantId).find((t) => t.rank === rank);
  }

  async all(tenantId: TenantId): Promise<readonly TierDefinition[]> {
    return this.store.values(tenantId);
  }

  async save(definition: TierDefinition): Promise<void> {
    this.store.set(definition.tenantId, definition.id, definition);
  }
}

export class InMemoryPerformanceRepository implements PerformanceRepository {
  private readonly store = new TenantKeyedStore<PerformanceSnapshot>();

  async byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly PerformanceSnapshot[]> {
    return this.store
      .values(tenantId)
      .filter((s) => s.partnerId === partnerId)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  }

  async byPartnerAndPeriod(
    tenantId: TenantId,
    partnerId: Ulid,
    period: string,
  ): Promise<PerformanceSnapshot | undefined> {
    return this.store
      .values(tenantId)
      .find((s) => s.partnerId === partnerId && s.period === period.toUpperCase());
  }

  /** One snapshot per partner and period: re-reporting replaces the row. */
  async save(snapshot: PerformanceSnapshot): Promise<void> {
    const existing = await this.byPartnerAndPeriod(snapshot.tenantId, snapshot.partnerId, snapshot.period);
    if (existing) this.store.delete(snapshot.tenantId, existing.id);
    this.store.set(snapshot.tenantId, snapshot.id, snapshot);
  }
}

export class InMemoryContractRepository implements ContractRepository {
  private readonly store = new TenantKeyedStore<PartnerContract>();

  async byId(tenantId: TenantId, id: Ulid): Promise<PartnerContract | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<PartnerContract | undefined> {
    const wanted = number.trim().toUpperCase();
    return this.store.values(tenantId).find((c) => c.number === wanted);
  }

  async byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly PartnerContract[]> {
    return this.store
      .values(tenantId)
      .filter((c) => c.partnerId === partnerId)
      .sort((a, b) => a.number.localeCompare(b.number));
  }

  async list(tenantId: TenantId, filter: ContractFilter, page: PageRequest): Promise<Page<PartnerContract>> {
    const matches = this.store
      .values(tenantId)
      .filter((c) => (filter.partnerId ? c.partnerId === filter.partnerId : true))
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.type ? c.type === filter.type : true))
      .filter((c) =>
        filter.expiringBefore ? Date.parse(c.effectiveTo) < Date.parse(filter.expiringBefore) : true,
      )
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly PartnerContract[]> {
    return this.store.values(tenantId);
  }

  async save(contract: PartnerContract): Promise<void> {
    this.store.set(contract.tenantId, contract.id, contract);
  }
}

export class InMemoryMdfBudgetRepository implements MdfBudgetRepository {
  private readonly store = new TenantKeyedStore<MdfBudget>();

  async byId(tenantId: TenantId, id: Ulid): Promise<MdfBudget | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<MdfBudget | undefined> {
    const wanted = code.trim().toUpperCase();
    return this.store.values(tenantId).find((b) => b.code === wanted);
  }

  async list(tenantId: TenantId, filter: MdfBudgetFilter, page: PageRequest): Promise<Page<MdfBudget>> {
    const matches = this.store
      .values(tenantId)
      .filter((b) => (filter.status ? b.status === filter.status : true))
      .filter((b) => (filter.period ? b.period === filter.period.toUpperCase() : true))
      .filter((b) => (filter.partnerId ? b.allocationForPartner(filter.partnerId) !== undefined : true))
      .sort((a, b) => a.period.localeCompare(b.period) || a.code.localeCompare(b.code));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly MdfBudget[]> {
    return this.store.values(tenantId);
  }

  async save(budget: MdfBudget): Promise<void> {
    this.store.set(budget.tenantId, budget.id, budget);
  }
}

export class InMemoryMdfRequestRepository implements MdfRequestRepository {
  private readonly store = new TenantKeyedStore<MdfRequest>();

  async byId(tenantId: TenantId, id: Ulid): Promise<MdfRequest | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<MdfRequest | undefined> {
    const wanted = number.trim().toUpperCase();
    return this.store.values(tenantId).find((r) => r.number === wanted);
  }

  async byBudget(tenantId: TenantId, budgetId: Ulid): Promise<readonly MdfRequest[]> {
    return this.store.values(tenantId).filter((r) => r.budgetId === budgetId);
  }

  async list(tenantId: TenantId, filter: MdfRequestFilter, page: PageRequest): Promise<Page<MdfRequest>> {
    const matches = this.store
      .values(tenantId)
      .filter((r) => (filter.partnerId ? r.partnerId === filter.partnerId : true))
      .filter((r) => (filter.budgetId ? r.budgetId === filter.budgetId : true))
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .filter((r) => (filter.activityType ? r.activityType === filter.activityType : true))
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async save(request: MdfRequest): Promise<void> {
    this.store.set(request.tenantId, request.id, request);
  }
}

export class InMemoryMdfClaimRepository implements MdfClaimRepository {
  private readonly store = new TenantKeyedStore<MdfClaim>();

  async byId(tenantId: TenantId, id: Ulid): Promise<MdfClaim | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<MdfClaim | undefined> {
    const wanted = number.trim().toUpperCase();
    return this.store.values(tenantId).find((c) => c.number === wanted);
  }

  async byRequest(tenantId: TenantId, requestId: Ulid): Promise<readonly MdfClaim[]> {
    return this.store
      .values(tenantId)
      .filter((c) => c.requestId === requestId)
      .sort((a, b) => a.number.localeCompare(b.number));
  }

  async list(tenantId: TenantId, filter: MdfClaimFilter, page: PageRequest): Promise<Page<MdfClaim>> {
    const matches = this.store
      .values(tenantId)
      .filter((c) => (filter.partnerId ? c.partnerId === filter.partnerId : true))
      .filter((c) => (filter.requestId ? c.requestId === filter.requestId : true))
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async save(claim: MdfClaim): Promise<void> {
    this.store.set(claim.tenantId, claim.id, claim);
  }
}

export class InMemoryCourseRepository implements CourseRepository {
  private readonly store = new TenantKeyedStore<Course>();

  async byCode(tenantId: TenantId, code: string): Promise<Course | undefined> {
    return this.store.get(tenantId, code.trim().toLowerCase());
  }

  async all(tenantId: TenantId): Promise<readonly Course[]> {
    return this.store.values(tenantId).sort((a, b) => a.code.localeCompare(b.code));
  }

  async save(course: Course): Promise<void> {
    this.store.set(course.tenantId, course.code, course);
  }
}

export class InMemoryCertificationDefinitionRepository implements CertificationDefinitionRepository {
  private readonly store = new TenantKeyedStore<CertificationDefinition>();

  async byCode(tenantId: TenantId, code: string): Promise<CertificationDefinition | undefined> {
    return this.store.get(tenantId, code.trim().toLowerCase());
  }

  async all(tenantId: TenantId): Promise<readonly CertificationDefinition[]> {
    return this.store.values(tenantId).sort((a, b) => a.code.localeCompare(b.code));
  }

  async save(definition: CertificationDefinition): Promise<void> {
    this.store.set(definition.tenantId, definition.code, definition);
  }
}

export class InMemoryEnrollmentRepository implements EnrollmentRepository {
  private readonly store = new TenantKeyedStore<Enrollment>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Enrollment | undefined> {
    return this.store.get(tenantId, id);
  }

  async byUser(tenantId: TenantId, portalUserId: Ulid): Promise<readonly Enrollment[]> {
    return this.store.values(tenantId).filter((e) => e.portalUserId === portalUserId);
  }

  async activeForUserAndCourse(
    tenantId: TenantId,
    portalUserId: Ulid,
    courseCode: string,
  ): Promise<Enrollment | undefined> {
    const wanted = courseCode.trim().toLowerCase();
    return this.store
      .values(tenantId)
      .find(
        (e) =>
          e.portalUserId === portalUserId &&
          e.courseCode === wanted &&
          e.status !== "withdrawn" &&
          e.status !== "completed",
      );
  }

  async list(tenantId: TenantId, filter: EnrollmentFilter, page: PageRequest): Promise<Page<Enrollment>> {
    const matches = this.store
      .values(tenantId)
      .filter((e) => (filter.partnerId ? e.partnerId === filter.partnerId : true))
      .filter((e) => (filter.portalUserId ? e.portalUserId === filter.portalUserId : true))
      .filter((e) => (filter.courseCode ? e.courseCode === filter.courseCode.toLowerCase() : true))
      .filter((e) => (filter.status ? e.status === filter.status : true))
      .sort((a, b) => a.courseCode.localeCompare(b.courseCode));
    return paginate(matches, page);
  }

  async save(enrollment: Enrollment): Promise<void> {
    this.store.set(enrollment.tenantId, enrollment.id, enrollment);
  }
}

export class InMemoryCertificationRepository implements CertificationRepository {
  private readonly store = new TenantKeyedStore<Certification>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Certification | undefined> {
    return this.store.get(tenantId, id);
  }

  async byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly Certification[]> {
    return this.store.values(tenantId).filter((c) => c.partnerId === partnerId);
  }

  async byUser(tenantId: TenantId, portalUserId: Ulid): Promise<readonly Certification[]> {
    return this.store.values(tenantId).filter((c) => c.portalUserId === portalUserId);
  }

  async forUserAndCode(
    tenantId: TenantId,
    portalUserId: Ulid,
    certificationCode: string,
  ): Promise<Certification | undefined> {
    const wanted = certificationCode.trim().toLowerCase();
    return this.store
      .values(tenantId)
      .filter((c) => c.portalUserId === portalUserId && c.certificationCode === wanted)
      .sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))[0];
  }

  async list(tenantId: TenantId, filter: CertificationFilter, page: PageRequest): Promise<Page<Certification>> {
    const matches = this.store
      .values(tenantId)
      .filter((c) => (filter.partnerId ? c.partnerId === filter.partnerId : true))
      .filter((c) => (filter.portalUserId ? c.portalUserId === filter.portalUserId : true))
      .filter((c) =>
        filter.certificationCode ? c.certificationCode === filter.certificationCode.toLowerCase() : true,
      )
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .sort((a, b) => a.certificationCode.localeCompare(b.certificationCode));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Certification[]> {
    return this.store.values(tenantId);
  }

  async save(certification: Certification): Promise<void> {
    this.store.set(certification.tenantId, certification.id, certification);
  }
}

export class InMemoryPortalUserRepository implements PortalUserRepository {
  private readonly store = new TenantKeyedStore<PortalUser>();

  async byId(tenantId: TenantId, id: Ulid): Promise<PortalUser | undefined> {
    return this.store.get(tenantId, id);
  }

  async byEmail(tenantId: TenantId, email: string): Promise<PortalUser | undefined> {
    const wanted = email.trim().toLowerCase();
    return this.store.values(tenantId).find((u) => u.email === wanted);
  }

  async byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly PortalUser[]> {
    return this.store
      .values(tenantId)
      .filter((u) => u.partnerId === partnerId)
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  async list(tenantId: TenantId, filter: PortalUserFilter, page: PageRequest): Promise<Page<PortalUser>> {
    const matches = this.store
      .values(tenantId)
      .filter((u) => (filter.partnerId ? u.partnerId === filter.partnerId : true))
      .filter((u) => (filter.status ? u.status === filter.status : true))
      .filter((u) => (filter.role ? u.hasRole(filter.role) : true))
      .filter((u) => matchesSearch(filter.search, u.email, u.fullName))
      .sort((a, b) => a.email.localeCompare(b.email));
    return paginate(matches, page);
  }

  async save(user: PortalUser): Promise<void> {
    this.store.set(user.tenantId, user.id, user);
  }
}

export class InMemoryEntitlementDefinitionRepository implements EntitlementDefinitionRepository {
  private readonly store = new TenantKeyedStore<EntitlementDefinition>();

  async byCode(tenantId: TenantId, code: string): Promise<EntitlementDefinition | undefined> {
    return this.store.get(tenantId, code.trim().toLowerCase());
  }

  async all(tenantId: TenantId): Promise<readonly EntitlementDefinition[]> {
    return this.store.values(tenantId);
  }

  async save(definition: EntitlementDefinition): Promise<void> {
    this.store.set(definition.tenantId, definition.code, definition);
  }
}

export class InMemoryEntitlementGrantRepository implements EntitlementGrantRepository {
  private readonly store = new TenantKeyedStore<EntitlementGrant>();

  async byId(tenantId: TenantId, id: Ulid): Promise<EntitlementGrant | undefined> {
    return this.store.get(tenantId, id);
  }

  async forPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly EntitlementGrant[]> {
    return this.store.values(tenantId).filter((g) => g.subject === "partner" && g.subjectId === partnerId);
  }

  async forUser(tenantId: TenantId, portalUserId: Ulid): Promise<readonly EntitlementGrant[]> {
    return this.store.values(tenantId).filter((g) => g.subject === "user" && g.subjectId === portalUserId);
  }

  async all(tenantId: TenantId): Promise<readonly EntitlementGrant[]> {
    return this.store.values(tenantId);
  }

  async save(grant: EntitlementGrant): Promise<void> {
    this.store.set(grant.tenantId, grant.id, grant);
  }

  async revoke(tenantId: TenantId, id: Ulid, at: IsoDateTime): Promise<EntitlementGrant | undefined> {
    const grant = this.store.get(tenantId, id);
    if (!grant || grant.revokedAt) return undefined;
    const revoked: EntitlementGrant = { ...grant, revokedAt: at };
    this.store.set(tenantId, id, revoked);
    return revoked;
  }
}

export class InMemorySequenceRepository implements SequenceRepository {
  private readonly counters = new Map<string, number>();

  async next(tenantId: TenantId, key: string): Promise<number> {
    const composite = `${tenantId}:${key}`;
    const next = (this.counters.get(composite) ?? 0) + 1;
    this.counters.set(composite, next);
    return next;
  }
}

export type OutboxSubscriber = (event: EventEnvelope) => void;

/**
 * In-memory stand-in for a transactional outbox: events are appended to a log
 * and fanned out synchronously. The full history stays queryable so tests and
 * the `/events` endpoint can inspect what a workflow emitted.
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
    this.current += days * 24 * 60 * 60 * 1000;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}

export class RandomTokenIssuer implements TokenIssuer {
  issue(purpose: string): string {
    return `${purpose}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  }
}

/** Predictable invite references so fixtures and assertions stay readable. */
export class SequentialTokenIssuer implements TokenIssuer {
  private counter = 0;

  issue(purpose: string): string {
    this.counter += 1;
    return `${purpose}_${String(this.counter).padStart(4, "0")}`;
  }
}
