import type { EventEnvelope, IsoDate, IsoDateTime, TenantId, Ulid } from "../kernel/index.js";
import type { Account } from "../domain/accounts/account.js";
import type { Contact } from "../domain/accounts/contact.js";
import type { Opportunity } from "../domain/opportunities/opportunity.js";
import type { PriceList } from "../domain/pricing/price-list.js";
import type { Quote } from "../domain/quotes/quote.js";
import type { SalesOrder } from "../domain/orders/sales-order.js";
import type { ReturnAuthorization } from "../domain/returns/rma.js";

/** Tenant-scoped repository contract; in-memory now, Postgres later. */
export interface Repository<T> {
  save(entity: T): void;
  findById(tenantId: TenantId, id: Ulid): T | undefined;
  /** Like findById but throws NotFoundError. */
  getById(tenantId: TenantId, id: Ulid): T;
  listByTenant(tenantId: TenantId): T[];
}

export interface AccountRepository extends Repository<Account> {
  findByNumber(tenantId: TenantId, accountNumber: string): Account | undefined;
}

export interface ContactRepository extends Repository<Contact> {
  listByAccount(tenantId: TenantId, accountId: Ulid): Contact[];
}

export interface OpportunityRepository extends Repository<Opportunity> {
  listByAccount(tenantId: TenantId, accountId: Ulid): Opportunity[];
  listOpen(tenantId: TenantId): Opportunity[];
}

export interface PriceListRepository extends Repository<PriceList> {
  findDefault(tenantId: TenantId, currency: string): PriceList | undefined;
  listActive(tenantId: TenantId): PriceList[];
}

export interface QuoteRepository extends Repository<Quote> {
  listByAccount(tenantId: TenantId, accountId: Ulid): Quote[];
  listByStatus(tenantId: TenantId, status: string): Quote[];
}

export interface SalesOrderRepository extends Repository<SalesOrder> {
  listByAccount(tenantId: TenantId, accountId: Ulid): SalesOrder[];
  /** Orders contributing to credit exposure (confirmed/allocated/shipped). */
  listOpenExposure(tenantId: TenantId, accountId: Ulid): SalesOrder[];
}

export interface ReturnRepository extends Repository<ReturnAuthorization> {
  listByOrder(tenantId: TenantId, orderId: Ulid): ReturnAuthorization[];
}

/** Transactional-outbox port (in-memory acceptable per ARCHITECTURE.md). */
export interface OutboxPort {
  append(events: readonly EventEnvelope[]): void;
  all(): readonly EventEnvelope[];
  byType(eventType: string): readonly EventEnvelope[];
  /** Removes and returns everything currently queued (simulated dispatch). */
  drain(): EventEnvelope[];
}

export interface Clock {
  now(): IsoDateTime;
  today(): IsoDate;
}
