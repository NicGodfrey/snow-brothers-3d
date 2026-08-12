import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapTenant } from "./support/fixture.js";

test("AR happy path: invoice with tax -> issue -> receive & apply payment -> PAID", async () => {
  const fixture = await bootstrapTenant();
  const { ar, journals, trialBalance } = fixture.app.services;

  const invoice = await ar.createInvoice(fixture.ctx, {
    customerId: "cust-globex",
    customerName: "Globex GmbH",
    currency: "EUR",
    issueDate: "2026-01-10",
    dueDate: "2026-02-09",
    lines: [
      {
        description: "License subscription",
        quantityMilli: 1000,
        unitPriceMinor: 500_000,
        revenueAccountCode: "4000",
        taxCode: "VAT20",
      },
      {
        description: "Onboarding services",
        quantityMilli: 3000,
        unitPriceMinor: 90_000,
        revenueAccountCode: "4100",
      },
    ],
  });
  assert.equal(invoice.invoiceNo, "INV-000001");
  assert.equal(invoice.subtotalMinor, 770_000);   // 500000 + 3*90000
  assert.equal(invoice.taxTotalMinor, 100_000);   // 20% on the licensed line only
  assert.equal(invoice.totalMinor, 870_000);

  const issued = await ar.issueInvoice(fixture.ctx, invoice.id);
  assert.equal(issued.status, "ISSUED");
  assert.ok(issued.journalId);

  const journal = await journals.getJournal(fixture.ctx, issued.journalId!);
  assert.equal(journal.status, "POSTED");
  assert.equal(journal.source, "AR");
  assert.equal(journal.totalDebitMinor(), 870_000);
  // DR AR control; CR 4000, CR 4100, CR tax payable
  assert.equal(journal.lines.length, 4);

  const payment = await ar.receivePayment(fixture.ctx, {
    customerId: "cust-globex",
    currency: "EUR",
    amountMinor: 870_000,
    receivedDate: "2026-01-25",
    method: "BANK_TRANSFER",
    applications: [{ invoiceId: invoice.id, amountMinor: 870_000 }],
  });
  assert.equal(payment.status, "APPLIED");

  const paidInvoice = await ar.getInvoice(fixture.ctx, invoice.id);
  assert.equal(paidInvoice.status, "PAID");

  const tb = await trialBalance.compute(fixture.ctx, { periodCode: "2026-01" });
  assert.ok(tb.balanced);
  const arControl = tb.rows.find((r) => r.accountCode === "1100")!;
  assert.equal(arControl.netMinor, 0, "AR control fully relieved");
  const cash = tb.rows.find((r) => r.accountCode === "1000")!;
  assert.equal(cash.netMinor, 870_000);
  const taxPayable = tb.rows.find((r) => r.accountCode === "2100")!;
  assert.equal(taxPayable.balanceMinor, 100_000);

  const openBalances = await ar.openBalanceByCustomer(fixture.ctx);
  assert.equal(openBalances.length, 0);
});

test("AR guards: non-revenue account, wrong customer application, currency mismatch", async () => {
  const fixture = await bootstrapTenant();
  const { ar } = fixture.app.services;

  await assert.rejects(
    ar.createInvoice(fixture.ctx, {
      customerId: "c1",
      customerName: "C1",
      currency: "EUR",
      issueDate: "2026-01-10",
      dueDate: "2026-01-20",
      lines: [{
        description: "bad line", quantityMilli: 1000, unitPriceMinor: 100,
        revenueAccountCode: "1000",
      }],
    }),
    /must post to REVENUE/,
  );

  const invoice = await ar.createInvoice(fixture.ctx, {
    customerId: "c1",
    customerName: "C1",
    currency: "EUR",
    issueDate: "2026-01-10",
    dueDate: "2026-01-20",
    lines: [{
      description: "ok", quantityMilli: 1000, unitPriceMinor: 10_000, revenueAccountCode: "4000",
    }],
  });
  await ar.issueInvoice(fixture.ctx, invoice.id);

  const payment = await ar.receivePayment(fixture.ctx, {
    customerId: "someone-else",
    currency: "EUR",
    amountMinor: 10_000,
    receivedDate: "2026-01-12",
    method: "CARD",
  });
  await assert.rejects(
    ar.applyPayment(fixture.ctx, payment.id, invoice.id, 10_000),
    /belongs to someone-else/,
  );
});

test("voiding an issued AR invoice reverses its journal", async () => {
  const fixture = await bootstrapTenant();
  const { ar, journals, trialBalance } = fixture.app.services;

  const invoice = await ar.createInvoice(fixture.ctx, {
    customerId: "c9",
    customerName: "C9",
    currency: "EUR",
    issueDate: "2026-02-05",
    dueDate: "2026-03-07",
    lines: [{
      description: "dup entry", quantityMilli: 1000, unitPriceMinor: 55_000, revenueAccountCode: "4000",
    }],
  });
  await ar.issueInvoice(fixture.ctx, invoice.id);
  const voided = await ar.voidInvoice(fixture.ctx, invoice.id, "duplicate booking");
  assert.equal(voided.status, "VOID");

  const arJournals = await journals.listJournals(fixture.ctx, { source: "AR" });
  assert.equal(arJournals.length, 2, "original + reversal");

  const tb = await trialBalance.compute(fixture.ctx, { periodCode: "2026-02" });
  const arControl = tb.rows.find((r) => r.accountCode === "1100")!;
  assert.equal(arControl.netMinor, 0);
  const revenue = tb.rows.find((r) => r.accountCode === "4000")!;
  assert.equal(revenue.netMinor, 0);
});

