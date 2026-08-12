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
import type { HolidayCalendar } from "../../domain/calendar.js";
import type { CodeList } from "../../domain/code-list.js";
import type { TenantCurrency } from "../../domain/currency.js";
import type { Customer } from "../../domain/customer.js";
import type { FxRate } from "../../domain/fx.js";
import type { PaymentTerm } from "../../domain/payment-terms.js";
import type { ShippingTerm } from "../../domain/shipping-terms.js";
import type { Site } from "../../domain/site.js";
import { ALL_PRODUCTS, conversionKey, type UnitOfMeasure, type UomConversion } from "../../domain/uom.js";
import type {
  CalendarRepository,
  Clock,
  CodeListRepository,
  CurrencyRepository,
  CustomerFilter,
  CustomerRepository,
  FxRateFilter,
  FxRateRepository,
  OutboxPort,
  PaymentTermRepository,
  ShippingTermRepository,
  SiteFilter,
  SiteRepository,
  UomConversionRepository,
  UomRepository,
} from "../../application/ports.js";

/**
 * In-memory adapters.
 *
 * Aggregates are stored by reference (single-process semantics) and tenant
 * isolation is structural: every map is keyed by tenant first, so a lookup for
 * a tenant that holds no data can never see another tenant's rows.
 */

class TenantKeyedStore<T> {
  private readonly byTenant = new Map<string, Map<string, T>>();

  private bucket(tenantId: TenantId): Map<string, T> {
    let bucket = this.byTenant.get(String(tenantId));
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(String(tenantId), bucket);
    }
    return bucket;
  }

  get(tenantId: TenantId, key: string): T | undefined {
    return this.byTenant.get(String(tenantId))?.get(key);
  }

  set(tenantId: TenantId, key: string, value: T): void {
    this.bucket(tenantId).set(key, value);
  }

  delete(tenantId: TenantId, key: string): boolean {
    return this.byTenant.get(String(tenantId))?.delete(key) ?? false;
  }

  values(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(String(tenantId))?.values() ?? [])];
  }
}

function includesCaseless(haystack: string | undefined, needle: string): boolean {
  return (haystack ?? "").toLowerCase().includes(needle);
}

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly store = new TenantKeyedStore<Customer>();
  private readonly sequences = new Map<string, number>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Customer | undefined> {
    return this.store.get(tenantId, String(id));
  }

  async byNumber(tenantId: TenantId, number: string): Promise<Customer | undefined> {
    const normalized = number.trim().toUpperCase();
    return this.store.values(tenantId).find((customer) => customer.number === normalized);
  }

  async byIdentifier(tenantId: TenantId, scheme: string, value: string): Promise<Customer | undefined> {
    const normalized = value.trim().toUpperCase();
    return this.store
      .values(tenantId)
      .find((customer) =>
        customer.identifiers.some(
          (identifier) => identifier.scheme === scheme && identifier.value === normalized,
        ),
      );
  }

  async byExternalId(tenantId: TenantId, system: string, value: string): Promise<Customer | undefined> {
    const key = system.trim().toLowerCase();
    return this.store.values(tenantId).find((customer) => customer.externalIds[key] === value);
  }

  async list(tenantId: TenantId, filter: CustomerFilter, page: PageRequest): Promise<Page<Customer>> {
    const search = filter.search?.trim().toLowerCase();
    const matches = this.store
      .values(tenantId)
      .filter((customer) => (filter.includeMerged ? true : customer.status !== "merged"))
      .filter((customer) => (filter.status ? customer.status === filter.status : true))
      .filter((customer) =>
        filter.classification ? customer.classification === filter.classification : true,
      )
      .filter((customer) =>
        filter.countryCode
          ? String(customer.registeredAddress.countryCode) === filter.countryCode.toUpperCase()
          : true,
      )
      .filter((customer) => (filter.parentId ? customer.parentId === filter.parentId : true))
      .filter((customer) => (filter.segmentCode ? customer.segmentCode === filter.segmentCode : true))
      .filter((customer) => (filter.industryCode ? customer.industryCode === filter.industryCode : true))
      .filter((customer) => (filter.tag ? customer.tags.includes(filter.tag.toLowerCase()) : true))
      .filter((customer) =>
        search
          ? includesCaseless(customer.number, search) ||
            includesCaseless(customer.legalName, search) ||
            includesCaseless(customer.tradingName, search)
          : true,
      )
      .sort((a, b) => a.number.localeCompare(b.number));
    return paginate(matches, page);
  }

  async all(tenantId: TenantId): Promise<readonly Customer[]> {
    return this.store.values(tenantId);
  }

  async children(tenantId: TenantId, parentId: Ulid): Promise<readonly Customer[]> {
    return this.store.values(tenantId).filter((customer) => customer.parentId === parentId);
  }

  async nextSequence(tenantId: TenantId): Promise<number> {
    const next = (this.sequences.get(String(tenantId)) ?? 0) + 1;
    this.sequences.set(String(tenantId), next);
    return next;
  }

  async save(customer: Customer): Promise<void> {
    this.store.set(customer.tenantId, String(customer.id), customer);
  }
}

