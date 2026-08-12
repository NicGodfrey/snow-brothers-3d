import test from "node:test";
import assert from "node:assert/strict";
import { ConflictError, NotFoundError, sku, tenantId } from "../src/kernel/index.js";
import { PriceList } from "../src/domain/pricing/price-list.js";
import { TaxCalculator } from "../src/domain/pricing/tax.js";
import {
  applyDiscount,
  assertValidDiscountPercent,
  requiresManagerApproval,
  volumeDiscountPercent,
} from "../src/domain/pricing/discount.js";
import { money } from "../src/kernel/money.js";
import { makeModule, repCtx } from "./helpers.js";
import { SEED_SKUS, seedDemoData } from "../src/fixtures/seed.js";

function listWithTiers(): PriceList {
  const list = PriceList.create(tenantId("t"), { name: "L", currency: "EUR" });
  list.upsertItem({
    sku: sku("widget-std"),
    description: "Widget",
    tiers: [
      { minQty: 1, unitPriceMinor: 2_500 },
      { minQty: 10, unitPriceMinor: 2_300 },
      { minQty: 100, unitPriceMinor: 2_000 },
    ],
  });
  return list;
}

test("price list: tier boundaries pick the highest applicable tier", () => {
  const list = listWithTiers();
  const widget = sku("WIDGET-STD");
  assert.equal(list.priceFor(widget, 1).amountMinor, 2_500);
  assert.equal(list.priceFor(widget, 9).amountMinor, 2_500);
  assert.equal(list.priceFor(widget, 10).amountMinor, 2_300);
  assert.equal(list.priceFor(widget, 99).amountMinor, 2_300);
  assert.equal(list.priceFor(widget, 100).amountMinor, 2_000);
  assert.equal(list.priceFor(widget, 10_000).amountMinor, 2_000);
});

test("price list: tier validation rules", () => {
  const list = PriceList.create(tenantId("t"), { name: "L", currency: "EUR" });
  assert.throws(() => list.upsertItem({ sku: sku("A"), description: "a", tiers: [] }), ConflictError);
  assert.throws(
    () => list.upsertItem({ sku: sku("A"), description: "a", tiers: [{ minQty: 5, unitPriceMinor: 1 }] }),
    /tier starting at qty 1/,
  );
  assert.throws(
    () =>
      list.upsertItem({
        sku: sku("A"),
        description: "a",
        tiers: [
          { minQty: 1, unitPriceMinor: 1 },
          { minQty: 1, unitPriceMinor: 2 },
        ],
      }),
    /Duplicate tier/,
  );
  assert.throws(() => list.removeItem(sku("MISSING")), NotFoundError);
});

test("price list: archive freezes edits", () => {
  const list = listWithTiers();
  list.archive();
  assert.throws(
    () => list.upsertItem({ sku: sku("B"), description: "b", tiers: [{ minQty: 1, unitPriceMinor: 1 }] }),
    /archived/,
  );
  assert.throws(() => list.archive(), ConflictError);
});

test("pricing service: only one default list per currency", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  module.pricing.create(ctx, { name: "Default EUR", currency: "EUR", isDefault: true });
  assert.throws(
    () => module.pricing.create(ctx, { name: "Second", currency: "EUR", isDefault: true }),
    ConflictError,
  );
  // Other currency is fine.
  module.pricing.create(ctx, { name: "Default USD", currency: "USD", isDefault: true });
});

test("pricing service: resolvePrice falls back to default list and checks currency", () => {
  const { module } = makeModule();
  const refs = seedDemoData(module);
  const { unitPrice } = module.pricing.resolvePrice(refs.ctx, {
    currency: "EUR",
    sku: SEED_SKUS.widget,
    qty: 100,
  });
  assert.equal(unitPrice.amountMinor, 2_000);
  assert.throws(
    () =>
      module.pricing.resolvePrice(refs.ctx, {
        priceListId: refs.priceListId,
        currency: "USD",
        sku: SEED_SKUS.widget,
        qty: 1,
      }),
    ConflictError,
  );
});

test("tax calculator: groups by category with per-region rates", () => {
  const calc = new TaxCalculator();
  const lines = [
    { lineId: "1", taxCategory: "standard" as const, netAmount: money(10_000, "EUR") },
    { lineId: "2", taxCategory: "standard" as const, netAmount: money(5_000, "EUR") },
    { lineId: "3", taxCategory: "reduced" as const, netAmount: money(1_000, "EUR") },
    { lineId: "4", taxCategory: "exempt" as const, netAmount: money(9_999, "EUR") },
  ];
  const taxLines = calc.computeTaxLines(lines, "DE", "EUR");
  assert.equal(taxLines.length, 3);
  const standard = taxLines.find((t) => t.taxCategory === "standard");
  assert.equal(standard?.baseAmount.amountMinor, 15_000);
  assert.equal(standard?.ratePercent, 19);
  assert.equal(standard?.taxAmount.amountMinor, 2_850);
  const reduced = taxLines.find((t) => t.taxCategory === "reduced");
  assert.equal(reduced?.taxAmount.amountMinor, 70);
  const exempt = taxLines.find((t) => t.taxCategory === "exempt");
  assert.equal(exempt?.taxAmount.amountMinor, 0);
  // Unknown region falls back to zero rates.
  assert.equal(calc.totalTax(lines, "ZZ", "EUR").amountMinor, 0);
});

test("discounts: validation bounds, volume ladder, manager threshold", () => {
  assert.throws(() => assertValidDiscountPercent(-1), ConflictError);
  assert.throws(() => assertValidDiscountPercent(61), ConflictError);
  assertValidDiscountPercent(0);
  assertValidDiscountPercent(60);

  assert.equal(volumeDiscountPercent(1), 0);
  assert.equal(volumeDiscountPercent(10), 2.5);
  assert.equal(volumeDiscountPercent(50), 5);
  assert.equal(volumeDiscountPercent(99), 5);
  assert.equal(volumeDiscountPercent(100), 8);

  const { net, discount } = applyDiscount(money(46_000, "EUR"), 2.5);
  assert.equal(discount.amountMinor, 1_150);
  assert.equal(net.amountMinor, 44_850);

  assert.equal(requiresManagerApproval(15), false);
  assert.equal(requiresManagerApproval(15.1), true);
});
