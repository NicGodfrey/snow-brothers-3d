import { createTenantContext, type TenantContext } from "@enterprise-suite/shared-kernel";
import { STANDARD_CODE_LISTS } from "../domain/code-list.js";
import type { Customer } from "../domain/customer.js";
import { STANDARD_PAYMENT_TERMS } from "../domain/payment-terms.js";
import { STANDARD_SHIPPING_TERMS } from "../domain/shipping-terms.js";
import type { Site } from "../domain/site.js";
import type { MasterDataContainer } from "./container.js";

/**
 * Bootstraps a tenant with the reference configuration every deployment
 * needs — enabled currencies, published code lists, the standard term
 * catalogs and working calendars — and then a small book of demo customers,
 * sites and FX rates so the HTTP API is explorable straight after boot.
 */

export interface SeededMasterData {
  readonly ctx: TenantContext;
  readonly customers: Record<string, Customer>;
  readonly sites: Record<string, Site>;
}

/** Code lists are published from a date safely before any document date. */
const CODE_LIST_EFFECTIVE_FROM = "2020-01-01";

export async function seedReferenceData(
  container: MasterDataContainer,
  ctx: TenantContext,
): Promise<void> {
  const { services } = container;

  for (const code of ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "SEK"]) {
    await services.currency.enable(ctx, { code });
  }
  await services.currency.setFunctional(ctx, "USD");

  for (const seed of STANDARD_CODE_LISTS) {
    await services.codeList.create(ctx, {
      listCode: seed.listCode,
      name: seed.name,
      description: seed.description,
      hierarchical: seed.hierarchical,
    });
    await services.codeList.upsertEntries(ctx, seed.listCode, seed.entries);
    await services.codeList.publish(ctx, seed.listCode, CODE_LIST_EFFECTIVE_FROM);
  }

  await services.calendar.create(ctx, {
    code: "US",
    name: "United States federal holidays",
    holidays: [
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-07-03",
      "2026-09-07",
      "2026-11-26",
      "2026-11-27",
      "2026-12-25",
    ],
  });
  await services.calendar.create(ctx, {
    code: "DE",
    name: "German federal holidays",
    holidays: [
      "2026-01-01",
      "2026-04-03",
      "2026-04-06",
      "2026-05-01",
      "2026-05-14",
      "2026-05-25",
      "2026-10-03",
      "2026-12-25",
      "2026-12-26",
    ],
  });
  await services.calendar.create(ctx, {
    code: "AE",
    name: "United Arab Emirates (Fri-Sat weekend)",
    weekendDays: [5, 6],
    holidays: ["2026-01-01", "2026-12-02"],
  });

  for (const term of STANDARD_PAYMENT_TERMS) {
    await services.paymentTerm.create(ctx, term);
  }
  for (const term of STANDARD_SHIPPING_TERMS) {
    await services.shippingTerm.create(ctx, term);
  }

  // Packaging conversions: a case of 24 eaches weighing 7.2 kg, on 40-case pallets.
  await services.uom.createUnit(ctx, {
    code: "CASE",
    name: "Case",
    dimension: "count",
    toBase: 24,
    precision: 2,
  });
  await services.uom.createUnit(ctx, {
    code: "PALLET",
    name: "Pallet",
    dimension: "count",
    toBase: 960,
    precision: 3,
  });
  await services.uom.defineConversion(ctx, {
    from: "CASE",
    to: "KG",
    factor: 7.2,
    note: "Gross weight of a standard case",
  });
}

export async function seedFxRates(
  container: MasterDataContainer,
  ctx: TenantContext,
): Promise<void> {
  const validFrom = "2026-01-01T00:00:00.000Z";
  const rates: readonly { base: string; quote: string; rate: number; unit?: number }[] = [
    { base: "EUR", quote: "USD", rate: 1.0842 },
    { base: "GBP", quote: "USD", rate: 1.2673 },
    { base: "USD", quote: "CAD", rate: 1.3555 },
    { base: "USD", quote: "CHF", rate: 0.8792 },
    { base: "USD", quote: "SEK", rate: 10.4321 },
    // The yen is quoted per 100 units, as market convention has it.
    { base: "USD", quote: "JPY", rate: 15_712, unit: 100 },
  ];
  for (const rate of rates) {
    await container.services.fx.quote(ctx, { ...rate, validFrom, source: "ecb-demo" });
  }
  await container.services.fx.quote(ctx, {
    base: "EUR",
    quote: "USD",
    rate: 1.0765,
    rateType: "monthly-average",
    validFrom,
    source: "ecb-demo",
  });
}

