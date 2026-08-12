import assert from "node:assert/strict";
import { test } from "node:test";
import { tenantId, type CurrencyCode } from "@enterprise-suite/shared-kernel";
import { ApBill } from "../src/domain/ap-bill.js";
import { ArInvoice } from "../src/domain/ar-invoice.js";
import { ArPayment } from "../src/domain/ar-payment.js";
import { newAccountId, newArInvoiceId, newJournalId } from "../src/domain/ids.js";

const TENANT = tenantId("t-subledger");
const EUR = "EUR" as CurrencyCode;
const revenueAccount = newAccountId();
const expenseAccount = newAccountId();

function makeInvoice(lines?: Parameters<typeof ArInvoice.create>[1]["lines"]) {
  return ArInvoice.create(TENANT, {
    invoiceNo: "INV-000001",
    customerId: "cust-42",
    customerName: "Globex GmbH",
    currency: EUR,
    issueDate: "2026-02-10",
    dueDate: "2026-03-12",
    lines: lines ?? [
      {
        description: "Consulting",
        quantityMilli: 2_500,          // 2.5 days
        unitPriceMinor: 100_000,       // 1000.00/day
        revenueAccountId: revenueAccount,
        taxRateBps: 2000,
      },
    ],
  });
}

test("invoice line math: qty milli x unit price with tax in minor units", () => {
  const result = makeInvoice();
  assert.ok(result.ok);
  const invoice = result.value;
  assert.equal(invoice.subtotalMinor, 250_000);   // 2.5 * 1000.00
  assert.equal(invoice.taxTotalMinor, 50_000);    // 20%
  assert.equal(invoice.totalMinor, 300_000);
  assert.equal(invoice.balanceMinor(), 300_000);
  assert.equal(invoice.status, "DRAFT");
});

test("fractional quantities round the subtotal to integer minors", () => {
  const result = makeInvoice([
    {
      description: "Odd quantity",
      quantityMilli: 333,              // 0.333 units
      unitPriceMinor: 999,             // 9.99
      revenueAccountId: revenueAccount,
    },
  ]);
  assert.ok(result.ok);
  // 333 * 999 / 1000 = 332.667 -> 333
  assert.equal(result.value.subtotalMinor, 333);
  assert.equal(result.value.taxTotalMinor, 0);
});

test("invoice payment lifecycle: ISSUED -> PARTIALLY_PAID -> PAID, overpay rejected", () => {
  const invoice = (makeInvoice() as { ok: true; value: ArInvoice }).value;

  const early = invoice.applyPayment(1000);
  assert.ok(!early.ok, "draft invoices cannot take payments");

  assert.ok(invoice.issue(newJournalId()).ok);
  assert.equal(invoice.status, "ISSUED");

  assert.ok(invoice.applyPayment(100_000).ok);
  assert.equal(invoice.status, "PARTIALLY_PAID");
  assert.equal(invoice.balanceMinor(), 200_000);

  const over = invoice.applyPayment(300_000);
  assert.ok(!over.ok);
  assert.match(over.error, /exceeds open balance/);

  assert.ok(invoice.applyPayment(200_000).ok);
  assert.equal(invoice.status, "PAID");
  assert.equal(invoice.balanceMinor(), 0);

  const events = invoice.pullEvents();
  assert.deepEqual(events.map((e) => e.eventType), [
    "finance.ar.invoice-issued",
    "finance.ar.invoice-paid",
  ]);
});

test("an invoice with applied payments cannot be voided", () => {
  const invoice = (makeInvoice() as { ok: true; value: ArInvoice }).value;
  invoice.issue(newJournalId());
  invoice.applyPayment(1);
  const voided = invoice.voidInvoice("duplicate");
  assert.ok(!voided.ok);
  assert.match(voided.error, /PARTIALLY_PAID and cannot be voided/);
});

test("payment applications never exceed the received amount", () => {
  const payment = (ArPayment.receive(TENANT, {
    paymentNo: "RCPT-000001",
    customerId: "cust-42",
    currency: EUR,
    amountMinor: 50_000,
    receivedDate: "2026-02-20",
    method: "BANK_TRANSFER",
  }) as { ok: true; value: ArPayment }).value;

  assert.equal(payment.status, "RECEIVED");
  assert.ok(payment.apply(newArInvoiceId(), 30_000).ok);
  assert.equal(payment.status, "PARTIALLY_APPLIED");
  assert.equal(payment.unappliedMinor(), 20_000);

  const tooMuch = payment.apply(newArInvoiceId(), 20_001);
  assert.ok(!tooMuch.ok);
  assert.match(tooMuch.error, /exceeds unapplied funds/);

  assert.ok(payment.apply(newArInvoiceId(), 20_000).ok);
  assert.equal(payment.status, "APPLIED");
  assert.equal(payment.unappliedMinor(), 0);
});

test("ap bill mirrors invoice behaviour with APPROVED status", () => {
  const result = ApBill.create(TENANT, {
    billNo: "BILL-000001",
    supplierId: "sup-7",
    supplierName: "Initech Ltd",
    currency: EUR,
    billDate: "2026-02-05",
    dueDate: "2026-03-07",
    lines: [
      {
        description: "Cloud hosting",
        quantityMilli: 1000,
        unitCostMinor: 80_000,
        expenseAccountId: expenseAccount,
        taxRateBps: 2000,
      },
    ],
  });
  assert.ok(result.ok);
  const bill = result.value;
  assert.equal(bill.totalMinor, 96_000);

  assert.ok(bill.approve(newJournalId()).ok);
  assert.equal(bill.status, "APPROVED");

  assert.ok(bill.applyPayment(96_000).ok);
  assert.equal(bill.status, "PAID");

  const events = bill.pullEvents();
  assert.deepEqual(events.map((e) => e.eventType), [
    "finance.ap.bill-approved",
    "finance.ap.bill-paid",
  ]);
});

test("due date cannot precede issue/bill date", () => {
  const invoice = ArInvoice.create(TENANT, {
    invoiceNo: "INV-000002",
    customerId: "cust-1",
    customerName: "X",
    currency: EUR,
    issueDate: "2026-02-10",
    dueDate: "2026-02-09",
    lines: [{
      description: "x", quantityMilli: 1000, unitPriceMinor: 100, revenueAccountId: revenueAccount,
    }],
  });
  assert.ok(!invoice.ok);
  assert.match(invoice.error, /dueDate cannot precede/);
});
