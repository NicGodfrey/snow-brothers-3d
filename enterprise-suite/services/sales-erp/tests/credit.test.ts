import test from "node:test";
import assert from "node:assert/strict";
import { createTenantContext, money, tenantId } from "../src/kernel/index.js";
import { Account } from "../src/domain/accounts/account.js";
import { checkCredit } from "../src/domain/accounts/credit-policy.js";
import { makeAccount, makeDraftOrder, makeModule, repCtx } from "./helpers.js";

function account(creditLimitMinor: number | null): Account {
  return Account.create(tenantId("t"), {
    accountNumber: "ACC-1",
    name: "A",
    accountType: "customer",
    currency: "EUR",
    creditLimitMinor,
  });
}

test("credit policy: no limit configured approves trivially", () => {
  const result = checkCredit(account(null), money(999_999, "EUR"), money(500_000, "EUR"));
  assert.equal(result.decision, "approved");
  assert.equal(result.limitMinor, null);
});

test("credit policy: within limit approves", () => {
  const result = checkCredit(account(100_000), money(50_000, "EUR"), money(50_000, "EUR"));
  assert.equal(result.decision, "approved");
});

test("credit policy: within 10% tolerance requires review", () => {
  const result = checkCredit(account(100_000), money(95_000, "EUR"), money(10_000, "EUR"));
  assert.equal(result.decision, "review_required");
  assert.match(result.reasons[0], /tolerance/);
});

test("credit policy: beyond tolerance declines", () => {
  const result = checkCredit(account(100_000), money(105_000, "EUR"), money(10_000, "EUR"));
  assert.equal(result.decision, "declined");
});

test("credit policy: credit hold and closed accounts decline regardless of amounts", () => {
  const held = account(null);
  held.placeCreditHold("overdue");
  assert.equal(checkCredit(held, money(0, "EUR"), money(1, "EUR")).decision, "declined");

  const closed = account(null);
  closed.close();
  assert.equal(checkCredit(closed, money(0, "EUR"), money(1, "EUR")).decision, "declined");
});

test("credit service: exposure sums open orders only", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx, { creditLimitMinor: null });

  // 10 units x 10.00 EUR net, standard DE tax 19% => 11900 gross each order.
  const confirmed = makeDraftOrder(module, ctx, accountId, [["SKU-1", 10, 1000]]);
  module.orders.confirm(ctx, confirmed.id);
  const draft = makeDraftOrder(module, ctx, accountId, [["SKU-2", 10, 1000]]);
  const cancelled = makeDraftOrder(module, ctx, accountId, [["SKU-3", 10, 1000]]);
  module.orders.cancel(ctx, cancelled.id, { reason: "test" });

  const exposure = module.credit.openExposure(ctx, accountId);
  assert.equal(exposure.amountMinor, 11_900); // only the confirmed order counts
  assert.ok(draft.status === "draft");
});

test("credit service: tenant scoping applies", () => {
  const { module } = makeModule();
  const ctx = createTenantContext("tenant-x", "u", ["sales_rep"]);
  const accountId = makeAccount(module, ctx);
  const result = module.credit.check(ctx, accountId, money(10_000, "EUR"));
  assert.equal(result.decision, "approved");
});
