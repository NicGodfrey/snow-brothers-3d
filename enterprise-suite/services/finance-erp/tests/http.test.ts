import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startServer, type RunningServer } from "../src/http/server.js";

let running: RunningServer;
let baseUrl: string;

const headers = {
  "content-type": "application/json",
  "x-tenant-id": "http-tenant",
  "x-user-id": "user-http",
  "x-roles": "finance-admin",
};

async function call(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  running = await startServer(0);
  baseUrl = `http://127.0.0.1:${running.port}`;
});

after(async () => {
  await running.close();
});

test("health endpoint responds without auth context", async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { "x-tenant-id": "t", "x-user-id": "u" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "finance-erp" });
});

test("missing tenant headers yield 401", async () => {
  const response = await fetch(`${baseUrl}/accounts`);
  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "UNAUTHENTICATED");
});

test("unknown routes yield 404, malformed JSON yields 400", async () => {
  const missing = await call("GET", "/nope");
  assert.equal(missing.status, 404);

  const badJson = await fetch(`${baseUrl}/accounts`, {
    method: "POST",
    headers,
    body: "{not json",
  });
  assert.equal(badJson.status, 400);
  const body = (await badJson.json()) as { error: string };
  assert.equal(body.error, "BAD_JSON");
});

test("end-to-end over HTTP: chart of accounts -> settings -> periods -> journal -> trial balance", async () => {
  const accounts: [string, string, string][] = [
    ["1000", "Cash", "ASSET"],
    ["1100", "AR", "ASSET"],
    ["1200", "Purchase Tax", "ASSET"],
    ["2000", "AP", "LIABILITY"],
    ["2100", "Sales Tax", "LIABILITY"],
    ["3000", "Capital", "EQUITY"],
    ["4000", "Revenue", "REVENUE"],
    ["5000", "Opex", "EXPENSE"],
  ];
  for (const [code, name, type] of accounts) {
    const created = await call("POST", "/accounts", { code, name, type, currency: "EUR" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }

  const duplicate = await call("POST", "/accounts", {
    code: "1000", name: "Cash again", type: "ASSET", currency: "EUR",
  });
  assert.equal(duplicate.status, 409);

  const settings = await call("POST", "/settings/ledger", {
    baseCurrency: "EUR",
    arControlAccountCode: "1100",
    apControlAccountCode: "2000",
    cashAccountCode: "1000",
    salesTaxPayableAccountCode: "2100",
    purchaseTaxReceivableAccountCode: "1200",
  });
  assert.equal(settings.status, 201);

  const periods = await call("POST", "/periods/calendar-year", { fiscalYear: 2026 });
  assert.equal(periods.status, 201);
  assert.equal((periods.body as unknown[]).length, 12);

  const unbalanced = await call("POST", "/journals", {
    journalDate: "2026-01-10",
    currency: "EUR",
    lines: [
      { accountCode: "1000", debitMinor: 100 },
      { accountCode: "3000", creditMinor: 99 },
    ],
  });
  assert.equal(unbalanced.status, 422);
  assert.match((unbalanced.body as { message: string }).message, /unbalanced/);

  const draft = await call("POST", "/journals", {
    journalDate: "2026-01-10",
    currency: "EUR",
    memo: "Seed capital",
    lines: [
      { accountCode: "1000", debitMinor: 250_000 },
      { accountCode: "3000", creditMinor: 250_000 },
    ],
  });
  assert.equal(draft.status, 201);
  const journalId = (draft.body as { id: string }).id;

  const posted = await call("POST", `/journals/${journalId}/post`);
  assert.equal(posted.status, 200);
  assert.equal((posted.body as { status: string }).status, "POSTED");

  const tb = await call("GET", "/reports/trial-balance?period=2026-01");
  assert.equal(tb.status, 200);
  const report = tb.body as {
    balanced: boolean;
    totalDebitMinor: number;
    rows: { accountCode: string; balanceMinor: number }[];
  };
  assert.ok(report.balanced);
  assert.equal(report.totalDebitMinor, 250_000);
  assert.equal(report.rows.find((r) => r.accountCode === "1000")?.balanceMinor, 250_000);

  const missingParam = await call("GET", "/reports/trial-balance");
  assert.equal(missingParam.status, 400);
});

test("AR invoice lifecycle over HTTP including close workflow", async () => {
  const invoice = await call("POST", "/ar/invoices", {
    customerId: "cust-http",
    customerName: "HTTP GmbH",
    currency: "EUR",
    issueDate: "2026-02-05",
    dueDate: "2026-03-07",
    lines: [{
      description: "API access",
      quantityMilli: 1000,
      unitPriceMinor: 120_000,
      revenueAccountCode: "4000",
    }],
  });
  assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
  const invoiceId = (invoice.body as { id: string }).id;

  const issued = await call("POST", `/ar/invoices/${invoiceId}/issue`);
  assert.equal(issued.status, 200);

  const payment = await call("POST", "/ar/payments", {
    customerId: "cust-http",
    currency: "EUR",
    amountMinor: 120_000,
    receivedDate: "2026-02-20",
    method: "BANK_TRANSFER",
    applications: [{ invoiceId, amountMinor: 120_000 }],
  });
  assert.equal(payment.status, 201);
  assert.equal((payment.body as { status: string }).status, "APPLIED");

  const paidInvoice = await call("GET", `/ar/invoices/${invoiceId}`);
  assert.equal((paidInvoice.body as { status: string }).status, "PAID");

  const begin = await call("POST", "/periods/2026-02/close/begin");
  assert.equal(begin.status, 200, JSON.stringify(begin.body));
  assert.equal((begin.body as { status: string }).status, "READY");

  const complete = await call("POST", "/periods/2026-02/close/complete");
  assert.equal(complete.status, 200);
  assert.equal((complete.body as { periodStatus: string }).periodStatus, "CLOSED");

  const closeStatus = await call("GET", "/periods/2026-02/close-status");
  assert.equal((closeStatus.body as { periodStatus: string }).periodStatus, "CLOSED");

  const events = await call("GET", "/events?type=finance.period.closed");
  assert.equal((events.body as unknown[]).length, 1);
});

test("tenant isolation over HTTP: another tenant sees nothing", async () => {
  const otherTenant = await call("GET", "/accounts", undefined, { "x-tenant-id": "someone-else" });
  assert.equal(otherTenant.status, 200);
  assert.equal((otherTenant.body as { total: number }).total, 0);
});

test("fx rates and cost centers round-trip over HTTP", async () => {
  const rate = await call("POST", "/fx-rates", {
    baseCurrency: "EUR", quoteCurrency: "USD", rateMicros: 1_090_000, asOfDate: "2026-02-01",
  });
  assert.equal(rate.status, 201);

  const lookup = await call("GET", "/fx-rates?base=EUR&quote=USD&date=2026-02-15");
  assert.equal(lookup.status, 200);
  assert.equal((lookup.body as { rateMicros: number }).rateMicros, 1_090_000);

  const costCenter = await call("POST", "/cost-centers", { code: "hq", name: "Headquarters" });
  assert.equal(costCenter.status, 201);
  assert.equal((costCenter.body as { code: string }).code, "HQ");

  const list = await call("GET", "/cost-centers");
  assert.equal((list.body as unknown[]).length, 1);
});
