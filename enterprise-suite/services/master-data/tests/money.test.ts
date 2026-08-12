import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocate,
  formatMoney,
  makeMoney,
  moneyFromMinor,
  percentOf,
  requireCurrency,
  roundToCash,
  roundWith,
  split,
  toMinorUnits,
} from "../src/domain/currency.js";
import { FxRateTable, convertMoney, type FxRate } from "../src/domain/fx.js";
import { expectRejects, expectThrows, world } from "./helpers.js";

function rate(
  base: string,
  quote: string,
  value: number,
  options: { unit?: number; validFrom?: string; rateType?: FxRate["rateType"] } = {},
): FxRate {
  return {
    id: `${base}${quote}${options.rateType ?? "spot"}${options.validFrom ?? ""}` as FxRate["id"],
    tenantId: "acme" as FxRate["tenantId"],
    base: requireCurrency(base).code,
    quote: requireCurrency(quote).code,
    rate: value,
    unit: options.unit ?? 1,
    rateType: options.rateType ?? "spot",
    validFrom: (options.validFrom ?? "2026-01-01T00:00:00.000Z") as FxRate["validFrom"],
    source: "test",
    createdAt: "2026-01-01T00:00:00.000Z" as FxRate["createdAt"],
  };
}

describe("minor units", () => {
  it("respects each currency's scale", () => {
    assert.equal(toMinorUnits(12.34, "USD"), 1234);
    // The yen has no minor unit; the dinar has three.
    assert.equal(toMinorUnits(1234, "JPY"), 1234);
    assert.equal(toMinorUnits(1.2345, "KWD"), 1235);
    assert.equal(formatMoney(moneyFromMinor(1234, "JPY")), "1,234 JPY");
    assert.equal(formatMoney(moneyFromMinor(-123456, "USD")), "-1,234.56 USD");
    assert.equal(formatMoney(moneyFromMinor(123456, "EUR"), { withSymbol: true }), "1,234.56 €");
  });

  it("rejects fractional minor units", () => {
    expectThrows(() => moneyFromMinor(10.5, "USD"), "CURRENCY_ERROR", "integer");
  });

  it("rounds half-even away from a systematic bias", () => {
    assert.equal(roundWith(2.5, "half-even"), 2);
    assert.equal(roundWith(3.5, "half-even"), 4);
    assert.equal(roundWith(2.5, "half-up"), 3);
    // half-up is symmetric around zero, as accounting expects.
    assert.equal(roundWith(-2.5, "half-up"), -3);
    assert.equal(roundWith(-2.5, "trunc"), -2);
    assert.equal(roundWith(234.5, "half-down"), 234);
    assert.equal(makeMoney(12.345, "USD", "ceil").amountMinor, 1235);
  });

  it("rounds to the cash increment where one exists", () => {
    // Swiss cash rounds to five rappen; the booked amount does not.
    assert.equal(roundToCash(moneyFromMinor(103, "CHF")).amountMinor, 105);
    assert.equal(roundToCash(moneyFromMinor(102, "CHF")).amountMinor, 100);
    assert.equal(roundToCash(moneyFromMinor(103, "USD")).amountMinor, 103);
  });
});

describe("allocation", () => {
  it("never loses or invents minor units", () => {
    const parts = split(moneyFromMinor(100, "USD"), 3);
    assert.deepEqual(
      parts.map((part) => part.amountMinor),
      [34, 33, 33],
    );
    assert.equal(
      parts.reduce((sum, part) => sum + part.amountMinor, 0),
      100,
    );
  });

  it("hands leftovers to the largest remainders", () => {
    const parts = allocate(moneyFromMinor(1000, "USD"), [30, 40, 30]);
    assert.deepEqual(
      parts.map((part) => part.amountMinor),
      [300, 400, 300],
    );
    const awkward = allocate(moneyFromMinor(1001, "USD"), [1, 1, 1]);
    assert.deepEqual(
      awkward.map((part) => part.amountMinor),
      [334, 334, 333],
    );
  });

  it("preserves the sign of a credit note", () => {
    const parts = allocate(moneyFromMinor(-100, "USD"), [1, 1, 1]);
    assert.equal(
      parts.reduce((sum, part) => sum + part.amountMinor, 0),
      -100,
    );
  });

  it("applies percentages with explicit rounding", () => {
    assert.equal(percentOf(moneyFromMinor(12345, "USD"), 2).amountMinor, 247);
    assert.equal(percentOf(moneyFromMinor(12345, "USD"), 2, "floor").amountMinor, 246);
  });
});

