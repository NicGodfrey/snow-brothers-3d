import type {
  EventEnvelope,
  IsoDateTime,
  Page,
  PageRequest,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { Certification, CertificationStatus } from "../domain/certification.js";
import type { PartnerContract, ContractStatus, ContractType } from "../domain/contract.js";
import type { EntitlementDefinition, EntitlementGrant } from "../domain/entitlement.js";
import type { MdfBudget, MdfBudgetStatus } from "../domain/mdf-budget.js";
import type { MdfClaim, MdfClaimStatus } from "../domain/mdf-claim.js";
import type { MdfRequest, MdfActivityType, MdfRequestStatus } from "../domain/mdf-request.js";
import type { Partner, PartnerStatus, PartnerType } from "../domain/partner.js";
import type { PerformanceSnapshot } from "../domain/performance.js";
import type { PortalUser, PortalRole, PortalUserStatus } from "../domain/portal-user.js";
import type { CertificationDefinition, Course, Enrollment, EnrollmentStatus } from "../domain/training.js";
import type { TierDefinition } from "../domain/tier.js";

/**
 * Ports the application layer depends on.
 *
 * Every read is tenant-scoped by signature, not by convention, so a Postgres
 * adapter cannot accidentally forget the predicate. In-memory implementations
 * live in infrastructure/memory.
 */

export interface PartnerFilter {
  readonly status?: PartnerStatus;
  readonly type?: PartnerType;
  readonly tierCode?: string;
  readonly territory?: string;
  readonly parentPartnerId?: Ulid;
  /** Case-insensitive substring match on number, legal or display name. */
  readonly search?: string;
}

export interface PartnerRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Partner | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<Partner | undefined>;
  byLegalName(tenantId: TenantId, legalName: string): Promise<Partner | undefined>;
  children(tenantId: TenantId, parentPartnerId: Ulid): Promise<readonly Partner[]>;
  list(tenantId: TenantId, filter: PartnerFilter, page: PageRequest): Promise<Page<Partner>>;
  all(tenantId: TenantId): Promise<readonly Partner[]>;
  save(partner: Partner): Promise<void>;
}

export interface TierDefinitionRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<TierDefinition | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<TierDefinition | undefined>;
  byRank(tenantId: TenantId, rank: number): Promise<TierDefinition | undefined>;
  all(tenantId: TenantId): Promise<readonly TierDefinition[]>;
  save(definition: TierDefinition): Promise<void>;
}

export interface PerformanceRepository {
  byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly PerformanceSnapshot[]>;
  byPartnerAndPeriod(
    tenantId: TenantId,
    partnerId: Ulid,
    period: string,
  ): Promise<PerformanceSnapshot | undefined>;
  save(snapshot: PerformanceSnapshot): Promise<void>;
}

export interface ContractFilter {
  readonly partnerId?: Ulid;
  readonly status?: ContractStatus;
  readonly type?: ContractType;
  /** Contracts whose term ends before this instant (renewal sweeps). */
  readonly expiringBefore?: IsoDateTime;
}

export interface ContractRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<PartnerContract | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<PartnerContract | undefined>;
  byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly PartnerContract[]>;
  list(tenantId: TenantId, filter: ContractFilter, page: PageRequest): Promise<Page<PartnerContract>>;
  all(tenantId: TenantId): Promise<readonly PartnerContract[]>;
  save(contract: PartnerContract): Promise<void>;
}

export interface MdfBudgetFilter {
  readonly status?: MdfBudgetStatus;
  readonly period?: string;
  readonly partnerId?: Ulid;
}

export interface MdfBudgetRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<MdfBudget | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<MdfBudget | undefined>;
  list(tenantId: TenantId, filter: MdfBudgetFilter, page: PageRequest): Promise<Page<MdfBudget>>;
  all(tenantId: TenantId): Promise<readonly MdfBudget[]>;
  save(budget: MdfBudget): Promise<void>;
}

export interface MdfRequestFilter {
  readonly partnerId?: Ulid;
  readonly budgetId?: Ulid;
  readonly status?: MdfRequestStatus;
  readonly activityType?: MdfActivityType;
}

export interface MdfRequestRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<MdfRequest | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<MdfRequest | undefined>;
  list(tenantId: TenantId, filter: MdfRequestFilter, page: PageRequest): Promise<Page<MdfRequest>>;
  byBudget(tenantId: TenantId, budgetId: Ulid): Promise<readonly MdfRequest[]>;
  save(request: MdfRequest): Promise<void>;
}

