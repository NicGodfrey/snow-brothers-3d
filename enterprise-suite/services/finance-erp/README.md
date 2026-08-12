# @enterprise-suite/finance-erp

Finance bounded context of the enterprise suite: general ledger, AR/AP subledgers,
cost accounting, tax & FX reference data, and the month-end close workflow.

All monetary amounts are **integer minor units** (`amountMinor`) with ISO currency
codes. Quantities on document lines are integer thousandths (`quantityMilli`,
`1000 = 1 unit`), tax rates are basis points (`rateBps`, `10000 = 100%`), and FX
rates are stored as micros (`rateMicros`, `1_000_000 = 1.0`). No floats touch the
ledger.

## Capabilities

| Area | What it does |
|------|--------------|
| Chart of accounts | Typed accounts (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE) with derived normal balance, summary vs postable accounts, activate/deactivate |
| Journals | Double-entry journals with per-line debit XOR credit, balance enforcement, DRAFT → POSTED → REVERSED lifecycle, cross-linked reversals |
| Posting periods | `YYYY-PP` periods (13 = year-end adjustments), OPEN → CLOSING → CLOSED, soft close allows ALLOCATION/CLOSING sources only |
| Period close | Checklist workflow (`PeriodCloseRun`): no draft journals, subledgers settled, trial balance balanced; complete re-verifies against live state; reopen requires an audit reason |
| AR | Customer invoices (tax-aware line math) issued to the GL (DR AR control / CR revenue / CR tax payable), payments with applications, void-with-reversal, open balances by customer |
| AP | Supplier bills approved to the GL (DR expense + recoverable tax / CR AP control), payments (DR AP / CR cash), open balances by supplier |
| Cost centers | Analytic dimension on journal and document lines |
| Allocations | Rules split net period cost of one (expense account, cost center) across targets by basis points; integer-exact splits, remainder on last target; executed as an ALLOCATION journal |
| Tax codes | Rate reference data (scope SALES/PURCHASE/BOTH) applied on AR/AP lines |
| FX rates | Store-only reference data with latest-on-or-before-date lookup; journals stay single-currency |
| Trial balance | Computed directly from posted journals (PERIOD or CUMULATIVE basis); debits always equal credits |

## Layout

```
src/
  domain/            aggregates: Account, Journal, PostingPeriod, PeriodCloseRun,
                     ArInvoice, ArPayment, ApBill, ApPayment, CostCenter,
                     AllocationRule, TaxCode, FxRate (+ event catalog)
  application/       services orchestrating repos + outbox: JournalService (posting
                     engine), PeriodCloseService, ArService, ApService,
                     AllocationService, TrialBalanceService, ...
  infrastructure/    repository ports, in-memory adapters, event outbox
  http/              dependency-free router, tenant-context extraction, route
                     registration (app.ts), node:http server
migrations/          Postgres DDL: accounts, cost centers, periods + close runs,
                     journals + lines + doc sequences, tax/fx, AR, AP,
                     allocations, ledger settings + event outbox
tests/               64 tests: domain rules, ledger flows, AR/AP end-to-end,
                     period close, allocations, trial balance, HTTP API
```

## HTTP API (headers: `x-tenant-id`, `x-user-id`, `x-roles`)

```
GET  /health
POST /settings/ledger                      control-account mapping (required before AR/AP)
POST /accounts                             GET /accounts[/:id]   POST /accounts/:id/(de|re)activate
POST /journals                             GET /journals[/:id]
POST /journals/:id/post                    POST /journals/:id/reverse
POST /periods | /periods/calendar-year     GET /periods[/:code]
POST /periods/:code/close/begin|run-checks|complete|cancel
POST /periods/:code/reopen                 GET /periods/:code/close-status
POST /ar/invoices                          POST /ar/invoices/:id/issue|void
POST /ar/payments                          POST /ar/payments/:id/apply
GET  /ar/invoices[/:id] /ar/payments /ar/open-balances
POST /ap/bills                             POST /ap/bills/:id/approve|void
POST /ap/payments                          POST /ap/payments/:id/apply
GET  /ap/bills[/:id] /ap/payments /ap/open-balances
POST /cost-centers                         GET /cost-centers[/:id]
POST /allocations/rules                    POST /allocations/rules/:id/run
POST /tax-codes                            GET /tax-codes[/:id]
POST /fx-rates                             GET /fx-rates?base=&quote=&date=
GET  /reports/trial-balance?period=YYYY-PP[&basis=CUMULATIVE]
GET  /events[?type=...]                    outbox inspection
```

Errors are JSON `{ error, message }` with domain-driven status codes
(401 missing identity, 404 not found, 409 conflict, 422 rule violation).

## Domain events

`finance.journal.posted|reversed`, `finance.period.opened|close-started|closed|reopened`,
`finance.ar.invoice-issued|invoice-paid|invoice-voided|payment-received`,
`finance.ap.bill-approved|bill-paid|bill-voided|payment-issued`,
`finance.allocation.executed`, `finance.account.created|deactivated`,
`finance.cost-center.created`, `finance.tax-code.created`, `finance.fx-rate.stored`
— all as shared-kernel `EventEnvelope`s through the in-memory outbox
(`GET /events`), ready for integration-hub draining.

## Run

```bash
npm run build --workspace @enterprise-suite/finance-erp
npm test    --workspace @enterprise-suite/finance-erp
npm start   --workspace @enterprise-suite/finance-erp   # PORT=4106 by default
```

## Invariants worth knowing

- A journal line carries a debit **xor** a credit; journals must balance to post.
- Posting requires the period to accept the journal's source; CLOSED periods are immutable until reopened with a reason.
- Voiding an issued invoice/bill reverses its GL journal; paid documents cannot be voided.
- Payment applications can never exceed the document's open balance or the payment's unapplied funds.
- Allocation splits are integer-exact: the last target absorbs rounding remainders.
- The trial balance is derived, never stored — it cannot drift from the journals.
