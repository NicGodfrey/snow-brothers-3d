import type {
  EventEnvelope,
  IsoDateTime,
  Page,
  PageRequest,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { CategoryRecord } from "../domain/category.js";
import type { Certification, CertificationStatus, CertificationType } from "../domain/certification.js";
import type { Contract, ContractStatus, ContractType } from "../domain/contract.js";
import type { DateOnly } from "../domain/dates.js";
import type { KpiDefinitionRecord } from "../domain/kpi.js";
import type { OnboardingCase, OnboardingStatus } from "../domain/onboarding.js";
import type { Qualification, QualificationOutcome, QualificationStatus } from "../domain/qualification.js";
import type { SupplierRiskProfile } from "../domain/risk.js";
import type { Scorecard, ScorecardStatus } from "../domain/scorecard.js";
import type { Supplier, SupplierClassification, SupplierStatus } from "../domain/supplier.js";

/**
 * Ports the application layer depends on. In-memory implementations live in
 * `infrastructure/memory`; a Postgres adapter can implement the same
 * contracts without touching a service.
 */

export interface SupplierFilter {
  readonly status?: SupplierStatus;
  readonly classification?: SupplierClassification;
  readonly categoryId?: Ulid;
  readonly countryCode?: string;
  readonly tag?: string;
  readonly parentSupplierId?: Ulid;
  /** Case-insensitive substring match on code, legal name or trade name. */
  readonly search?: string;
}

export interface SupplierRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Supplier | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<Supplier | undefined>;
  list(tenantId: TenantId, filter: SupplierFilter, page: PageRequest): Promise<Page<Supplier>>;
  all(tenantId: TenantId): Promise<readonly Supplier[]>;
  children(tenantId: TenantId, parentSupplierId: Ulid): Promise<readonly Supplier[]>;
  save(supplier: Supplier): Promise<void>;
}

export interface CategoryRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<CategoryRecord | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<CategoryRecord | undefined>;
  all(tenantId: TenantId): Promise<readonly CategoryRecord[]>;
  save(record: CategoryRecord): Promise<void>;
  saveMany(records: readonly CategoryRecord[]): Promise<void>;
}

export interface OnboardingFilter {
  readonly status?: OnboardingStatus;
  readonly supplierId?: Ulid;
  readonly templateCode?: string;
}

export interface OnboardingRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<OnboardingCase | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<OnboardingCase | undefined>;
  bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly OnboardingCase[]>;
  list(tenantId: TenantId, filter: OnboardingFilter, page: PageRequest): Promise<Page<OnboardingCase>>;
  /** Monotonic per-tenant sequence used to mint ONB-00001 numbers. */
  nextSequence(tenantId: TenantId): Promise<number>;
  save(onboarding: OnboardingCase): Promise<void>;
}

export interface CertificationFilter {
  readonly supplierId?: Ulid;
  readonly type?: CertificationType;
  readonly status?: CertificationStatus;
  /** Certificates expiring on or before this date. */
  readonly expiringBefore?: DateOnly;
}

export interface CertificationRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Certification | undefined>;
  bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Certification[]>;
  list(tenantId: TenantId, filter: CertificationFilter, page: PageRequest): Promise<Page<Certification>>;
  all(tenantId: TenantId): Promise<readonly Certification[]>;
  save(certification: Certification): Promise<void>;
}

export interface QualificationFilter {
  readonly supplierId?: Ulid;
  readonly categoryId?: Ulid;
  readonly status?: QualificationStatus;
  readonly outcome?: QualificationOutcome;
}

export interface QualificationRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Qualification | undefined>;
  byReference(tenantId: TenantId, reference: string): Promise<Qualification | undefined>;
  bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Qualification[]>;
  list(tenantId: TenantId, filter: QualificationFilter, page: PageRequest): Promise<Page<Qualification>>;
  all(tenantId: TenantId): Promise<readonly Qualification[]>;
  nextSequence(tenantId: TenantId): Promise<number>;
  save(qualification: Qualification): Promise<void>;
}

export interface KpiDefinitionRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<KpiDefinitionRecord | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<KpiDefinitionRecord | undefined>;
  all(tenantId: TenantId): Promise<readonly KpiDefinitionRecord[]>;
  active(tenantId: TenantId): Promise<readonly KpiDefinitionRecord[]>;
  save(record: KpiDefinitionRecord): Promise<void>;
}

export interface ScorecardFilter {
  readonly supplierId?: Ulid;
  readonly periodCode?: string;
  readonly status?: ScorecardStatus;
  readonly rating?: string;
}

export interface ScorecardRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Scorecard | undefined>;
  bySupplierPeriod(tenantId: TenantId, supplierId: Ulid, periodCode: string): Promise<Scorecard | undefined>;
  bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Scorecard[]>;
  list(tenantId: TenantId, filter: ScorecardFilter, page: PageRequest): Promise<Page<Scorecard>>;
  all(tenantId: TenantId): Promise<readonly Scorecard[]>;
  save(scorecard: Scorecard): Promise<void>;
}

export interface ContractFilter {
  readonly supplierId?: Ulid;
  readonly status?: ContractStatus;
  readonly type?: ContractType;
  readonly categoryId?: Ulid;
  /** Contracts whose term ends on or before this date. */
  readonly expiringBefore?: DateOnly;
}

export interface ContractRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Contract | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<Contract | undefined>;
  bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<readonly Contract[]>;
  list(tenantId: TenantId, filter: ContractFilter, page: PageRequest): Promise<Page<Contract>>;
  all(tenantId: TenantId): Promise<readonly Contract[]>;
  nextSequence(tenantId: TenantId): Promise<number>;
  save(contract: Contract): Promise<void>;
}

export interface RiskProfileRepository {
  bySupplier(tenantId: TenantId, supplierId: Ulid): Promise<SupplierRiskProfile | undefined>;
  all(tenantId: TenantId): Promise<readonly SupplierRiskProfile[]>;
  save(profile: SupplierRiskProfile): Promise<void>;
}

/** Transactional-outbox stand-in: publish after (in-memory) commit. */
export interface OutboxPort {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}

export interface Clock {
  now(): IsoDateTime;
  /** Today's calendar date in UTC; all date-only domain rules use this. */
  today(): DateOnly;
}