export async function seedDemoData(
  container: MasterDataContainer,
  tenant = "demo",
  user = "seed-bot",
): Promise<SeededMasterData> {
  const ctx = createTenantContext(tenant, user, ["mdm.admin"]);
  const { services } = container;

  await seedReferenceData(container, ctx);
  await seedFxRates(container, ctx);

  const northwind = await services.customer.create(ctx, {
    number: "C-000001",
    legalName: "Northwind Traders Inc.",
    tradingName: "Northwind",
    classification: "enterprise",
    currency: "USD",
    industryCode: "RETAIL.GROC",
    segmentCode: "STRATEGIC",
    taxCategoryCode: "STANDARD",
    registeredAddress: {
      line1: "1200 Harbor Boulevard",
      line2: "Suite 400",
      city: "Boston",
      region: "MA",
      postalCode: "021101234",
      countryCode: "US",
      coordinates: { latitude: 42.3554, longitude: -71.0524 },
    },
    tags: ["key-account", "edi"],
  });
  await services.customer.addIdentifier(ctx, northwind.id, {
    scheme: "tax",
    value: "123456789",
    countryCode: "US",
  });
  await services.customer.addIdentifier(ctx, northwind.id, { scheme: "duns", value: "150483782" });
  await services.customer.addContact(ctx, northwind.id, {
    name: "Dana Whitfield",
    email: "dana.whitfield@northwind.example",
    jobTitle: "Head of Procurement",
    roles: ["primary", "billing"],
  });
  await services.customer.changeStatus(ctx, northwind.id, "active");
  await services.customer.assignTerms(ctx, northwind.id, {
    paymentTermCode: "2-10-NET30",
    shippingTermCode: "DAP-CUST",
  });
  await services.customer.setCreditLimit(ctx, northwind.id, {
    amountMinor: 25_000_000,
    currency: "USD",
  }, "A-");

  const northwindHq = await services.site.create(ctx, {
    customerId: northwind.id,
    code: "HQ",
    name: "Northwind head office",
    roles: ["sold_to", "bill_to", "payer"],
    address: {
      organization: "Northwind Traders Inc.",
      line1: "1200 Harbor Boulevard",
      line2: "Suite 400",
      city: "Boston",
      region: "MA",
      postalCode: "02110",
      countryCode: "US",
      coordinates: { latitude: 42.3554, longitude: -71.0524 },
    },
    timezone: "America/New_York",
    primaryForRoles: ["bill_to"],
  });

  const northwindDc = await services.site.create(ctx, {
    customerId: northwind.id,
    code: "DC-EAST",
    name: "Northwind eastern distribution centre",
    roles: ["ship_to", "return_to"],
    address: {
      line1: "88 Industrial Parkway",
      city: "Worcester",
      region: "MA",
      postalCode: "01604",
      countryCode: "US",
      coordinates: { latitude: 42.2626, longitude: -71.8023 },
    },
    timezone: "America/New_York",
    deliveryInstructions: "Deliveries 06:00-14:00, dock 4, appointment required",
    gln: "0614141123452",
    primaryForRoles: ["ship_to"],
  });

  const rheintal = await services.customer.create(ctx, {
    number: "C-000002",
    legalName: "Rheintal Präzisionstechnik GmbH",
    classification: "mid_market",
    currency: "EUR",
    industryCode: "MFG.ELEC",
    segmentCode: "KEY",
    taxCategoryCode: "REVERSE",
    registeredAddress: {
      line1: "Industriestrasse 14",
      city: "Konstanz",
      postalCode: "78462",
      countryCode: "DE",
      coordinates: { latitude: 47.6603, longitude: 9.1758 },
    },
    tags: ["eu", "vat-reverse-charge"],
  });
  await services.customer.addIdentifier(ctx, rheintal.id, {
    scheme: "vat",
    value: "DE136695976",
    countryCode: "DE",
  });
  await services.customer.addContact(ctx, rheintal.id, {
    name: "Markus Bauer",
    email: "m.bauer@rheintal.example",
    jobTitle: "Einkaufsleiter",
    roles: ["primary"],
  });
  await services.customer.changeStatus(ctx, rheintal.id, "active");
  await services.customer.assignTerms(ctx, rheintal.id, {
    paymentTermCode: "EOM15",
    shippingTermCode: "FCA-DOCK",
  });

  const rheintalWorks = await services.site.create(ctx, {
    customerId: rheintal.id,
    code: "WERK1",
    name: "Rheintal Werk 1",
    roles: ["sold_to", "ship_to", "bill_to"],
    address: {
      line1: "Industriestrasse 14",
      city: "Konstanz",
      postalCode: "78462",
      countryCode: "DE",
      coordinates: { latitude: 47.6603, longitude: 9.1758 },
    },
    timezone: "Europe/Berlin",
    primaryForRoles: ["ship_to", "bill_to"],
  });

  // A subsidiary, to exercise hierarchy queries.
  const rheintalAustria = await services.customer.create(ctx, {
    number: "C-000003",
    legalName: "Rheintal Präzisionstechnik Austria GmbH",
    classification: "small_business",
    currency: "EUR",
    industryCode: "MFG.ELEC",
    parentId: rheintal.id,
    registeredAddress: {
      line1: "Lastenstrasse 9",
      city: "Bregenz",
      postalCode: "6900",
      countryCode: "AT",
    },
  });
  await services.customer.addIdentifier(ctx, rheintalAustria.id, {
    scheme: "vat",
    value: "ATU13585627",
    countryCode: "AT",
  });
  await services.customer.changeStatus(ctx, rheintalAustria.id, "active");

  return {
    ctx,
    customers: {
      northwind,
      rheintal,
      rheintalAustria,
    },
    sites: {
      northwindHq,
      northwindDc,
      rheintalWorks,
    },
  };
}