export class InMemorySiteRepository implements SiteRepository {
  private readonly store = new TenantKeyedStore<Site>();

  async byId(tenantId: TenantId, id: Ulid): Promise<Site | undefined> {
    return this.store.get(tenantId, String(id));
  }

  async byCode(tenantId: TenantId, customerId: Ulid, code: string): Promise<Site | undefined> {
    const normalized = code.trim().toUpperCase();
    return this.store
      .values(tenantId)
      .find((site) => site.customerId === customerId && site.code === normalized);
  }

  async list(tenantId: TenantId, filter: SiteFilter, page: PageRequest): Promise<Page<Site>> {
    const search = filter.search?.trim().toLowerCase();
    const matches = this.store
      .values(tenantId)
      .filter((site) => (filter.customerId ? site.customerId === filter.customerId : true))
      .filter((site) => (filter.role ? site.hasRole(filter.role) : true))
      .filter((site) =>
        filter.countryCode
          ? String(site.address.countryCode) === filter.countryCode.toUpperCase()
          : true,
      )
      .filter((site) => (filter.active === undefined ? true : site.active === filter.active))
      .filter((site) =>
        search
          ? includesCaseless(site.code, search) ||
            includesCaseless(site.name, search) ||
            includesCaseless(site.address.city, search)
          : true,
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return paginate(matches, page);
  }

  async forCustomer(tenantId: TenantId, customerId: Ulid): Promise<readonly Site[]> {
    return this.store
      .values(tenantId)
      .filter((site) => site.customerId === customerId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async all(tenantId: TenantId): Promise<readonly Site[]> {
    return this.store.values(tenantId);
  }

  async save(site: Site): Promise<void> {
    this.store.set(site.tenantId, String(site.id), site);
  }
}

export class InMemoryCurrencyRepository implements CurrencyRepository {
  private readonly store = new TenantKeyedStore<TenantCurrency>();

  async settings(tenantId: TenantId): Promise<readonly TenantCurrency[]> {
    return this.store.values(tenantId);
  }

  async byCode(tenantId: TenantId, code: string): Promise<TenantCurrency | undefined> {
    return this.store.get(tenantId, code.trim().toUpperCase());
  }

  async save(tenantId: TenantId, setting: TenantCurrency): Promise<void> {
    this.store.set(tenantId, String(setting.code), setting);
  }
}

export class InMemoryFxRateRepository implements FxRateRepository {
  private readonly store = new TenantKeyedStore<FxRate>();

  async byId(tenantId: TenantId, id: Ulid): Promise<FxRate | undefined> {
    return this.store.get(tenantId, String(id));
  }

  async list(tenantId: TenantId, filter: FxRateFilter): Promise<readonly FxRate[]> {
    const at = filter.asOf ? Date.parse(filter.asOf) : undefined;
    return this.store
      .values(tenantId)
      .filter((rate) => (filter.base ? String(rate.base) === filter.base.toUpperCase() : true))
      .filter((rate) => (filter.quote ? String(rate.quote) === filter.quote.toUpperCase() : true))
      .filter((rate) => (filter.rateType ? rate.rateType === filter.rateType : true))
      .filter((rate) =>
        at === undefined
          ? true
          : Date.parse(rate.validFrom) <= at &&
            (rate.validTo === undefined || Date.parse(rate.validTo) > at),
      )
      .sort(
        (a, b) =>
          `${a.base}${a.quote}`.localeCompare(`${b.base}${b.quote}`) ||
          Date.parse(b.validFrom) - Date.parse(a.validFrom),
      );
  }

  async all(tenantId: TenantId): Promise<readonly FxRate[]> {
    return this.store.values(tenantId);
  }

  async save(rate: FxRate): Promise<void> {
    this.store.set(rate.tenantId, String(rate.id), rate);
  }

  async replace(rate: FxRate): Promise<void> {
    this.store.set(rate.tenantId, String(rate.id), rate);
  }
}

export class InMemoryUomRepository implements UomRepository {
  private readonly store = new TenantKeyedStore<UnitOfMeasure>();

  async byCode(tenantId: TenantId, code: string): Promise<UnitOfMeasure | undefined> {
    return this.store.get(tenantId, code.trim().toUpperCase());
  }

  async all(tenantId: TenantId): Promise<readonly UnitOfMeasure[]> {
    return this.store.values(tenantId);
  }

  async save(tenantId: TenantId, unit: UnitOfMeasure): Promise<void> {
    this.store.set(tenantId, String(unit.code), unit);
  }
}

export class InMemoryUomConversionRepository implements UomConversionRepository {
  private readonly store = new TenantKeyedStore<UomConversion>();

  async all(tenantId: TenantId): Promise<readonly UomConversion[]> {
    return this.store.values(tenantId);
  }

  async forProduct(tenantId: TenantId, productCode: string): Promise<readonly UomConversion[]> {
    const normalized = productCode.trim().toUpperCase();
    return this.store
      .values(tenantId)
      .filter(
        (conversion) =>
          conversion.productCode === normalized || conversion.productCode === ALL_PRODUCTS,
      );
  }

  async find(
    tenantId: TenantId,
    productCode: string,
    from: string,
    to: string,
  ): Promise<UomConversion | undefined> {
    return this.store.get(tenantId, conversionKey(productCode, from, to));
  }

  async save(tenantId: TenantId, conversion: UomConversion): Promise<void> {
    this.store.set(
      tenantId,
      conversionKey(conversion.productCode, String(conversion.from), String(conversion.to)),
      conversion,
    );
  }

  async remove(tenantId: TenantId, productCode: string, from: string, to: string): Promise<void> {
    this.store.delete(tenantId, conversionKey(productCode, from, to));
  }
}

export class InMemoryPaymentTermRepository implements PaymentTermRepository {
  private readonly store = new TenantKeyedStore<PaymentTerm>();

  async byCode(tenantId: TenantId, code: string): Promise<PaymentTerm | undefined> {
    return this.store.get(tenantId, code.trim().toUpperCase());
  }

  async all(tenantId: TenantId): Promise<readonly PaymentTerm[]> {
    return this.store.values(tenantId);
  }

  async save(tenantId: TenantId, term: PaymentTerm): Promise<void> {
    this.store.set(tenantId, term.code, term);
  }
}

export class InMemoryShippingTermRepository implements ShippingTermRepository {
  private readonly store = new TenantKeyedStore<ShippingTerm>();

  async byCode(tenantId: TenantId, code: string): Promise<ShippingTerm | undefined> {
    return this.store.get(tenantId, code.trim().toUpperCase());
  }

  async all(tenantId: TenantId): Promise<readonly ShippingTerm[]> {
    return this.store.values(tenantId);
  }

  async save(tenantId: TenantId, term: ShippingTerm): Promise<void> {
    this.store.set(tenantId, term.code, term);
  }
}

export class InMemoryCalendarRepository implements CalendarRepository {
  private readonly store = new TenantKeyedStore<HolidayCalendar>();

  async byCode(tenantId: TenantId, code: string): Promise<HolidayCalendar | undefined> {
    return this.store.get(tenantId, code.trim().toUpperCase());
  }

  async all(tenantId: TenantId): Promise<readonly HolidayCalendar[]> {
    return this.store.values(tenantId);
  }

  async save(tenantId: TenantId, calendar: HolidayCalendar): Promise<void> {
    this.store.set(tenantId, calendar.code, calendar);
  }
}

export class InMemoryCodeListRepository implements CodeListRepository {
  private readonly store = new TenantKeyedStore<CodeList>();

  async byId(tenantId: TenantId, id: Ulid): Promise<CodeList | undefined> {
    return this.store.get(tenantId, String(id));
  }

  async byCode(tenantId: TenantId, listCode: string): Promise<CodeList | undefined> {
    const normalized = listCode.trim().toLowerCase();
    return this.store.values(tenantId).find((list) => list.listCode === normalized);
  }

  async all(tenantId: TenantId): Promise<readonly CodeList[]> {
    return this.store.values(tenantId);
  }

  async save(list: CodeList): Promise<void> {
    this.store.set(list.tenantId, String(list.id), list);
  }
}

export type OutboxSubscriber = (event: EventEnvelope) => void;

/**
 * In-memory stand-in for a transactional outbox: events are appended to a log
 * and fanned out synchronously. The log is kept so tests and the diagnostics
 * endpoint can inspect exactly what a use case published.
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

  clear(): void {
    this.log.splice(0, this.log.length);
  }
}

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
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

  advance(ms: number): void {
    this.current += ms;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}
