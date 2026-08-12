import { AddressService } from "../application/address-service.js";
import { CalendarService } from "../application/calendar-service.js";
import { CodeListService } from "../application/code-list-service.js";
import { CurrencyService } from "../application/currency-service.js";
import { CustomerService } from "../application/customer-service.js";
import { FxService } from "../application/fx-service.js";
import { PaymentTermService } from "../application/payment-term-service.js";
import { ShippingTermService } from "../application/shipping-term-service.js";
import { SiteService } from "../application/site-service.js";
import { UomService } from "../application/uom-service.js";
import type { Clock } from "../application/ports.js";
import {
  InMemoryCalendarRepository,
  InMemoryCodeListRepository,
  InMemoryCurrencyRepository,
  InMemoryCustomerRepository,
  InMemoryFxRateRepository,
  InMemoryOutbox,
  InMemoryPaymentTermRepository,
  InMemoryShippingTermRepository,
  InMemorySiteRepository,
  InMemoryUomConversionRepository,
  InMemoryUomRepository,
  SystemClock,
} from "./memory/stores.js";

/** Composition root: repositories, outbox, clock and application services. */
export interface MasterDataContainer {
  readonly repos: {
    readonly customers: InMemoryCustomerRepository;
    readonly sites: InMemorySiteRepository;
    readonly currencies: InMemoryCurrencyRepository;
    readonly fxRates: InMemoryFxRateRepository;
    readonly uoms: InMemoryUomRepository;
    readonly uomConversions: InMemoryUomConversionRepository;
    readonly paymentTerms: InMemoryPaymentTermRepository;
    readonly shippingTerms: InMemoryShippingTermRepository;
    readonly calendars: InMemoryCalendarRepository;
    readonly codeLists: InMemoryCodeListRepository;
  };
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly services: {
    readonly address: AddressService;
    readonly currency: CurrencyService;
    readonly fx: FxService;
    readonly uom: UomService;
    readonly calendar: CalendarService;
    readonly paymentTerm: PaymentTermService;
    readonly shippingTerm: ShippingTermService;
    readonly codeList: CodeListService;
    readonly customer: CustomerService;
    readonly site: SiteService;
  };
}

export function createContainer(options: { readonly clock?: Clock } = {}): MasterDataContainer {
  const clock = options.clock ?? new SystemClock();
  const outbox = new InMemoryOutbox();

  const customers = new InMemoryCustomerRepository();
  const sites = new InMemorySiteRepository();
  const currencies = new InMemoryCurrencyRepository();
  const fxRates = new InMemoryFxRateRepository();
  const uoms = new InMemoryUomRepository();
  const uomConversions = new InMemoryUomConversionRepository();
  const paymentTerms = new InMemoryPaymentTermRepository();
  const shippingTerms = new InMemoryShippingTermRepository();
  const calendars = new InMemoryCalendarRepository();
  const codeLists = new InMemoryCodeListRepository();

  const address = new AddressService();
  const currency = new CurrencyService(currencies, outbox, clock);
  const fx = new FxService(fxRates, currency, outbox, clock);
  const uom = new UomService(uoms, uomConversions, outbox, clock);
  const calendar = new CalendarService(calendars);
  const paymentTerm = new PaymentTermService(paymentTerms, calendar, outbox, clock);
  const shippingTerm = new ShippingTermService(shippingTerms, calendar, outbox, clock);
  const codeList = new CodeListService(codeLists, outbox, clock);
  const customer = new CustomerService(
    customers,
    sites,
    currency,
    paymentTerm,
    shippingTerm,
    codeList,
    outbox,
    clock,
  );
  const site = new SiteService(sites, customers, codeList, outbox, clock);

  return {
    repos: {
      customers,
      sites,
      currencies,
      fxRates,
      uoms,
      uomConversions,
      paymentTerms,
      shippingTerms,
      calendars,
      codeLists,
    },
    outbox,
    clock,
    services: {
      address,
      currency,
      fx,
      uom,
      calendar,
      paymentTerm,
      shippingTerm,
      codeList,
      customer,
      site,
    },
  };
}
