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
import type { CategoryRecord } from "../../domain/category.js";
import type { Certification } from "../../domain/certification.js";
import type { Contract } from "../../domain/contract.js";
import { compareDates, toDateOnly, type DateOnly } from "../../domain/dates.js";
import type { KpiDefinitionRecord } from "../../domain/kpi.js";
import type { OnboardingCase } from "../../domain/onboarding.js";
import type { Qualification } from "../../domain/qualification.js";
import type { SupplierRiskProfile } from "../../domain/risk.js";
import type { Scorecard } from "../../domain/scorecard.js";
import type { Supplier } from "../../domain/supplier.js";
import type {
  CategoryRepository,
  CertificationFilter,
  CertificationRepository,
  Clock,
  ContractFilter,
  ContractRepository,
  KpiDefinitionRepository,
  OnboardingFilter,
  OnboardingRepository,
  OutboxPort,
  QualificationFilter,
  QualificationRepository,
  RiskProfileRepository,
  ScorecardFilter,
  ScorecardRepository,
  SupplierFilter,
  SupplierRepository,
} from "../../application/ports.js";

/**
 * In-memory adapters. Aggregates are stored by reference (single-process
 * semantics); tenant isolation is structural — every map is keyed by tenant
 * first, so a missing tenant can never leak another tenant's data.
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

class SequenceStore {
  private readonly sequences = new Map<TenantId, number>();

  next(tenantId: TenantId): number {
    const next = (this.sequences.get(tenantId) ?? 0) + 1;
    this.sequences.set(tenantId, next);
    return next;
  }
}

export class InMemorySupplierRepository implements SupplierRepository {
  private readonly store = new TenantKeyedStore<Supplier>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Supplier | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<Supplier | undefined> {
    const normalized = code.trim().toUpperCase();
    return this.store.values(tenantId).find((supplier) => supplier.code === normalized);
  }

  async list(tenantId: TenantId, filter: SupplierFilter, page: PageRequest): Promise<Page<Supplier>> {
    const search = filter.search?.trim().toLowerCase();
    const matches = this.store
      .values(tenantId)
      .filter((supplier) => (filter.status ? supplier.status === filter.status : true))
      .filter((supplier) => (filter.classification ? supplier.classification === filter.classification : true))
      .filter((supplier) => (filter.countryCode ? supplier.countryCode === filter.countryCode.toUpperCase() : true))
      .filter((supplier) => (filter.tag ? supplier.tags.includes(filter.tag.toLowerCase()) : true))
      .filter((supplier) =>
        filter.parentSupplierId ? supplier.parentSupplierId === filter.parentSupplierId : true,
      )
      .filter((supplier) =>
        filter.categoryId ? supplier.categories.some((entry) => entry.categoryId === filter.categoryId) : true,
      )
      .filter((supplier) =>
        search
          ? supplier.code.toLowerCase().includes(search) ||
            supplier.legalName.toLowerCase().includes(search) ||
            supplier.displayName.toLowerCase().includes(search)
          : true,
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Supplier[]> {
    return this.store.values(tenantId).sort((a, b) => a.code.localeCompare(b.code));
  }

  async children(tenantId: TenantId, parentSupplierId: Ulid): Promise<readonly Supplier[]> {
    return this.store
      .values(tenantId)
      .filter((supplier) => supplier.parentSupplierId === parentSupplierId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async save(supplier: Supplier): Promise<void> {
    this.store.set(supplier.tenantId, supplier.id, supplier);
  }
}

export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly store = new TenantKeyedStore<CategoryRecord>();

  async byId(tenantId: TenantId, id: Ulid): Promise<CategoryRecord | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<CategoryRecord | undefined> {
    const normalized = code.trim().toLowerCase();
    return this.store.values(tenantId).find((record) => record.code === normalized);
  }

  async all(tenantId: TenantId): Promise<readonly CategoryRecord[]> {
    return this.store.values(tenantId);
  }

  async save(record: CategoryRecord): Promise<void> {
    this.store.set(record.tenantId, record.id, record);
  }

  async saveMany(records: readonly CategoryRecord[]): Promise<void> {
    for (const record of records) this.store.set(record.tenantId, record.id, record);
  }
}

export class InMemoryOnboardingRepository implements OnboardingRepository {
  private readonly store = new TenantKeyedStore<OnboardingCase>();
  private readonly sequences = new SequenceStore();

  async byId(tenantId: TenantId, id: Ulid): Promise<OnboardingCase | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<OnboardingCase | undefined> {
    return this.store.values(tenantId).find((entry) => entry.number === number);
  }

  async bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly OnboardingCase[]> {
    return this.store.values(tenantId).filter((entry) => entry.supplierId === supplierId);
  }

  async list(tenantId: TenantId, filter: OnboardingFilter, page: PageRequest): Promise<Page<OnboardingCase>> {
    const matches = this.store
      .values(tenantId)
      .filter((entry) => (filter.status ? entry.status === filter.status : true))
      .filter((entry) => (filter.supplierId ? entry.supplierId === filter.supplierId : true))
      .filter((entry) => (filter.templateCode ? entry.templateCode === filter.templateCode : true))
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async nextSequence(tenantId: TenantId): Promise<number> {
    return this.sequences.next(tenantId);
  }

  async save(onboarding: OnboardingCase): Promise<void> {
    this.store.set(onboarding.tenantId, onboarding.id, onboarding);
  }
}

export class InMemoryCertificationRepository implements CertificationRepository {
  private readonly store = new TenantKeyedStore<Certification>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Certification | undefined> {
    return this.store.get(tenantId, id);
  }

  async bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Certification[]> {
    return this.store.values(tenantId).filter((entry) => entry.supplierId === supplierId);
  }

  async list(tenantId: TenantId, filter: CertificationFilter, page: PageRequest): Promise<Page<Certification>> {
    const matches = this.store
      .values(tenantId)
      .filter((entry) => (filter.supplierId ? entry.supplierId === filter.supplierId : true))
      .filter((entry) => (filter.type ? entry.type === filter.type : true))
      .filter((entry) => (filter.status ? entry.status === filter.status : true))
      .filter((entry) => (filter.expiringBefore ? compareDates(entry.expiresOn, filter.expiringBefore) <= 0 : true))
      .sort((a, b) => compareDates(a.expiresOn, b.expiresOn) || a.supplierCode.localeCompare(b.supplierCode));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Certification[]> {
    return this.store.values(tenantId);
  }

  async save(certification: Certification): Promise<void> {
    this.store.set(certification.tenantId, certification.id, certification);
  }
}

export class InMemoryQualificationRepository implements QualificationRepository {
  private readonly store = new TenantKeyedStore<Qualification>();
  private readonly sequences = new SequenceStore();

  async byId(tenantId: TenantId, id: Ulid): Promise<Qualification | undefined> {
    return this.store.get(tenantId, id);
  }

  async byReference(tenantId: TenantId, reference: string): Promise<Qualification | undefined> {
    return this.store.values(tenantId).find((entry) => entry.reference === reference);
  }

  async bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Qualification[]> {
    return this.store.values(tenantId).filter((entry) => entry.supplierId === supplierId);
  }

  async list(tenantId: TenantId, filter: QualificationFilter, page: PageRequest): Promise<Page<Qualification>> {
    const matches = this.store
      .values(tenantId)
      .filter((entry) => (filter.supplierId ? entry.supplierId === filter.supplierId : true))
      .filter((entry) => (filter.categoryId ? entry.categoryId === filter.categoryId : true))
      .filter((entry) => (filter.status ? entry.status === filter.status : true))
      .filter((entry) => (filter.outcome ? entry.outcome === filter.outcome : true))
      .sort((a, b) => a.reference.localeCompare(b.reference));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Qualification[]> {
    return this.store.values(tenantId);
  }

  async nextSequence(tenantId: TenantId): Promise<number> {
    return this.sequences.next(tenantId);
  }

  async save(qualification: Qualification): Promise<void> {
    this.store.set(qualification.tenantId, qualification.id, qualification);
  }
}

export class InMemoryKpiDefinitionRepository implements KpiDefinitionRepository {
  private readonly store = new TenantKeyedStore<KpiDefinitionRecord>();

  async byId(tenantId: TenantId, id: Ulid): Promise<KpiDefinitionRecord | undefined> {
    return this.store.get(tenantId, id);
  }

  async byCode(tenantId: TenantId, code: string): Promise<KpiDefinitionRecord | undefined> {
    return this.store.values(tenantId).find((record) => record.code === code.trim().toLowerCase());
  }

  async all(tenantId: TenantId): Promise<readonly KpiDefinitionRecord[]> {
    return this.store.values(tenantId);
  }

  async active(tenantId: TenantId): Promise<readonly KpiDefinitionRecord[]> {
    return this.store.values(tenantId).filter((record) => record.isActive);
  }

  async save(record: KpiDefinitionRecord): Promise<void> {
    this.store.set(record.tenantId, record.id, record);
  }
}

export class InMemoryScorecardRepository implements ScorecardRepository {
  private readonly store = new TenantKeyedStore<Scorecard>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Scorecard | undefined> {
    return this.store.get(tenantId, id);
  }

  async bySupplierPeriod(tenantId: TenantId, supplierId: Ulid, periodCode: string): Promise<Scorecard | undefined> {
    return this.store
      .values(tenantId)
      .find((entry) => entry.supplierId === supplierId && entry.periodCode === periodCode);
  }

  async bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Scorecard[]> {
    return this.store.values(tenantId).filter((entry) => entry.supplierId === supplierId);
  }

  async list(tenantId: TenantId, filter: ScorecardFilter, page: PageRequest): Promise<Page<Scorecard>> {
    const matches = this.store
      .values(tenantId)
      .filter((entry) => (filter.supplierId ? entry.supplierId === filter.supplierId : true))
      .filter((entry) => (filter.periodCode ? entry.periodCode === filter.periodCode : true))
      .filter((entry) => (filter.status ? entry.status === filter.status : true))
      .filter((entry) => (filter.rating ? entry.rating === filter.rating : true))
      .sort((a, b) => b.periodCode.localeCompare(a.periodCode) || a.supplierCode.localeCompare(b.supplierCode));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Scorecard[]> {
    return this.store.values(tenantId);
  }

  async save(scorecard: Scorecard): Promise<void> {
    this.store.set(scorecard.tenantId, scorecard.id, scorecard);
  }
}

export class InMemoryContractRepository implements ContractRepository {
  private readonly store = new TenantKeyedStore<Contract>();
  private readonly sequences = new SequenceStore();

  async byId(tenantId: TenantId, id: Ulid): Promise<Contract | undefined> {
    return this.store.get(tenantId, id);
  }

  async byNumber(tenantId: TenantId, number: string): Promise<Contract | undefined> {
    return this.store.values(tenantId).find((entry) => entry.number === number);
  }

  async bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Contract[]> {
    return this.store.values(tenantId).filter((entry) => entry.supplierId === supplierId);
  }

  async list(tenantId: TenantId, filter: ContractFilter, page: PageRequest): Promise<Page<Contract>> {
    const matches = this.store
      .values(tenantId)
      .filter((entry) => (filter.supplierId ? entry.supplierId === filter.supplierId : true))
      .filter((entry) => (filter.status ? entry.status === filter.status : true))
      .filter((entry) => (filter.type ? entry.type === filter.type : true))
      .filter((entry) => (filter.categoryId ? entry.coversCategory(filter.categoryId) : true))
      .filter((entry) =>
        filter.expiringBefore
          ? entry.effectiveTo !== undefined && compareDates(entry.effectiveTo, filter.expiringBefore) <= 0
          : true,
      )
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Contract[]> {
    return this.store.values(tenantId);
  }

  async nextSequence(tenantId: TenantId): Promise<number> {
    return this.sequences.next(tenantId);
  }

  async save(contract: Contract): Promise<void> {
    this.store.set(contract.tenantId, contract.id, contract);
  }
}

export class InMemoryRiskProfileRepository implements RiskProfileRepository {
  private readonly store = new TenantKeyedStore<SupplierRiskProfile>();

  async bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<SupplierRiskProfile | undefined> {
    return this.store.values(tenantId).find((profile) => profile.supplierId === supplierId);
  }

  async all(tenantId: TenantId): Promise<readonly SupplierRiskProfile[]> {
    return this.store.values(tenantId);
  }

  async save(profile: SupplierRiskProfile): Promise<void> {
    this.store.set(profile.tenantId, profile.id, profile);
  }
}

export type OutboxSubscriber = (event: EventEnvelope) => void;

/**
 * In-memory stand-in for a transactional outbox: events are appended to a log
 * and fanned out to subscribers synchronously. `entries` keeps the full
 * history so tests and the demo `/events` endpoint can inspect what happened.
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
    return tenantId ? this.log.filter((event) => event.tenantId === tenantId) : [...this.log];
  }
}

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }

  today(): DateOnly {
    return toDateOnly(nowIso());
  }
}

/** Deterministic clock for tests: starts at a fixed instant, ticks manually. */
export class FixedClock implements Clock {
  private current: number;

  constructor(startIso = "2026-01-01T00:00:00.000Z") {
    this.current = Date.parse(startIso);
  }

  now(): IsoDateTime {
    return new Date(this.current).toISOString() as IsoDateTime;
  }

  today(): DateOnly {
    return new Date(this.current).toISOString().slice(0, 10) as DateOnly;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  advanceDays(days: number): void {
    this.current += days * 86_400_000;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}
