import type {
  EventEnvelope,
  IsoDateTime,
  Page,
  PageRequest,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { HolidayCalendar } from "../domain/calendar.js";
import type { CodeList } from "../domain/code-list.js";
import type { TenantCurrency } from "../domain/currency.js";
import type { Customer, CustomerClassification, CustomerStatus } from "../domain/customer.js";
import type { FxRate, FxRateType } from "../domain/fx.js";
import type { PaymentTerm } from "../domain/payment-terms.js";
import type { ShippingTerm } from "../domain/shipping-terms.js";
import type { Site, SiteRole } from "../domain/site.js";
import type { UnitOfMeasure, UomConversion } from "../domain/uom.js";

/**
 * Ports the application layer depends on.
 *
 * In-memory implementations live in `infrastructure/memory`; a Postgres
 * adapter can implement the same contracts against the schema in
 * `migrations/` without touching a service. Every method takes an explicit
 * `TenantId` so tenant scoping is a property of the contract rather than of
 * ambient state.
 */

export interface CustomerFilter {
  readonly status?: CustomerStatus;
  readonly classification?: CustomerClassification;
  readonly countryCode?: string;
  readonly parentId?: Ulid;
  readonly segmentCode?: string;
  readonly industryCode?: string;
  readonly tag?: string;
  /** Case-insensitive substring over number, legal name and trading name. */
  readonly search?: string;
  /** Merged records are hidden unless explicitly requested. */
  readonly includeMerged?: boolean;
}

export interface CustomerRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Customer | undefined>;
  byNumber(tenantId: TenantId, number: string): Promise<Customer | undefined>;
  byIdentifier(tenantId: TenantId, scheme: string, value: string): Promise<Customer | undefined>;
  byExternalId(tenantId: TenantId, system: string, value: string): Promise<Customer | undefined>;
  list(tenantId: TenantId, filter: CustomerFilter, page: PageRequest): Promise<Page<Customer>>;
  /** Whole tenant book, used for duplicate scans and hierarchy walks. */
  all(tenantId: TenantId): Promise<readonly Customer[]>;
  children(tenantId: TenantId, parentId: Ulid): Promise<readonly Customer[]>;
  /** Monotonic per-tenant sequence backing customer numbers. */
  nextSequence(tenantId: TenantId): Promise<number>;
  save(customer: Customer): Promise<void>;
}

export interface SiteFilter {
  readonly customerId?: Ulid;
  readonly role?: SiteRole;
  readonly countryCode?: string;
  readonly active?: boolean;
  readonly search?: string;
}

export interface SiteRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<Site | undefined>;
  byCode(tenantId: TenantId, customerId: Ulid, code: string): Promise<Site | undefined>;
  list(tenantId: TenantId, filter: SiteFilter, page: PageRequest): Promise<Page<Site>>;
  forCustomer(tenantId: TenantId, customerId: Ulid): Promise<readonly Site[]>;
  all(tenantId: TenantId): Promise<readonly Site[]>;
  save(site: Site): Promise<void>;
}

export interface CurrencyRepository {
  settings(tenantId: TenantId): Promise<readonly TenantCurrency[]>;
  byCode(tenantId: TenantId, code: string): Promise<TenantCurrency | undefined>;
  save(tenantId: TenantId, setting: TenantCurrency): Promise<void>;
}

export interface FxRateFilter {
  readonly base?: string;
  readonly quote?: string;
  readonly rateType?: FxRateType;
  /** Only rates effective at this instant. */
  readonly asOf?: string;
}

export interface FxRateRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<FxRate | undefined>;
  list(tenantId: TenantId, filter: FxRateFilter): Promise<readonly FxRate[]>;
  all(tenantId: TenantId): Promise<readonly FxRate[]>;
  save(rate: FxRate): Promise<void>;
  replace(rate: FxRate): Promise<void>;
}

export interface UomRepository {
  byCode(tenantId: TenantId, code: string): Promise<UnitOfMeasure | undefined>;
  all(tenantId: TenantId): Promise<readonly UnitOfMeasure[]>;
  save(tenantId: TenantId, unit: UnitOfMeasure): Promise<void>;
}

export interface UomConversionRepository {
  all(tenantId: TenantId): Promise<readonly UomConversion[]>;
  forProduct(tenantId: TenantId, productCode: string): Promise<readonly UomConversion[]>;
  find(
    tenantId: TenantId,
    productCode: string,
    from: string,
    to: string,
  ): Promise<UomConversion | undefined>;
  save(tenantId: TenantId, conversion: UomConversion): Promise<void>;
  remove(tenantId: TenantId, productCode: string, from: string, to: string): Promise<void>;
}

export interface PaymentTermRepository {
  byCode(tenantId: TenantId, code: string): Promise<PaymentTerm | undefined>;
  all(tenantId: TenantId): Promise<readonly PaymentTerm[]>;
  save(tenantId: TenantId, term: PaymentTerm): Promise<void>;
}

export interface ShippingTermRepository {
  byCode(tenantId: TenantId, code: string): Promise<ShippingTerm | undefined>;
  all(tenantId: TenantId): Promise<readonly ShippingTerm[]>;
  save(tenantId: TenantId, term: ShippingTerm): Promise<void>;
}

export interface CalendarRepository {
  byCode(tenantId: TenantId, code: string): Promise<HolidayCalendar | undefined>;
  all(tenantId: TenantId): Promise<readonly HolidayCalendar[]>;
  save(tenantId: TenantId, calendar: HolidayCalendar): Promise<void>;
}

export interface CodeListRepository {
  byId(tenantId: TenantId, id: Ulid): Promise<CodeList | undefined>;
  byCode(tenantId: TenantId, listCode: string): Promise<CodeList | undefined>;
  all(tenantId: TenantId): Promise<readonly CodeList[]>;
  save(list: CodeList): Promise<void>;
}

/** Transactional-outbox stand-in: publish after (in-memory) commit. */
export interface OutboxPort {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}

export interface Clock {
  now(): IsoDateTime;
}
