import { createTenantContext, type TenantContext, type Ulid } from "../kernel/index.js";
import type { SalesModule } from "../infrastructure/container.js";

export interface SeedRefs {
  ctx: TenantContext;
  managerCtx: TenantContext;
  accountId: Ulid;
  prospectId: Ulid;
  priceListId: Ulid;
  opportunityId: Ulid;
  quoteId: Ulid;
}

export const SEED_SKUS = {
  widget: "WIDGET-STD",
  gadget: "GADGET-PRO",
  service: "SVC-ONBOARD",
  book: "BOOK-MANUAL",
} as const;

/**
 * Deterministic demo fixture used by tests and the dev server:
 * - a EUR customer with a 5,000.00 EUR credit limit and two contacts
 * - a prospect without credit limit
 * - a default EUR price list with tiered prices and mixed tax categories
 * - an open opportunity
 * - a draft quote (2 lines) linked to the opportunity
 */
export function seedDemoData(module: SalesModule, tenant = "demo"): SeedRefs {
  const ctx = createTenantContext(tenant, "user-rep", ["sales_rep"]);
  const managerCtx = createTenantContext(tenant, "user-manager", ["sales_manager"]);

  const account = module.accounts.create(ctx, {
    name: "Acme Industries GmbH",
    accountType: "customer",
    currency: "EUR",
    paymentTerms: "NET30",
    industry: "Manufacturing",
    creditLimitMinor: 500_000,
    billingAddress: {
      line1: "Industriestr. 1",
      city: "Berlin",
      postalCode: "10115",
      countryCode: "DE",
    },
    shippingAddress: {
      line1: "Werk 2, Tor 4",
      city: "Berlin",
      postalCode: "10117",
      countryCode: "DE",
    },
  });

  module.accounts.addContact(ctx, account.id, {
    firstName: "Erika",
    lastName: "Mustermann",
    email: "erika@acme.example",
    role: "decision_maker",
    isPrimary: true,
  });
  module.accounts.addContact(ctx, account.id, {
    firstName: "Max",
    lastName: "Schmidt",
    email: "max@acme.example",
    role: "billing",
  });

  const prospect = module.accounts.create(ctx, {
    name: "Startup Labs UG",
    accountType: "prospect",
    currency: "EUR",
  });

  const priceList = module.pricing.create(ctx, {
    name: "Standard EUR 2025",
    currency: "EUR",
    isDefault: true,
  });
  module.pricing.upsertItem(ctx, priceList.id, {
    sku: SEED_SKUS.widget,
    description: "Standard widget",
    taxCategory: "standard",
    tiers: [
      { minQty: 1, unitPriceMinor: 2_500 },
      { minQty: 10, unitPriceMinor: 2_300 },
      { minQty: 100, unitPriceMinor: 2_000 },
    ],
  });
  module.pricing.upsertItem(ctx, priceList.id, {
    sku: SEED_SKUS.gadget,
    description: "Professional gadget",
    taxCategory: "standard",
    tiers: [
      { minQty: 1, unitPriceMinor: 14_900 },
      { minQty: 5, unitPriceMinor: 13_900 },
    ],
  });
  module.pricing.upsertItem(ctx, priceList.id, {
    sku: SEED_SKUS.service,
    description: "Onboarding service package",
    taxCategory: "exempt",
    tiers: [{ minQty: 1, unitPriceMinor: 50_000 }],
  });
  module.pricing.upsertItem(ctx, priceList.id, {
    sku: SEED_SKUS.book,
    description: "Printed manual",
    taxCategory: "reduced",
    tiers: [{ minQty: 1, unitPriceMinor: 1_200 }],
  });

  const opportunity = module.opportunities.create(ctx, {
    accountId: account.id as unknown as string,
    name: "Acme plant expansion",
    amountMinor: 300_000,
    currency: "EUR",
    source: "trade-fair",
  });

  const quote = module.quotes.create(ctx, {
    accountId: account.id as unknown as string,
    opportunityId: opportunity.id as unknown as string,
    taxRegion: "DE",
    validUntil: "2099-12-31",
    lines: [
      { sku: SEED_SKUS.widget, qty: 20 },
      { sku: SEED_SKUS.service, qty: 1 },
    ],
  });

  return {
    ctx,
    managerCtx,
    accountId: account.id,
    prospectId: prospect.id,
    priceListId: priceList.id,
    opportunityId: opportunity.id,
    quoteId: quote.id,
  };
}
