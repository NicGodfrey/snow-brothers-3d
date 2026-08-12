import type { TenantId, Ulid } from "../../kernel/index.js";
import type { Account } from "../../domain/accounts/account.js";
import type { Contact } from "../../domain/accounts/contact.js";
import type { Opportunity } from "../../domain/opportunities/opportunity.js";
import type { PriceList } from "../../domain/pricing/price-list.js";
import type { Quote } from "../../domain/quotes/quote.js";
import type { SalesOrder } from "../../domain/orders/sales-order.js";
import type { ReturnAuthorization } from "../../domain/returns/rma.js";
import type { DocumentKind, NumberSequencePort } from "../../domain/numbering.js";
import type {
  AccountRepository,
  ContactRepository,
  OpportunityRepository,
  PriceListRepository,
  QuoteRepository,
  ReturnRepository,
  SalesOrderRepository,
} from "../../application/ports.js";
import { InMemoryRepository } from "./in-memory-repository.js";

export class InMemoryAccountRepository
  extends InMemoryRepository<Account>
  implements AccountRepository
{
  constructor() {
    super("Account");
  }

  findByNumber(tenantId: TenantId, accountNumber: string): Account | undefined {
    return this.listByTenant(tenantId).find((a) => a.accountNumber === accountNumber);
  }
}

export class InMemoryContactRepository
  extends InMemoryRepository<Contact>
  implements ContactRepository
{
  constructor() {
    super("Contact");
  }

  listByAccount(tenantId: TenantId, accountId: Ulid): Contact[] {
    return this.listByTenant(tenantId).filter((c) => c.accountId === accountId);
  }
}

export class InMemoryOpportunityRepository
  extends InMemoryRepository<Opportunity>
  implements OpportunityRepository
{
  constructor() {
    super("Opportunity");
  }

  listByAccount(tenantId: TenantId, accountId: Ulid): Opportunity[] {
    return this.listByTenant(tenantId).filter((o) => o.accountId === accountId);
  }

  listOpen(tenantId: TenantId): Opportunity[] {
    return this.listByTenant(tenantId).filter((o) => o.isOpen);
  }
}

export class InMemoryPriceListRepository
  extends InMemoryRepository<PriceList>
  implements PriceListRepository
{
  constructor() {
    super("PriceList");
  }

  findDefault(tenantId: TenantId, currencyCode: string): PriceList | undefined {
    const wanted = currencyCode.toUpperCase();
    return this.listByTenant(tenantId).find(
      (p) => p.isDefault && p.status === "active" && (p.currencyCode as unknown as string) === wanted,
    );
  }

  listActive(tenantId: TenantId): PriceList[] {
    return this.listByTenant(tenantId).filter((p) => p.status === "active");
  }
}

export class InMemoryQuoteRepository extends InMemoryRepository<Quote> implements QuoteRepository {
  constructor() {
    super("Quote");
  }

  listByAccount(tenantId: TenantId, accountId: Ulid): Quote[] {
    return this.listByTenant(tenantId).filter((q) => q.accountId === accountId);
  }

  listByStatus(tenantId: TenantId, status: string): Quote[] {
    return this.listByTenant(tenantId).filter((q) => q.status === status);
  }
}

export class InMemorySalesOrderRepository
  extends InMemoryRepository<SalesOrder>
  implements SalesOrderRepository
{
  constructor() {
    super("SalesOrder");
  }

  listByAccount(tenantId: TenantId, accountId: Ulid): SalesOrder[] {
    return this.listByTenant(tenantId).filter((o) => o.accountId === accountId);
  }

  listOpenExposure(tenantId: TenantId, accountId: Ulid): SalesOrder[] {
    return this.listByAccount(tenantId, accountId).filter((o) => o.isOpenExposure);
  }
}

export class InMemoryReturnRepository
  extends InMemoryRepository<ReturnAuthorization>
  implements ReturnRepository
{
  constructor() {
    super("ReturnAuthorization");
  }

  listByOrder(tenantId: TenantId, orderId: Ulid): ReturnAuthorization[] {
    return this.listByTenant(tenantId).filter((r) => r.orderId === orderId);
  }
}

export class InMemoryNumberSequences implements NumberSequencePort {
  private readonly counters = new Map<string, number>();

  next(tenantId: TenantId, kind: DocumentKind): number {
    const key = `${tenantId}:${kind}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}
