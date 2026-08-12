import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapTenant, postSimpleJournal } from "./support/fixture.js";

async function seedItCosts(fixture: Awaited<ReturnType<typeof bootstrapTenant>>, amountMinor: number) {
  // Book IT infrastructure cost onto the central IT cost center.
  await postSimpleJournal(fixture, {
    date: "2026-01-08",
    amountMinor,
    debitCode: "5200",
    creditCode: "1000",
    debitCostCenter: "IT",
    memo: "Central IT spend",
  });
}

test("allocation run redistributes IT cost 50/30/20 across cost centers via a posted journal", async () => {
  const fixture = await bootstrapTenant();
  const { allocations, journals } = fixture.app.services;
  await seedItCosts(fixture, 100_000);

  const rule = await allocations.createRule(fixture.ctx, {
    name: "IT recharge",
    sourceAccountCode: "5200",
    sourceCostCenterCode: "IT",
    targets: [
      { costCenterCode: "OPS", percentBps: 5000 },
      { costCenterCode: "ENG", percentBps: 3000 },
      { costCenterCode: "SALES", percentBps: 2000 },
    ],
  });

  const result = await allocations.runRule(fixture.ctx, rule.id, "2026-01");
  assert.equal(result.skipped, false);
  assert.equal(result.sourceAmountMinor, 100_000);
  assert.deepEqual(result.splits, [
    { costCenterCode: "OPS", amountMinor: 50_000 },
    { costCenterCode: "ENG", amountMinor: 30_000 },
    { costCenterCode: "SALES", amountMinor: 20_000 },
  ]);

  const journal = await journals.getJournal(
    fixture.ctx,
    (result.journal as { id: string }).id as never,
  );
  assert.equal(journal.source, "ALLOCATION");
  assert.equal(journal.status, "POSTED");
  assert.equal(journal.lines.length, 4, "1 credit out + 3 debits in");
  assert.equal(journal.totalDebitMinor(), 100_000);

  const events = fixture.app.outbox.list(fixture.ctx.tenantId, "finance.allocation.executed");
  assert.equal(events.length, 1);
});

test("odd amounts allocate exactly, remainder on last target", async () => {
  const fixture = await bootstrapTenant();
  const { allocations } = fixture.app.services;
  await seedItCosts(fixture, 100_001);

  const rule = await allocations.createRule(fixture.ctx, {
    name: "IT recharge thirds",
    sourceAccountCode: "5200",
    sourceCostCenterCode: "IT",
    targets: [
      { costCenterCode: "OPS", percentBps: 3333 },
      { costCenterCode: "ENG", percentBps: 3333 },
      { costCenterCode: "SALES", percentBps: 3334 },
    ],
  });
  const result = await allocations.runRule(fixture.ctx, rule.id, "2026-01");
  const total = result.splits.reduce((s, part) => s + part.amountMinor, 0);
  assert.equal(total, 100_001, "no cent lost or invented");
  assert.deepEqual(result.splits.map((s) => s.amountMinor), [33_330, 33_330, 33_341]);
});

test("a second run right after allocation finds nothing left and skips", async () => {
  const fixture = await bootstrapTenant();
  const { allocations } = fixture.app.services;
  await seedItCosts(fixture, 60_000);

  const rule = await allocations.createRule(fixture.ctx, {
    name: "IT recharge",
    sourceAccountCode: "5200",
    sourceCostCenterCode: "IT",
    targets: [
      { costCenterCode: "OPS", percentBps: 5000 },
      { costCenterCode: "ENG", percentBps: 5000 },
    ],
  });

  const first = await allocations.runRule(fixture.ctx, rule.id, "2026-01");
  assert.equal(first.skipped, false);

  const second = await allocations.runRule(fixture.ctx, rule.id, "2026-01");
  assert.equal(second.skipped, true);
  assert.equal(second.sourceAmountMinor, 0);
  assert.equal(second.journal, undefined);
});

test("rules only allocate EXPENSE accounts and validate cost centers", async () => {
  const fixture = await bootstrapTenant();
  const { allocations } = fixture.app.services;

  await assert.rejects(
    allocations.createRule(fixture.ctx, {
      name: "bad source",
      sourceAccountCode: "1000",
      sourceCostCenterCode: "IT",
      targets: [{ costCenterCode: "OPS", percentBps: 10_000 }],
    }),
    /only EXPENSE accounts/,
  );

  await assert.rejects(
    allocations.createRule(fixture.ctx, {
      name: "bad target",
      sourceAccountCode: "5200",
      sourceCostCenterCode: "IT",
      targets: [{ costCenterCode: "GHOST", percentBps: 10_000 }],
    }),
    /CostCenter not found/,
  );
});

test("allocations are allowed while a period is CLOSING but not once CLOSED", async () => {
  const fixture = await bootstrapTenant();
  const { allocations, periodClose } = fixture.app.services;
  await seedItCosts(fixture, 10_000);

  const rule = await allocations.createRule(fixture.ctx, {
    name: "IT recharge",
    sourceAccountCode: "5200",
    sourceCostCenterCode: "IT",
    targets: [{ costCenterCode: "OPS", percentBps: 10_000 }],
  });

  await periodClose.beginClose(fixture.ctx, "2026-01");
  const duringClose = await allocations.runRule(fixture.ctx, rule.id, "2026-01");
  assert.equal(duringClose.skipped, false, "soft close still allows ALLOCATION source");

  await periodClose.completeClose(fixture.ctx, "2026-01");
  await assert.rejects(
    allocations.runRule(fixture.ctx, rule.id, "2026-01"),
    /CLOSED/,
  );
});
