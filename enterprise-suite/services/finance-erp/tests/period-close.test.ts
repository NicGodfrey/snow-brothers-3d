import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapTenant, postSimpleJournal } from "./support/fixture.js";

test("full close workflow: begin -> checks pass -> complete -> period CLOSED", async () => {
  const fixture = await bootstrapTenant();
  const { periodClose, periods, journals } = fixture.app.services;

  await postSimpleJournal(fixture, {
    date: "2026-01-10", amountMinor: 80_000, debitCode: "1000", creditCode: "3000",
  });

  const run = await periodClose.beginClose(fixture.ctx, "2026-01");
  assert.equal(run.status, "READY", "clean period passes all checks immediately");
  assert.deepEqual(run.checks.map((c) => c.status), ["PASSED", "PASSED", "PASSED"]);

  const period = await periods.getPeriod(fixture.ctx, "2026-01");
  assert.equal(period.status, "CLOSING");

  // Soft close: manual postings are now blocked.
  const draft = await journals.createDraft(fixture.ctx, {
    journalDate: "2026-01-28",
    currency: "EUR",
    lines: [
      { accountCode: "5000", debitMinor: 10 },
      { accountCode: "1000", creditMinor: 10 },
    ],
  });
  await assert.rejects(journals.post(fixture.ctx, draft.id), /does not accept MANUAL/);

  // The stray draft now blocks completion until it is dealt with.
  const blocked = await periodClose.runChecks(fixture.ctx, "2026-01");
  assert.equal(blocked.status, "IN_PROGRESS");
  await assert.rejects(periodClose.completeClose(fixture.ctx, "2026-01"), /not READY/);

  // Cancel, post the journal properly, close again.
  await periodClose.cancelClose(fixture.ctx, "2026-01");
  await journals.post(fixture.ctx, draft.id);
  await periodClose.beginClose(fixture.ctx, "2026-01");
  const completed = await periodClose.completeClose(fixture.ctx, "2026-01");
  assert.equal(completed.periodStatus, "CLOSED");
  assert.equal(completed.run.status, "COMPLETED");

  const closedEvents = fixture.app.outbox.list(fixture.ctx.tenantId, "finance.period.closed");
  assert.equal(closedEvents.length, 1);
  const payload = closedEvents[0].payload as { totalDebitMinor: number; journalCount: number };
  assert.equal(payload.totalDebitMinor, 80_010);
  assert.equal(payload.journalCount, 2);
});

test("closed periods reject postings entirely", async () => {
  const fixture = await bootstrapTenant();
  const { periodClose, journals } = fixture.app.services;

  await periodClose.beginClose(fixture.ctx, "2026-01");
  await periodClose.completeClose(fixture.ctx, "2026-01");

  const draft = await journals.createDraft(fixture.ctx, {
    journalDate: "2026-01-15",
    currency: "EUR",
    lines: [
      { accountCode: "1000", debitMinor: 100 },
      { accountCode: "3000", creditMinor: 100 },
    ],
  });
  await assert.rejects(journals.post(fixture.ctx, draft.id), /CLOSED/);
});

test("draft AR invoices in the period block the subledger check", async () => {
  const fixture = await bootstrapTenant();
  const { ar, periodClose } = fixture.app.services;

  await ar.createInvoice(fixture.ctx, {
    customerId: "c1",
    customerName: "C1",
    currency: "EUR",
    issueDate: "2026-02-10",
    dueDate: "2026-03-12",
    lines: [{
      description: "unissued", quantityMilli: 1000, unitPriceMinor: 1000, revenueAccountCode: "4000",
    }],
  });

  const run = await periodClose.beginClose(fixture.ctx, "2026-02");
  const subledgerCheck = run.checks.find((c) => c.code === "subledgers-settled")!;
  assert.equal(subledgerCheck.status, "FAILED");
  assert.match(subledgerCheck.detail!, /INV-000001 is DRAFT/);
  await assert.rejects(periodClose.completeClose(fixture.ctx, "2026-02"), /not READY/);
});

test("reopen requires a reason and emits an event; second close works", async () => {
  const fixture = await bootstrapTenant();
  const { periodClose, periods } = fixture.app.services;

  await periodClose.beginClose(fixture.ctx, "2026-03");
  await periodClose.completeClose(fixture.ctx, "2026-03");
  assert.equal((await periods.getPeriod(fixture.ctx, "2026-03")).status, "CLOSED");

  await assert.rejects(periodClose.reopen(fixture.ctx, "2026-03", "  "), /reason is required/);
  await periodClose.reopen(fixture.ctx, "2026-03", "auditor adjustment");
  assert.equal((await periods.getPeriod(fixture.ctx, "2026-03")).status, "OPEN");
  assert.equal(fixture.app.outbox.list(fixture.ctx.tenantId, "finance.period.reopened").length, 1);

  await periodClose.beginClose(fixture.ctx, "2026-03");
  const second = await periodClose.completeClose(fixture.ctx, "2026-03");
  assert.equal(second.periodStatus, "CLOSED");
});

test("beginning a close twice is a conflict; only OPEN periods can begin", async () => {
  const fixture = await bootstrapTenant();
  const { periodClose } = fixture.app.services;

  await periodClose.beginClose(fixture.ctx, "2026-04");
  await assert.rejects(periodClose.beginClose(fixture.ctx, "2026-04"), /already active|only OPEN/);

  await periodClose.completeClose(fixture.ctx, "2026-04");
  await assert.rejects(periodClose.beginClose(fixture.ctx, "2026-04"), /only OPEN/);
});

test("close status endpoint data includes active run and history", async () => {
  const fixture = await bootstrapTenant();
  const { periodClose } = fixture.app.services;

  await periodClose.beginClose(fixture.ctx, "2026-05");
  const during = await periodClose.getCloseStatus(fixture.ctx, "2026-05");
  assert.equal(during.periodStatus, "CLOSING");
  assert.ok(during.activeRun);

  await periodClose.completeClose(fixture.ctx, "2026-05");
  const after = await periodClose.getCloseStatus(fixture.ctx, "2026-05");
  assert.equal(after.periodStatus, "CLOSED");
  assert.equal(after.activeRun, undefined);
  assert.equal(after.history.length, 1);
});
