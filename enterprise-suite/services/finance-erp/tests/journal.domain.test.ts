import assert from "node:assert/strict";
import { test } from "node:test";
import { tenantId, userId, type CurrencyCode } from "@enterprise-suite/shared-kernel";
import { Journal, type CreateJournalInput } from "../src/domain/journal.js";
import { newAccountId } from "../src/domain/ids.js";

const TENANT = tenantId("t-journal");
const EUR = "EUR" as CurrencyCode;
const acctA = newAccountId();
const acctB = newAccountId();

function baseInput(overrides?: Partial<CreateJournalInput>): CreateJournalInput {
  return {
    journalNo: "JRN-000001",
    journalDate: "2026-03-15",
    periodCode: "2026-03",
    currency: EUR,
    lines: [
      { accountId: acctA, accountCode: "1000", debitMinor: 12_50 },
      { accountId: acctB, accountCode: "4000", creditMinor: 12_50 },
    ],
    ...overrides,
  };
}

test("balanced journal is created as DRAFT with numbered lines", () => {
  const result = Journal.create(TENANT, baseInput());
  assert.ok(result.ok);
  const journal = result.value;
  assert.equal(journal.status, "DRAFT");
  assert.equal(journal.lines.length, 2);
  assert.equal(journal.lines[0].lineNo, 1);
  assert.equal(journal.lines[1].lineNo, 2);
  assert.equal(journal.totalDebitMinor(), 1250);
  assert.equal(journal.totalCreditMinor(), 1250);
  assert.ok(journal.isBalanced());
});

test("unbalanced journal is rejected", () => {
  const result = Journal.create(TENANT, baseInput({
    lines: [
      { accountId: acctA, accountCode: "1000", debitMinor: 1000 },
      { accountId: acctB, accountCode: "4000", creditMinor: 999 },
    ],
  }));
  assert.ok(!result.ok);
  assert.match(result.error, /unbalanced/);
});

test("a line cannot carry both debit and credit", () => {
  const result = Journal.create(TENANT, baseInput({
    lines: [
      { accountId: acctA, accountCode: "1000", debitMinor: 500, creditMinor: 500 },
      { accountId: acctB, accountCode: "4000", creditMinor: 0 },
    ],
  }));
  assert.ok(!result.ok);
  assert.match(result.error, /cannot carry both/);
});

test("empty and single-line journals are rejected (double entry)", () => {
  const empty = Journal.create(TENANT, baseInput({ lines: [] }));
  assert.ok(!empty.ok);
  const single = Journal.create(TENANT, baseInput({
    lines: [{ accountId: acctA, accountCode: "1000", debitMinor: 100 }],
  }));
  assert.ok(!single.ok);
  assert.match(single.error, /at least two lines/);
});

test("non-integer and negative amounts are rejected", () => {
  const fractional = Journal.create(TENANT, baseInput({
    lines: [
      { accountId: acctA, accountCode: "1000", debitMinor: 10.5 },
      { accountId: acctB, accountCode: "4000", creditMinor: 10.5 },
    ],
  }));
  assert.ok(!fractional.ok);
  assert.match(fractional.error, /integer minor units/);

  const negative = Journal.create(TENANT, baseInput({
    lines: [
      { accountId: acctA, accountCode: "1000", debitMinor: -100 },
      { accountId: acctB, accountCode: "4000", creditMinor: -100 },
    ],
  }));
  assert.ok(!negative.ok);
  assert.match(negative.error, /non-negative/);
});

test("invalid journal date is rejected", () => {
  const result = Journal.create(TENANT, baseInput({ journalDate: "15/03/2026" }));
  assert.ok(!result.ok);
  assert.match(result.error, /ISO date/);
});

test("posting flips DRAFT to POSTED exactly once and raises an event", () => {
  const journal = (Journal.create(TENANT, baseInput()) as { ok: true; value: Journal }).value;
  const posted = journal.post(userId("u1"));
  assert.ok(posted.ok);
  assert.equal(journal.status, "POSTED");

  const events = journal.pullEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "finance.journal.posted");
  const payload = events[0].payload as { totalDebitMinor: number };
  assert.equal(payload.totalDebitMinor, 1250);

  const again = journal.post(userId("u1"));
  assert.ok(!again.ok);
  assert.match(again.error, /only DRAFT/);
});

test("reversal swaps debits and credits and cross-links both journals", () => {
  const journal = (Journal.create(TENANT, baseInput()) as { ok: true; value: Journal }).value;
  journal.post(userId("u1"));
  journal.pullEvents();

  const reversalResult = journal.buildReversal({
    journalNo: "JRN-000002",
    journalDate: "2026-03-20",
    periodCode: "2026-03",
  });
  assert.ok(reversalResult.ok);
  const reversal = reversalResult.value;

  assert.equal(journal.status, "REVERSED");
  assert.equal(journal.reversedById, reversal.id);
  assert.equal(reversal.reversalOfId, journal.id);
  assert.equal(reversal.status, "DRAFT");
  assert.equal(reversal.lines[0].creditMinor, 1250);
  assert.equal(reversal.lines[0].debitMinor, 0);
  assert.equal(reversal.lines[1].debitMinor, 1250);

  const events = journal.pullEvents();
  assert.equal(events[0].eventType, "finance.journal.reversed");
});

test("a draft journal cannot be reversed", () => {
  const journal = (Journal.create(TENANT, baseInput()) as { ok: true; value: Journal }).value;
  const result = journal.buildReversal({
    journalNo: "JRN-000002",
    journalDate: "2026-03-20",
    periodCode: "2026-03",
  });
  assert.ok(!result.ok);
  assert.match(result.error, /only POSTED/);
});
