import assert from "node:assert/strict";
import { test } from "node:test";
import { tenantId, type CurrencyCode } from "@enterprise-suite/shared-kernel";
import { Account, normalBalanceOf } from "../src/domain/account.js";
import { AllocationRule } from "../src/domain/allocation.js";
import { CostCenter } from "../src/domain/cost-center.js";
import { FxRate } from "../src/domain/fx-rate.js";
import { newAccountId, newCostCenterId, applyBps } from "../src/domain/ids.js";
import { TaxCode } from "../src/domain/tax-code.js";

const TENANT = tenantId("t-refdata");
const EUR = "EUR" as CurrencyCode;

test("normal balance derives from account type", () => {
  assert.equal(normalBalanceOf("ASSET"), "DEBIT");
  assert.equal(normalBalanceOf("EXPENSE"), "DEBIT");
  assert.equal(normalBalanceOf("LIABILITY"), "CREDIT");
  assert.equal(normalBalanceOf("EQUITY"), "CREDIT");
  assert.equal(normalBalanceOf("REVENUE"), "CREDIT");
});

test("account codes must be numeric, names required", () => {
  const bad = Account.create(TENANT, { code: "CASH", name: "Cash", type: "ASSET", currency: EUR });
  assert.ok(!bad.ok);
  const blank = Account.create(TENANT, { code: "1000", name: "  ", type: "ASSET", currency: EUR });
  assert.ok(!blank.ok);
  const good = Account.create(TENANT, { code: "1000.01", name: "Petty cash", type: "ASSET", currency: EUR });
  assert.ok(good.ok);
  assert.equal(good.value.normalBalance, "DEBIT");
});

test("deactivated accounts stop accepting postings", () => {
  const account = (Account.create(TENANT, {
    code: "5000", name: "Salaries", type: "EXPENSE", currency: EUR,
  }) as { ok: true; value: Account }).value;
  assert.ok(account.acceptsPostings());
  assert.ok(account.deactivate().ok);
  assert.ok(!account.acceptsPostings());
  assert.ok(!account.deactivate().ok, "double deactivate must fail");
  assert.ok(account.reactivate().ok);
  assert.ok(account.acceptsPostings());
});

test("summary accounts never accept postings", () => {
  const summary = (Account.create(TENANT, {
    code: "4999", name: "Total revenue", type: "REVENUE", currency: EUR, postable: false,
  }) as { ok: true; value: Account }).value;
  assert.ok(!summary.acceptsPostings());
});

test("tax code validates rate bounds and scope helpers", () => {
  const tooHigh = TaxCode.create(TENANT, { code: "VAT200", name: "bad", rateBps: 20_000 });
  assert.ok(!tooHigh.ok);

  const sales = (TaxCode.create(TENANT, {
    code: "VAT20", name: "VAT 20%", rateBps: 2000, scope: "SALES",
  }) as { ok: true; value: TaxCode }).value;
  assert.ok(sales.appliesTo("SALES"));
  assert.ok(!sales.appliesTo("PURCHASE"));
  assert.ok(sales.deactivate().ok);
  assert.ok(!sales.appliesTo("SALES"), "inactive tax codes apply nowhere");
});

test("applyBps rounds half away from zero on tax amounts", () => {
  assert.equal(applyBps(10_000, 2000), 2000);   // 20% of 100.00
  assert.equal(applyBps(333, 2000), 67);        // 66.6 rounds to 67
  assert.equal(applyBps(1, 500), 0);            // 0.05 rounds to 0
});

test("fx rate rejects identical pair and non-positive rates, stores micros", () => {
  const same = FxRate.store(TENANT, {
    baseCurrency: EUR, quoteCurrency: EUR, rateMicros: 1_000_000, asOfDate: "2026-01-31",
  });
  assert.ok(!same.ok);

  const zero = FxRate.store(TENANT, {
    baseCurrency: EUR, quoteCurrency: "USD" as CurrencyCode, rateMicros: 0, asOfDate: "2026-01-31",
  });
  assert.ok(!zero.ok);

  const good = FxRate.store(TENANT, {
    baseCurrency: EUR, quoteCurrency: "USD" as CurrencyCode, rateMicros: 1_084_500, asOfDate: "2026-01-31",
  });
  assert.ok(good.ok);
  assert.equal(good.value.rateMicros, 1_084_500);
  const events = good.value.pullEvents();
  assert.equal(events[0].eventType, "finance.fx-rate.stored");
});

test("cost center normalizes codes and validates format", () => {
  const cc = CostCenter.create(TENANT, { code: "ops", name: "Operations" });
  assert.ok(cc.ok);
  assert.equal(cc.value.code, "OPS");
  const bad = CostCenter.create(TENANT, { code: "a", name: "too short" });
  assert.ok(!bad.ok);
});

test("allocation rule requires targets summing to exactly 100%", () => {
  const source = newCostCenterId();
  const t1 = newCostCenterId();
  const t2 = newCostCenterId();
  const account = newAccountId();

  const under = AllocationRule.create(TENANT, {
    name: "IT recharge",
    sourceAccountId: account,
    sourceCostCenterId: source,
    targets: [
      { costCenterId: t1, percentBps: 5000 },
      { costCenterId: t2, percentBps: 4999 },
    ],
  });
  assert.ok(!under.ok);
  assert.match(under.error, /sum to 10000/);

  const selfTarget = AllocationRule.create(TENANT, {
    name: "IT recharge",
    sourceAccountId: account,
    sourceCostCenterId: source,
    targets: [{ costCenterId: source, percentBps: 10_000 }],
  });
  assert.ok(!selfTarget.ok);

  const good = AllocationRule.create(TENANT, {
    name: "IT recharge",
    sourceAccountId: account,
    sourceCostCenterId: source,
    targets: [
      { costCenterId: t1, percentBps: 6000 },
      { costCenterId: t2, percentBps: 4000 },
    ],
  });
  assert.ok(good.ok);
});

test("allocation split is exact: remainders land on the last target", () => {
  const source = newCostCenterId();
  const targets = [newCostCenterId(), newCostCenterId(), newCostCenterId()];
  const rule = (AllocationRule.create(TENANT, {
    name: "three-way",
    sourceAccountId: newAccountId(),
    sourceCostCenterId: source,
    targets: [
      { costCenterId: targets[0], percentBps: 3333 },
      { costCenterId: targets[1], percentBps: 3333 },
      { costCenterId: targets[2], percentBps: 3334 },
    ],
  }) as { ok: true; value: AllocationRule }).value;

  const parts = rule.split(1001);
  assert.equal(parts[0].amountMinor, 333);
  assert.equal(parts[1].amountMinor, 333);
  assert.equal(parts[2].amountMinor, 335); // absorbs the rounding remainder
  assert.equal(parts.reduce((s, p) => s + p.amountMinor, 0), 1001);

  const partsEven = rule.split(30_000);
  assert.deepEqual(partsEven.map((p) => p.amountMinor), [9999, 9999, 10_002]);
  assert.equal(partsEven.reduce((s, p) => s + p.amountMinor, 0), 30_000);
});
