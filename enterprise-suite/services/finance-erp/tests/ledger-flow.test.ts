import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { bootstrapTenant, postSimpleJournal } from "./support/fixture.js";

test("manual journal: draft resolves accounts by code and posting emits an event", async () => {
  const fixture = await bootstrapTenant();
  const { journals } = fixture.app.services;

  const draft = await journals.createDraft(fixture.ctx, {
    journalDate: "2026-01-15",
    currency: "EUR",
    memo: "Owner funding",
    lines: [
      { accountCode: "1000", debitMinor: 1_000_000 },
      { accountCode: "3000", creditMinor: 1_000_000 },
    ],
  });
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.periodCode, "2026-01");
  assert.equal(draft.journalNo, "JRN-000001");

  const posted = await journals.post(fixture.ctx, draft.id);
  assert.equal(posted.status, "POSTED");

  const events = fixture.app.outbox.list(fixture.ctx.tenantId, "finance.journal.posted");
  assert.equal(events.length, 1);
});

test("journal dated outside any period is rejected", async () => {
  const fixture = await bootstrapTenant();
  await assert.rejects(
    fixture.app.services.journals.createDraft(fixture.ctx, {
      journalDate: "2031-01-15",
      currency: "EUR",
      lines: [
        { accountCode: "1000", debitMinor: 100 },
        { accountCode: "3000", creditMinor: 100 },
      ],
    }),
    (e: Error) => e instanceof DomainError && e.status === 404,
  );
});

test("posting to unknown or non-postable accounts is rejected", async () => {
  const fixture = await bootstrapTenant();
  const { journals, accounts } = fixture.app.services;

  await assert.rejects(
    journals.createDraft(fixture.ctx, {
      journalDate: "2026-01-15",
      currency: "EUR",
      lines: [
        { accountCode: "9999", debitMinor: 100 },
        { accountCode: "3000", creditMinor: 100 },
      ],
    }),
    /Account not found/,
  );

  const cash = await accounts.getAccountByCode(fixture.ctx, "1000");
  await accounts.deactivateAccount(fixture.ctx, cash.id);
  await assert.rejects(
    journals.createDraft(fixture.ctx, {
      journalDate: "2026-01-15",
      currency: "EUR",
      lines: [
        { accountCode: "1000", debitMinor: 100 },
        { accountCode: "3000", creditMinor: 100 },
      ],
    }),
    /not postable or inactive/,
  );
});

test("currency mismatch between journal and account is rejected", async () => {
  const fixture = await bootstrapTenant();
  await assert.rejects(
    fixture.app.services.journals.createDraft(fixture.ctx, {
      journalDate: "2026-01-15",
      currency: "USD",
      lines: [
        { accountCode: "1000", debitMinor: 100 },
        { accountCode: "3000", creditMinor: 100 },
      ],
    }),
    /denominated in EUR/,
  );
});

test("unknown cost center on a line is rejected, valid one is resolved", async () => {
  const fixture = await bootstrapTenant();
  const { journals } = fixture.app.services;

  await assert.rejects(
    journals.createDraft(fixture.ctx, {
      journalDate: "2026-01-15",
      currency: "EUR",
      lines: [
        { accountCode: "5000", debitMinor: 100, costCenterCode: "NOPE" },
        { accountCode: "1000", creditMinor: 100 },
      ],
    }),
    /CostCenter not found/,
  );

  const draft = await journals.createDraft(fixture.ctx, {
    journalDate: "2026-01-15",
    currency: "EUR",
    lines: [
      { accountCode: "5000", debitMinor: 100, costCenterCode: "OPS" },
      { accountCode: "1000", creditMinor: 100 },
    ],
  });
  assert.ok(draft.lines[0].costCenterId, "cost center id resolved from code");
});

test("service-level reversal posts a mirror journal and nets the ledger to zero", async () => {
  const fixture = await bootstrapTenant();
  const { journals, trialBalance } = fixture.app.services;

  const journal = await postSimpleJournal(fixture, {
    date: "2026-02-10",
    amountMinor: 42_000,
    debitCode: "5100",
    creditCode: "1000",
  });
  const { original, reversal } = await journals.reverse(fixture.ctx, journal.id, {
    reversalDate: "2026-02-11",
    memo: "entered in error",
  });
  assert.equal(original.status, "REVERSED");
  assert.equal(reversal.status, "POSTED");
  assert.equal(reversal.source, original.source);

  const tb = await trialBalance.compute(fixture.ctx, { periodCode: "2026-02" });
  assert.ok(tb.balanced);
  const rent = tb.rows.find((r) => r.accountCode === "5100");
  assert.ok(rent);
  assert.equal(rent.debitMinor, 42_000);
  assert.equal(rent.creditMinor, 42_000);
  assert.equal(rent.netMinor, 0);
});

test("tenants are fully isolated", async () => {
  const fixtureA = await bootstrapTenant("tenant-a");
  const journal = await postSimpleJournal(fixtureA, {
    date: "2026-01-10",
    amountMinor: 500,
    debitCode: "1000",
    creditCode: "3000",
  });

  const fixtureB = await bootstrapTenant("tenant-b");
  // Same app instance isolation: use tenant-b context against tenant-a's app.
  await assert.rejects(
    fixtureA.app.services.journals.getJournal(fixtureB.ctx, journal.id),
    /Journal not found/,
  );
});
