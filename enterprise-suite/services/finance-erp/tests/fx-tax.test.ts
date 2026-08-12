import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapTenant } from "./support/fixture.js";

test("fx rates: store and look up latest effective rate on or before a date", async () => {
  const fixture = await bootstrapTenant();
  const { fx } = fixture.app.services;

  await fx.storeRate(fixture.ctx, {
    baseCurrency: "eur", quoteCurrency: "usd", rateMicros: 1_050_000, asOfDate: "2026-01-01",
  });
  await fx.storeRate(fixture.ctx, {
    baseCurrency: "EUR", quoteCurrency: "USD", rateMicros: 1_084_500, asOfDate: "2026-01-15",
  });
  await fx.storeRate(fixture.ctx, {
    baseCurrency: "EUR", quoteCurrency: "USD", rateMicros: 1_120_000, asOfDate: "2026-02-01",
  });
  await fx.storeRate(fixture.ctx, {
    baseCurrency: "EUR", quoteCurrency: "GBP", rateMicros: 850_000, asOfDate: "2026-01-10",
  });

  const midJanuary = await fx.getRate(fixture.ctx, "EUR", "USD", "2026-01-20");
  assert.equal(midJanuary.rateMicros, 1_084_500, "latest rate on or before the date wins");

  const exactDay = await fx.getRate(fixture.ctx, "EUR", "USD", "2026-02-01");
  assert.equal(exactDay.rateMicros, 1_120_000);

  await assert.rejects(fx.getRate(fixture.ctx, "EUR", "USD", "2025-12-31"), /FxRate not found/);
  await assert.rejects(fx.getRate(fixture.ctx, "EUR", "JPY", "2026-02-01"), /FxRate not found/);

  const usdOnly = await fx.listRates(fixture.ctx, { base: "EUR", quote: "USD" });
  assert.equal(usdOnly.length, 3);
  const all = await fx.listRates(fixture.ctx);
  assert.equal(all.length, 4);
});

test("tax codes: duplicates rejected, deactivated codes unusable on invoices", async () => {
  const fixture = await bootstrapTenant();
  const { tax, ar } = fixture.app.services;

  await assert.rejects(
    tax.createTaxCode(fixture.ctx, { code: "VAT20", name: "again", rateBps: 2000 }),
    /already exists/,
  );

  const codes = await tax.listTaxCodes(fixture.ctx);
  const vat5 = codes.find((t) => t.code === "VAT5")!;
  await tax.deactivateTaxCode(fixture.ctx, vat5.id);

  await assert.rejects(
    ar.createInvoice(fixture.ctx, {
      customerId: "c1",
      customerName: "C1",
      currency: "EUR",
      issueDate: "2026-01-05",
      dueDate: "2026-01-25",
      lines: [{
        description: "x", quantityMilli: 1000, unitPriceMinor: 1000,
        revenueAccountCode: "4000", taxCode: "VAT5",
      }],
    }),
    /does not apply to sales/,
  );
});

test("purchase-only tax codes cannot be used on AR invoices", async () => {
  const fixture = await bootstrapTenant();
  const { tax, ar, ap } = fixture.app.services;
  await tax.createTaxCode(fixture.ctx, {
    code: "IMPORT10", name: "Import duty 10%", rateBps: 1000, scope: "PURCHASE",
  });

  await assert.rejects(
    ar.createInvoice(fixture.ctx, {
      customerId: "c1",
      customerName: "C1",
      currency: "EUR",
      issueDate: "2026-01-05",
      dueDate: "2026-01-25",
      lines: [{
        description: "x", quantityMilli: 1000, unitPriceMinor: 1000,
        revenueAccountCode: "4000", taxCode: "IMPORT10",
      }],
    }),
    /does not apply to sales/,
  );

  const bill = await ap.createBill(fixture.ctx, {
    supplierId: "s1",
    supplierName: "S1",
    currency: "EUR",
    billDate: "2026-01-05",
    dueDate: "2026-01-25",
    lines: [{
      description: "imported goods", quantityMilli: 1000, unitCostMinor: 10_000,
      expenseAccountCode: "5200", taxCode: "IMPORT10",
    }],
  });
  assert.equal(bill.taxTotalMinor, 1000);
});