export interface MdfClaimFilter {
  readonly partnerId?: Ulid;
  readonly requestId?: Ulid;
  readonly status?: MdfClaimStatus;
}

export interface MdfClaimRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<MdfClaim | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<MdfClaim | undefined>;
  byRequest(tenantId: TenantId, requestId: Ulid): Promise<readonly MdfClaim[]>;
  list(tenantId: TenantId, filter: MdfClaimFilter, page: PageRequest): Promise<Page<MdfClaim>>;
  save(claim: MdfClaim): Promise<void>;
}

export interface CourseRepository {
  byCode(tenantId: TenantId, code: string): Promise<Course | undefined>;
  all(tenantId: TenantId): Promise<readonly Course[]>;
  save(course: Course): Promise<void>;
}

export interface CertificationDefinitionRepository {
  byCode(tenantId: TenantId, code: string): Promise<CertificationDefinition | undefined>;
  all(tenantId: TenantId): Promise<readonly CertificationDefinition[]>;
  save(definition: CertificationDefinition): Promise<void>;
}

export interface EnrollmentFilter {
  readonly partnerId?: Ulid;
  readonly portalUserId?: Ulid;
  readonly courseCode?: string;
  readonly status?: EnrollmentStatus;
}

export interface EnrollmentRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Enrollment | undefined>;
  byUser(tenantId: TenantId, portalUserId: Ulid): Promise<readonly Enrollment[]>;
  /** Any non-withdrawn enrollment of that user in that course. */
  activeForUserAndCourse(
    tenantId: TenantId,
    portalUserId: Ulid,
    courseCode: string,
  ): Promise<Enrollment | undefined>;
  list(tenantId: TenantId, filter: EnrollmentFilter, page: PageRequest): Promise<Page<Enrollment>>;
  save(enrollment: Enrollment): Promise<void>;
}

export interface CertificationFilter {
  readonly partnerId?: Ulid;
  readonly portalUserId?: Ulid;
  readonly certificationCode?: string;
  readonly status?: CertificationStatus;
}

export interface CertificationRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Certification | undefined>;
  byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly Certification[]>;
  byUser(tenantId: TenantId, portalUserId: Ulid): Promise<readonly Certification[]>;
  forUserAndCode(
    tenantId: TenantId,
    portalUserId: Ulid,
    certificationCode: string,
  ): Promise<Certification | undefined>;
  list(tenantId: TenantId, filter: CertificationFilter, page: PageRequest): Promise<Page<Certification>>;
  all(tenantId: TenantId): Promise<readonly Certification[]>;
  save(certification: Certification): Promise<void>;
}

export interface PortalUserFilter {
  readonly partnerId?: Ulid;
  readonly status?: PortalUserStatus;
  readonly role?: PortalRole;
  readonly search?: string;
}

export interface PortalUserRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<PortalUser | undefined>;
  byEmail(tenantId: TenantId, email: string): Promise<PortalUser | undefined>;
  byPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly PortalUser[]>;
  list(tenantId: TenantId, filter: PortalUserFilter, page: PageRequest): Promise<Page<PortalUser>>;
  save(user: PortalUser): Promise<void>;
}

export interface EntitlementDefinitionRepository {
  byCode(tenantId: TenantId, code: string): Promise<EntitlementDefinition | undefined>;
  all(tenantId: TenantId): Promise<readonly EntitlementDefinition[]>;
  save(definition: EntitlementDefinition): Promise<void>;
}

export interface EntitlementGrantRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<EntitlementGrant | undefined>;
  forPartner(tenantId: TenantId, partnerId: Ulid): Promise<readonly EntitlementGrant[]>;
  forUser(tenantId: TenantId, portalUserId: Ulid): Promise<readonly EntitlementGrant[]>;
  all(tenantId: TenantId): Promise<readonly EntitlementGrant[]>;
  save(grant: EntitlementGrant): Promise<void>;
  /** Overrides are revoked, never deleted, so the audit trail survives. */
  revoke(tenantId: TenantId, id: Ulid, at: IsoDateTime): Promise<EntitlementGrant | undefined>;
}

/** Per-tenant monotonic counters behind human-readable document numbers. */
export interface SequenceRepository {
  next(tenantId: TenantId, key: string): Promise<number>;
}

/** Transactional-outbox stand-in: publish after (in-memory) commit. */
export interface OutboxPort {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}

export interface Clock {
  now(): IsoDateTime;
}

/** Issues the opaque reference stored against a portal invite. */
export interface TokenIssuer {
  issue(purpose: string): string;
}
