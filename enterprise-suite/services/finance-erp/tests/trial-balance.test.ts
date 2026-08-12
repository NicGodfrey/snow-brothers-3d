import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapTenant, postSimpleJournal } from "./support/fixture.js";

test("trial balance aggregates posted journals per account and always balances", async () => {
  const fixture = await bootstrapTenant();
  const { trialBalance } = fixture.app.services;

  // Capitalize the company, buy equipment, book revenue.
  await postSimpleJournal(fixture, {
    date: "2026-01-05", amountMinor: 5_000_000, debitCode: "1000", creditCode: "3000",
  });
  await postSimpleJournal(fixture, {
    date: "2026-01-12", amountMinor: 1_200_000, debitCode: "1500", creditCode: "1000",
  });
  await postSimpleJournal(fixture, {
    date: "2026-01-20", amountMinor: 750_000, debitCode: "1000", creditCode: "4000",
  });

  const tb = await trialBalance.compute(fixture.ctx, { periodCode: "2026-01" });
  assert.ok(tb.balanced);
  assert.equal(tb.totalDebitMinor, 6_950_000);
  assert.equal(tb.totalCreditMinor, 6_950_000);
  assert.equal(tb.journalCount, 3);

  const cash = tb.rows.find((r) => r.accountCode === "1000")!;
  assert.equal(cash.debitMinor, 5_750_000);
  assert.equal(cash.creditMinor, 1_200_000);
  assert.equal(cash.netMinor, 4_550_000);
  assert.equal(cash.balanceMinor, 4_550_000, "asset balance presented on debit side");

  const capital = tb.rows.find((r) => r.accountCode === "3000")!;
  assert.equal(capital.netMinor, -5_000_000);
  assert.equal(capital.balanceMinor, 5_000_000, "equity balance presented on credit side");

  const revenue = tb.rows.find((r) => r.accountCode === "4000")!;
  assert.equal(revenue.balanceMinor, 750_000);
});

test("draft journals never hit the trial balance", async () => {
  const fixture = await bootstrapTenant();
  const { journals, trialBalance } = fixture.app.services;

  await journals.createDraft(fixture.ctx, {
    journalDate: "2026-03-10",
    currency: "EUR",
    lines: [
      { accountCode: "5000", debitMinor: 999 },
      { accountCode: "1000", creditMinor: 999 },
    ],
  });

  const tb = await trialBalance.compute(fixture.ctx, { periodCode: "2026-03" });
  assert.equal(tb.rows.length, 0);
  assert.equal(tb.journalCount, 0);
  assert.ok(tb.balanced);
});

test("PERIOD basis isolates one month; CUMULATIVE accumulates from inception", async () => {
  const fixture = await bootstrapTenant();
  const { trialBalance } = fixture.app.services;

  await postSimpleJournal(fixture, {
    date: "2026-01-15", amountMinor: 100_000, debitCode: "1000", creditCode: "3000",
  });
  await postSimpleJournal(fixture, {
    date: "2026-02-15", amountMinor: 30_000, debitCode: "5000", creditCode: "1000",
  });

  const feb = await trialBalance.compute(fixture.ctx, { periodCode: "2026-02", basis: "PERIOD" });
  const febCash = feb.rows.find((r) => r.accountCode === "1000")!;
  assert.equal(febCash.debitMinor, 0);
  assert.equal(febCash.creditMinor, 30_000);
  assert.equal(feb.rows.find((r) => r.accountCode === "3000"), undefined, "January-only account absent");

  const cumulative = await trialBalance.compute(fixture.ctx, {
    periodCode: "2026-02",
    basis: "CUMULATIVE",
  });
  const cumulativeCash = cumulative.rows.find((r) => r.accountCode === "1000")!;
  assert.equal(cumulativeCash.netMinor, 70_000);
  assert.ok(cumulative.rows.find((r) => r.accountCode === "3000"), "capital included cumulatively");
  assert.ok(cumulative.balanced);
});

test("unknown period is a 404", async () => {
  const fixture = await bootstrapTenant();
  await assert.rejects(
    fixture.app.services.trialBalance.compute(fixture.ctx, { periodCode: "2027-01" }),
    /PostingPeriod not found/,
  );
});
