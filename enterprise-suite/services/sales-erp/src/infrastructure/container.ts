import { TaxCalculator } from "../domain/pricing/tax.js";
import { DocumentNumberGenerator } from "../domain/numbering.js";
import type { Clock } from "../application/ports.js";
import { AccountService } from "../application/account-service.js";
import { CreditService } from "../application/credit-service.js";
import { OpportunityService } from "../application/opportunity-service.js";
import { OrderService } from "../application/order-service.js";
import { PricingService } from "../application/pricing-service.js";
import { QuoteService } from "../application/quote-service.js";
import { ReturnsService } from "../application/returns-service.js";
import { SystemClock } from "./clock.js";
import { InMemoryOutbox } from "./memory/outbox.js";
import {
  InMemoryAccountRepository,
  InMemoryContactRepository,
  InMemoryNumberSequences,
  InMemoryOpportunityRepository,
  InMemoryPriceListRepository,
  InMemoryQuoteRepository,
  InMemoryReturnRepository,
  InMemorySalesOrderRepository,
} from "./memory/repositories.js";

export interface SalesModule {
  readonly accounts: AccountService;
  readonly credit: CreditService;
  readonly opportunities: OpportunityService;
  readonly pricing: PricingService;
  readonly quotes: QuoteService;
  readonly orders: OrderService;
  readonly returns: ReturnsService;
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly repos: {
    readonly accounts: InMemoryAccountRepository;
    readonly contacts: InMemoryContactRepository;
    readonly opportunities: InMemoryOpportunityRepository;
    readonly priceLists: InMemoryPriceListRepository;
    readonly quotes: InMemoryQuoteRepository;
    readonly orders: InMemorySalesOrderRepository;
    readonly returns: InMemoryReturnRepository;
  };
}

/** Composition root wiring in-memory adapters to the application services. */
export function createSalesModule(options: { clock?: Clock; taxCalculator?: TaxCalculator } = {}): SalesModule {
  const clock = options.clock ?? new SystemClock();
  const taxCalculator = options.taxCalculator ?? new TaxCalculator();
  const outbox = new InMemoryOutbox();
  const numbers = new DocumentNumberGenerator(new InMemoryNumberSequences());

  const accountsRepo = new InMemoryAccountRepository();
  const contactsRepo = new InMemoryContactRepository();
  const opportunitiesRepo = new InMemoryOpportunityRepository();
  const priceListsRepo = new InMemoryPriceListRepository();
  const quotesRepo = new InMemoryQuoteRepository();
  const ordersRepo = new InMemorySalesOrderRepository();
  const returnsRepo = new InMemoryReturnRepository();

  const accounts = new AccountService(accountsRepo, contactsRepo, numbers, outbox);
  const credit = new CreditService(accountsRepo, ordersRepo);
  const opportunities = new OpportunityService(opportunitiesRepo, accountsRepo, outbox);
  const pricing = new PricingService(priceListsRepo, outbox);
  const quotes = new QuoteService(
    quotesRepo,
    accountsRepo,
    opportunitiesRepo,
    ordersRepo,
    pricing,
    numbers,
    outbox,
    clock,
    taxCalculator,
  );
  const orders = new OrderService(
    ordersRepo,
    accountsRepo,
    quotesRepo,
    pricing,
    credit,
    numbers,
    outbox,
    taxCalculator,
  );
  const returns = new ReturnsService(returnsRepo, ordersRepo, numbers, outbox);

  return {
    accounts,
    credit,
    opportunities,
    pricing,
    quotes,
    orders,
    returns,
    outbox,
    clock,
    repos: {
      accounts: accountsRepo,
      contacts: contactsRepo,
      opportunities: opportunitiesRepo,
      priceLists: priceListsRepo,
      quotes: quotesRepo,
      orders: ordersRepo,
      returns: returnsRepo,
    },
  };
}
