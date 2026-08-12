import { createTenantContext, type TenantContext, type Ulid } from "../src/kernel/index.js";
import { createSalesModule, type SalesModule } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { seedDemoData, type SeedRefs } from "../src/fixtures/seed.js";
import type { SalesOrder } from "../src/domain/orders/sales-order.js";

export function makeModule(dateTime = "2025-06-15T12:00:00Z"): { module: SalesModule; clock: FixedClock } {
  const clock = new FixedClock(dateTime);
  const module = createSalesModule({ clock });
  return { module, clock };
}

export function seeded(dateTime?: string): { module: SalesModule; clock: FixedClock; refs: SeedRefs } {
  const { module, clock } = makeModule(dateTime);
  const refs = seedDemoData(module);
  return { module, clock, refs };
}

export function repCtx(tenant = "tenant-test"): TenantContext {
  return createTenantContext(tenant, "user-rep", ["sales_rep"]);
}

export function managerCtx(tenant = "tenant-test"): TenantContext {
  return createTenantContext(tenant, "user-manager", ["sales_manager"]);
}

/** Creates a customer account with an explicit credit limit (or none). */
export function makeAccount(
  module: SalesModule,
  ctx: TenantContext,
  overrides: Record<string, unknown> = {},
): Ulid {
  const account = module.accounts.create(ctx, {
    name: "Test Customer",
    accountType: "customer",
    currency: "EUR",
    creditLimitMinor: 1_000_000,
    shippingAddress: { line1: "Dock 1", city: "Hamburg", postalCode: "20095", countryCode: "DE" },
    ...overrides,
  });
  return account.id;
}

/**
 * Creates a draft order with fully explicit lines (no price list needed).
 * Each line: [sku, qty, unitPriceMinor, discountPercent?]
 */
export function makeDraftOrder(
  module: SalesModule,
  ctx: TenantContext,
  accountId: Ulid,
  lines: ReadonlyArray<[string, number, number, number?]>,
): SalesOrder {
  return module.orders.createDraft(ctx, {
    accountId: accountId as unknown as string,
    taxRegion: "DE",
    lines: lines.map(([sku, qty, unitPriceMinor, discountPercent]) => ({
      sku,
      qty,
      unitPriceMinor,
      discountPercent: discountPercent ?? 0,
      description: `Item ${sku}`,
      taxCategory: "standard",
    })),
  });
}

/** Drives an order from draft to fully shipped. */
export function shipOrder(module: SalesModule, ctx: TenantContext, order: SalesOrder): SalesOrder {
  module.orders.confirm(ctx, order.id);
  module.orders.allocate(ctx, order.id, {
    allocations: order.lines.map((l) => ({ lineId: l.lineId as unknown as string, qty: l.qty })),
  });
  module.orders.ship(ctx, order.id, {
    shipments: order.lines.map((l) => ({ lineId: l.lineId as unknown as string, qty: l.qty })),
  });
  return module.orders.get(ctx, order.id);
}