describe("FX resolution", () => {
  const table = new FxRateTable([
    rate("EUR", "USD", 1.0842),
    rate("GBP", "USD", 1.2673),
    rate("USD", "JPY", 15712, { unit: 100 }),
    rate("EUR", "USD", 1.0765, { rateType: "monthly-average" }),
    rate("EUR", "USD", 1.12, { validFrom: "2026-03-01T00:00:00.000Z" }),
  ]);
  const asOf = "2026-02-01T00:00:00.000Z";

  it("prefers the direct quote", () => {
    const resolved = table.resolve("EUR", "USD", { asOf });
    assert.equal(resolved.path, "direct");
    assert.equal(resolved.factor, 1.0842);
  });

  it("inverts the opposite quote when no direct one exists", () => {
    const resolved = table.resolve("USD", "EUR", { asOf });
    assert.equal(resolved.path, "inverse");
    assert.ok(Math.abs(resolved.factor - 1 / 1.0842) < 1e-12);
    assert.equal(resolved.legs[0]?.inverted, true);
  });

  it("triangulates through a pivot and records both legs", () => {
    const resolved = table.resolve("GBP", "EUR", { asOf, pivots: ["USD"] });
    assert.equal(resolved.path, "triangulated");
    assert.equal(resolved.legs.length, 2);
    assert.ok(Math.abs(resolved.factor - 1.2673 / 1.0842) < 1e-12);
  });

  it("refuses to triangulate when the caller wants a direct rate", () => {
    expectThrows(
      () => table.resolve("GBP", "EUR", { asOf, directOnly: true }),
      "FX_RATE_UNAVAILABLE",
      "GBP/EUR",
    );
  });

  it("keeps rate types apart", () => {
    assert.equal(table.resolve("EUR", "USD", { asOf, rateType: "monthly-average" }).factor, 1.0765);
    expectThrows(
      () => table.resolve("GBP", "USD", { asOf, rateType: "budget" }),
      "FX_RATE_UNAVAILABLE",
      "budget",
    );
  });

  it("picks the rate effective on the date, not the newest", () => {
    assert.equal(table.resolve("EUR", "USD", { asOf: "2026-02-15T00:00:00.000Z" }).factor, 1.0842);
    assert.equal(table.resolve("EUR", "USD", { asOf: "2026-03-15T00:00:00.000Z" }).factor, 1.12);
    // Before any quote exists there is no rate to fall back on.
    expectThrows(
      () => table.resolve("EUR", "USD", { asOf: "2025-12-31T00:00:00.000Z" }),
      "FX_RATE_UNAVAILABLE",
    );
  });

  it("converts a currency to itself without a rate", () => {
    const resolved = table.resolve("SEK", "SEK", { asOf });
    assert.equal(resolved.path, "identity");
    assert.equal(resolved.factor, 1);
  });
});

describe("FX conversion", () => {
  const table = new FxRateTable([rate("EUR", "USD", 1.0842), rate("USD", "JPY", 15712, { unit: 100 })]);
  const asOf = "2026-02-01T00:00:00.000Z";

  it("re-scales between currencies with different precision", () => {
    // 100.00 USD at 157.12 JPY/USD is 15,712 JPY — no decimals in the result.
    const converted = convertMoney(table, moneyFromMinor(10_000, "USD"), "JPY", { asOf });
    assert.equal(converted.to.amountMinor, 15_712);
    assert.equal(String(converted.to.currency), "JPY");

    const back = convertMoney(table, moneyFromMinor(15_712, "JPY"), "USD", { asOf });
    assert.equal(back.to.amountMinor, 10_000);
  });

  it("keeps the unrounded amount for audit", () => {
    const converted = convertMoney(table, moneyFromMinor(999, "EUR"), "USD", { asOf });
    assert.equal(converted.to.amountMinor, 1083);
    assert.ok(Math.abs(converted.rawMinor - 1083.11) < 0.01);
    assert.equal(converted.resolution.path, "direct");
  });
});

describe("currency service", () => {
  it("keeps exactly one functional currency", async () => {
    const { container, ctx } = world();
    const { currency } = container.services;
    await currency.enable(ctx, { code: "USD" });
    await currency.enable(ctx, { code: "EUR" });
    await currency.setFunctional(ctx, "USD");
    assert.equal(await currency.functionalCurrency(ctx), "USD");

    await currency.setFunctional(ctx, "EUR");
    assert.equal(await currency.functionalCurrency(ctx), "EUR");
    const enabled = await currency.listEnabled(ctx);
    assert.equal(enabled.filter((c) => c.isFunctional).length, 1);
  });

  it("will not disable the currency the books are kept in", async () => {
    const { container, ctx } = world();
    const { currency } = container.services;
    await currency.setFunctional(ctx, "USD");
    await expectRejects(currency.disable(ctx, "USD"), "INVALID_STATE", "functional currency");
  });

  it("rejects unknown currencies and duplicate enablement", async () => {
    const { container, ctx } = world();
    const { currency } = container.services;
    await expectRejects(currency.enable(ctx, { code: "XYZ" }), "CURRENCY_ERROR", "Unknown currency");
    await currency.enable(ctx, { code: "GBP" });
    await expectRejects(currency.enable(ctx, { code: "GBP" }), "CONFLICT", "already enabled");
  });
});