test("AP happy path: bill with recoverable tax -> approve -> pay -> PAID", async () => {
  const fixture = await bootstrapTenant();
  const { ap, journals, trialBalance } = fixture.app.services;

  const bill = await ap.createBill(fixture.ctx, {
    supplierId: "sup-initech",
    supplierName: "Initech Ltd",
    supplierInvoiceRef: "IT-2026-0042",
    currency: "EUR",
    billDate: "2026-01-08",
    dueDate: "2026-02-07",
    lines: [
      {
        description: "Cloud hosting January",
        quantityMilli: 1000,
        unitCostMinor: 200_000,
        expenseAccountCode: "5200",
        costCenterId: undefined,
        taxCode: "VAT20",
      },
    ],
  });
  assert.equal(bill.billNo, "BILL-000001");
  assert.equal(bill.totalMinor, 240_000);

  const approved = await ap.approveBill(fixture.ctx, bill.id);
  assert.equal(approved.status, "APPROVED");

  const journal = await journals.getJournal(fixture.ctx, approved.journalId!);
  assert.equal(journal.source, "AP");
  // DR expense 200000, DR tax receivable 40000, CR AP 240000
  assert.equal(journal.totalDebitMinor(), 240_000);
  assert.equal(journal.lines.length, 3);

  const payment = await ap.issuePayment(fixture.ctx, {
    supplierId: "sup-initech",
    currency: "EUR",
    amountMinor: 240_000,
    paymentDate: "2026-01-30",
    method: "BANK_TRANSFER",
    applications: [{ billId: bill.id, amountMinor: 240_000 }],
  });
  assert.equal(payment.status, "APPLIED");

  const paidBill = await ap.getBill(fixture.ctx, bill.id);
  assert.equal(paidBill.status, "PAID");

  const tb = await trialBalance.compute(fixture.ctx, { periodCode: "2026-01" });
  assert.ok(tb.balanced);
  const apControl = tb.rows.find((r) => r.accountCode === "2000")!;
  assert.equal(apControl.netMinor, 0, "AP control fully relieved");
  const expense = tb.rows.find((r) => r.accountCode === "5200")!;
  assert.equal(expense.balanceMinor, 200_000);
  const taxReceivable = tb.rows.find((r) => r.accountCode === "1200")!;
  assert.equal(taxReceivable.balanceMinor, 40_000);
  const cash = tb.rows.find((r) => r.accountCode === "1000")!;
  assert.equal(cash.netMinor, -240_000);

  const openBalances = await ap.openBalanceBySupplier(fixture.ctx);
  assert.equal(openBalances.length, 0);
});

test("partial AP payments keep the bill PARTIALLY_PAID with correct open balance", async () => {
  const fixture = await bootstrapTenant();
  const { ap } = fixture.app.services;

  const bill = await ap.createBill(fixture.ctx, {
    supplierId: "sup-x",
    supplierName: "X Corp",
    currency: "EUR",
    billDate: "2026-03-01",
    dueDate: "2026-03-31",
    lines: [{
      description: "Rent Q1", quantityMilli: 1000, unitCostMinor: 90_000, expenseAccountCode: "5100",
    }],
  });
  await ap.approveBill(fixture.ctx, bill.id);
  await ap.issuePayment(fixture.ctx, {
    supplierId: "sup-x",
    currency: "EUR",
    amountMinor: 40_000,
    paymentDate: "2026-03-10",
    method: "BANK_TRANSFER",
    applications: [{ billId: bill.id, amountMinor: 40_000 }],
  });

  const partiallyPaid = await ap.getBill(fixture.ctx, bill.id);
  assert.equal(partiallyPaid.status, "PARTIALLY_PAID");
  assert.equal(partiallyPaid.balanceMinor(), 50_000);

  const open = await ap.openBalanceBySupplier(fixture.ctx);
  assert.deepEqual(open, [{ supplierId: "sup-x", openMinor: 50_000, billCount: 1 }]);
});

test("AR/AP require ledger settings to be configured", async () => {
  const fixture = await bootstrapTenant();
  // Fresh app without settings for a different tenant on same instance
  const { createTenantContext } = await import("@enterprise-suite/shared-kernel");
  const rawCtx = createTenantContext("unconfigured", "u1");
  await assert.rejects(
    fixture.app.services.ar.receivePayment(rawCtx, {
      customerId: "c",
      currency: "EUR",
      amountMinor: 1,
      receivedDate: "2026-01-01",
      method: "CASH",
    }),
    /ledger settings are not configured/,
  );
});
