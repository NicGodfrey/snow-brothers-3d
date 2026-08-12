import type {
  EventEnvelope,
  IsoDateTime,
  Page,
  PageRequest,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { ChannelOrder, ChannelOrderStatus, OrderSourceType } from "../domain/channel-order.js";
import type { ChannelQuote, ChannelQuoteStatus } from "../domain/channel-quote.js";
import type { ConflictCase, ConflictKind, ConflictStatus, DirectClaim } from "../domain/conflict.js";
import type { DealRegistration, DealSource, RegistrationStatus } from "../domain/deal-registration.js";
import type { Partner, PartnerStatus, PartnerTier, TierPolicy } from "../domain/partner.js";
import type { Referral, ReferralStatus } from "../domain/referral.js";
import type { SequenceName } from "../domain/numbering.js";
import type { ChannelStage } from "../domain/stages.js";
import type { CustomerKey } from "../domain/territory.js";

/**
 * Ports the application layer depends on.
 *
 * In-memory adapters live in `infrastructure/memory`; the SQL migrations
 * describe the same shapes for a Postgres adapter. Query methods are
 * deliberately specific (`protectedAt`, `expiringWithin`) rather than a
 * generic predicate, so an index-backed implementation can serve them.
 */

export interface PartnerFilter {
  readonly status?: PartnerStatus;
  readonly tier?: PartnerTier;
  readonly territory?: string;
  readonly productLine?: string;
  readonly search?: string;
}

export interface PartnerRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Partner | undefined>;
  byCode(tenantId: TenantId, code: string): Promise<Partner | undefined>;
  list(tenantId: TenantId, filter: PartnerFilter, page: PageRequest): Promise<Page<Partner>>;
  all(tenantId: TenantId): Promise<readonly Partner[]>;
  save(partner: Partner): Promise<void>;
}

export interface RegistrationFilter {
  readonly status?: RegistrationStatus;
  readonly partnerId?: Ulid;
  readonly customerKey?: CustomerKey;
  readonly stage?: ChannelStage;
  readonly source?: DealSource;
  readonly productLine?: string;
  /** Approved registrations whose protection lapses within N days of `at`. */
  readonly expiringWithinDays?: number;
  readonly at?: IsoDateTime;
  readonly search?: string;
}

export interface RegistrationRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<DealRegistration | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<DealRegistration | undefined>;
  list(tenantId: TenantId, filter: RegistrationFilter, page: PageRequest): Promise<Page<DealRegistration>>;
  /** Every registration touching a customer — the conflict detector's input. */
  byCustomerKey(tenantId: TenantId, key: CustomerKey): Promise<readonly DealRegistration[]>;
  /** Approved registrations still inside their protection window at `at`. */
  protectedAt(tenantId: TenantId, at: IsoDateTime): Promise<readonly DealRegistration[]>;
  /** Approved registrations whose window has lapsed by `at`. */
  lapsedAt(tenantId: TenantId, at: IsoDateTime): Promise<readonly DealRegistration[]>;
  all(tenantId: TenantId): Promise<readonly DealRegistration[]>;
  save(registration: DealRegistration): Promise<void>;
}

export interface ReferralFilter {
  readonly status?: ReferralStatus;
  readonly partnerId?: Ulid;
  readonly customerKey?: CustomerKey;
  readonly commissionStatus?: string;
}

export interface ReferralRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Referral | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<Referral | undefined>;
  list(tenantId: TenantId, filter: ReferralFilter, page: PageRequest): Promise<Page<Referral>>;
  /** Referrals whose decision SLA or attribution window has run out. */
  dueForExpiry(tenantId: TenantId, at: IsoDateTime): Promise<readonly Referral[]>;
  all(tenantId: TenantId): Promise<readonly Referral[]>;
  save(referral: Referral): Promise<void>;
}

export interface ChannelQuoteFilter {
  readonly status?: ChannelQuoteStatus;
  readonly partnerId?: Ulid;
  readonly registrationId?: Ulid;
  readonly customerKey?: CustomerKey;
}

export interface ChannelQuoteRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<ChannelQuote | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<ChannelQuote | undefined>;
  list(tenantId: TenantId, filter: ChannelQuoteFilter, page: PageRequest): Promise<Page<ChannelQuote>>;
  byRegistration(tenantId: TenantId, registrationId: Ulid): Promise<readonly ChannelQuote[]>;
  /** Submitted/approved quotes past their validity at `at`. */
  dueForExpiry(tenantId: TenantId, at: IsoDateTime): Promise<readonly ChannelQuote[]>;
  all(tenantId: TenantId): Promise<readonly ChannelQuote[]>;
  save(quote: ChannelQuote): Promise<void>;
}

export interface ChannelOrderFilter {
  readonly status?: ChannelOrderStatus;
  readonly partnerId?: Ulid;
  readonly registrationId?: Ulid;
  readonly sourceType?: OrderSourceType;
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
}

export interface ChannelOrderRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<ChannelOrder | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<ChannelOrder | undefined>;
  bySalesOrderRef(tenantId: TenantId, ref: string): Promise<ChannelOrder | undefined>;
  list(tenantId: TenantId, filter: ChannelOrderFilter, page: PageRequest): Promise<Page<ChannelOrder>>;
  byRegistration(tenantId: TenantId, registrationId: Ulid): Promise<readonly ChannelOrder[]>;
  all(tenantId: TenantId): Promise<readonly ChannelOrder[]>;
  save(order: ChannelOrder): Promise<void>;
}

export interface ConflictFilter {
  readonly status?: ConflictStatus;
  readonly kind?: ConflictKind;
  readonly partnerId?: Ulid;
  readonly customerKey?: CustomerKey;
  /** Only cases whose SLA has run out at this instant. */
  readonly overdueAt?: IsoDateTime;
}

export interface ConflictRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<ConflictCase | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<ConflictCase | undefined>;
  list(tenantId: TenantId, filter: ConflictFilter, page: PageRequest): Promise<Page<ConflictCase>>;
  byRegistration(tenantId: TenantId, registrationId: Ulid): Promise<readonly ConflictCase[]>;
  all(tenantId: TenantId): Promise<readonly ConflictCase[]>;
  save(conflict: ConflictCase): Promise<void>;
}

/** Vendor-owned accounts partners may not register against. */
export interface DirectClaimRepository {
  list(tenantId: TenantId): Promise<readonly DirectClaim[]>;
  add(tenantId: TenantId, claim: DirectClaim): Promise<void>;
  remove(tenantId: TenantId, customerKey: CustomerKey): Promise<void>;
}

/** Per-tenant overrides of the shipped tier defaults. */
export interface TierPolicyRepository {
  get(tenantId: TenantId, tier: PartnerTier): Promise<TierPolicy>;
  all(tenantId: TenantId): Promise<readonly TierPolicy[]>;
  save(tenantId: TenantId, policy: TierPolicy): Promise<void>;
}

/** Monotonic per-tenant document sequences (DR-00001, CNF-00007, ...). */
export interface SequencePort {
  next(tenantId: TenantId, sequence: SequenceName): Promise<number>;
}

/** Transactional-outbox stand-in: publish after (in-memory) commit. */
export interface OutboxPort {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}

export interface Clock {
  now(): IsoDateTime;
}