describe("fx service", () => {
  async function fxWorld() {
    const w = world();
    for (const code of ["USD", "EUR", "GBP", "JPY"]) {
      await w.container.services.currency.enable(w.ctx, { code });
    }
    await w.container.services.currency.setFunctional(w.ctx, "USD");
    return w;
  }

  it("publishes an event per quote and refuses a same-day duplicate", async () => {
    const { container, ctx } = await fxWorld();
    const { fx } = container.services;
    await fx.quote(ctx, { base: "EUR", quote: "USD", rate: 1.0842, validFrom: "2026-01-01T00:00:00.000Z" });
    await expectRejects(
      fx.quote(ctx, { base: "EUR", quote: "USD", rate: 1.09, validFrom: "2026-01-01T00:00:00.000Z" }),
      "CONFLICT",
      "correct it instead",
    );
    const quoted = container.outbox.entries(ctx.tenantId).filter((e) => e.eventType === "mdm.fx-rate.quoted");
    assert.equal(quoted.length, 1);
  });

  it("records the previous value when a bad feed rate is corrected", async () => {
    const { container, ctx } = await fxWorld();
    const { fx } = container.services;
    const original = await fx.quote(ctx, {
      base: "GBP",
      quote: "USD",
      rate: 12.673,
      validFrom: "2026-01-01T00:00:00.000Z",
      source: "feed",
    });
    const corrected = await fx.correct(ctx, original.id, 1.2673, "decimal point in the provider file");
    assert.equal(corrected.rate, 1.2673);

    const event = container.outbox
      .entries(ctx.tenantId)
      .find((e) => e.eventType === "mdm.fx-rate.corrected");
    assert.equal((event?.payload as { previousRate: number }).previousRate, 12.673);
    await expectRejects(fx.correct(ctx, original.id, 1.2673, "again"), "INVALID_STATE", "already");
  });

  it("reports per-row failures on a bulk load instead of aborting", async () => {
    const { container, ctx } = await fxWorld();
    const result = await container.services.fx.quoteMany(ctx, [
      { base: "EUR", quote: "USD", rate: 1.0842, validFrom: "2026-01-01T00:00:00.000Z" },
      { base: "EUR", quote: "EUR", rate: 1, validFrom: "2026-01-01T00:00:00.000Z" },
      { base: "GBP", quote: "USD", rate: -1, validFrom: "2026-01-01T00:00:00.000Z" },
      { base: "GBP", quote: "USD", rate: 1.2673, validFrom: "2026-01-01T00:00:00.000Z" },
    ]);
    assert.equal(result.accepted.length, 2);
    assert.equal(result.rejected.length, 2);
    assert.match(result.rejected[0]!.reason, /against itself/);
  });

  it("triangulates through the tenant's functional currency by default", async () => {
    const { container, ctx } = await fxWorld();
    const { fx } = container.services;
    await fx.quote(ctx, { base: "EUR", quote: "USD", rate: 1.0842, validFrom: "2026-01-01T00:00:00.000Z" });
    await fx.quote(ctx, { base: "GBP", quote: "USD", rate: 1.2673, validFrom: "2026-01-01T00:00:00.000Z" });

    const resolved = await fx.resolve(ctx, "GBP", "EUR", { asOf: "2026-02-01T00:00:00.000Z" });
    assert.equal(resolved.path, "triangulated");
    assert.equal(String(resolved.legs[0]?.quote), "USD");

    const triplet = await fx.expressInAll(ctx, moneyFromMinor(100_00, "EUR"), "GBP", {
      asOf: "2026-02-01T00:00:00.000Z",
    });
    assert.equal(triplet.transaction.amountMinor, 10_000);
    assert.equal(String(triplet.functional.currency), "USD");
    assert.equal(triplet.functional.amountMinor, 10_842);
    assert.equal(String(triplet.reporting.currency), "GBP");
  });

  it("isolates rates by tenant", async () => {
    const { container, ctx } = await fxWorld();
    const other = world("globex").ctx;
    await container.services.fx.quote(ctx, {
      base: "EUR",
      quote: "USD",
      rate: 1.0842,
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    assert.equal((await container.services.fx.list(other)).length, 0);
    await expectRejects(
      container.services.fx.resolve(other, "EUR", "USD", { asOf: "2026-02-01T00:00:00.000Z" }),
      "FX_RATE_UNAVAILABLE",
    );
  });
});
