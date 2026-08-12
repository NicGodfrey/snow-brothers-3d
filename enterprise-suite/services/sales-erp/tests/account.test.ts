import test from "node:test";
import assert from "node:assert/strict";
import { ConflictError, NotFoundError, ValidationError, createTenantContext } from "../src/kernel/index.js";
import { AccountEventTypes } from "../src/domain/accounts/events.js";
import { makeAccount, makeModule, repCtx } from "./helpers.js";

test("accounts: create validates input and assigns document numbers", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  assert.throws(() => module.accounts.create(ctx, { name: "", accountType: "customer", currency: "EUR" }), ValidationError);
  assert.throws(() => module.accounts.create(ctx, { name: "X", accountType: "nope", currency: "EUR" }), ValidationError);
  assert.throws(() => module.accounts.create(ctx, { name: "X", accountType: "customer", currency: "EURO" }), ValidationError);

  const first = module.accounts.create(ctx, { name: "One", accountType: "prospect", currency: "EUR" });
  const second = module.accounts.create(ctx, { name: "Two", accountType: "customer", currency: "USD" });
  assert.equal(first.accountNumber, "ACC-00001");
  assert.equal(second.accountNumber, "ACC-00002");
  assert.equal(module.outbox.byType(AccountEventTypes.AccountCreated).length, 2);
});

test("accounts: prospect converts to customer exactly once", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const account = module.accounts.create(ctx, { name: "P", accountType: "prospect", currency: "EUR" });
  module.accounts.convertToCustomer(ctx, account.id);
  assert.equal(module.accounts.get(ctx, account.id).accountType, "customer");
  assert.throws(() => module.accounts.convertToCustomer(ctx, account.id), ConflictError);
  assert.equal(module.outbox.byType(AccountEventTypes.AccountConvertedToCustomer).length, 1);
});

test("accounts: credit hold lifecycle drives status", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const id = makeAccount(module, ctx);
  module.accounts.placeCreditHold(ctx, id, { reason: "invoices overdue" });
  const held = module.accounts.get(ctx, id);
  assert.equal(held.status, "on_hold");
  assert.equal(held.creditHold, true);
  assert.throws(() => module.accounts.placeCreditHold(ctx, id, { reason: "again" }), ConflictError);
  module.accounts.releaseCreditHold(ctx, id);
  assert.equal(module.accounts.get(ctx, id).status, "active");
  assert.throws(() => module.accounts.releaseCreditHold(ctx, id), ConflictError);
});

test("accounts: closed accounts are immutable", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const id = makeAccount(module, ctx);
  module.accounts.close(ctx, id);
  assert.throws(() => module.accounts.update(ctx, id, { name: "New" }), ConflictError);
  assert.throws(() => module.accounts.changeCreditLimit(ctx, id, { creditLimitMinor: 1 }), ConflictError);
  assert.throws(() => module.accounts.close(ctx, id), ConflictError);
});

test("contacts: unique active email and single primary per account", () => {
  const { module } = makeModule();
  const ctx = repCtx();
  const id = makeAccount(module, ctx);
  const alice = module.accounts.addContact(ctx, id, {
    firstName: "Alice",
    lastName: "A",
    email: "alice@x.example",
    isPrimary: true,
  });
  assert.throws(
    () => module.accounts.addContact(ctx, id, { firstName: "Dup", lastName: "D", email: "ALICE@x.example" }),
    ConflictError,
  );
  const bob = module.accounts.addContact(ctx, id, {
    firstName: "Bob",
    lastName: "B",
    email: "bob@x.example",
    isPrimary: true,
  });
  const contacts = module.accounts.listContacts(ctx, id);
  assert.equal(contacts.filter((c) => c.isPrimary).length, 1);
  assert.equal(contacts.find((c) => c.isPrimary)?.id, bob.id);

  module.accounts.deactivateContact(ctx, id, alice.id);
  // Email freed after deactivation.
  module.accounts.addContact(ctx, id, { firstName: "Alice2", lastName: "A", email: "alice@x.example" });
});

test("tenant isolation: aggregates are invisible across tenants", () => {
  const { module } = makeModule();
  const ctxA = createTenantContext("tenant-a", "u1", ["sales_rep"]);
  const ctxB = createTenantContext("tenant-b", "u2", ["sales_rep"]);
  const id = makeAccount(module, ctxA);
  assert.throws(() => module.accounts.get(ctxB, id), NotFoundError);
  assert.equal(module.accounts.list(ctxB).total, 0);
});
