# @enterprise-suite/procurement-srm

Source-to-pay for the buy side: the system of record for **what we asked for,
what we agreed to pay, what actually arrived, and whether the invoice is
entitled to be paid**. Owns purchase requisitions, the approval matrix, RFQs
and supplier quotes with weighted evaluation, purchase orders and change
orders, goods receipts with inspection and returns, the three-way match, and
blanket agreements that orders draw down against.

The organising idea is the **purchase order line**. Every downstream document
lands on it: a receipt adds received/accepted/rejected quantity, an approved
invoice adds invoiced quantity and value. Because the line carries its whole
history, the receipt tolerance check and the three-way match are local
decisions — no document needs to join back to its children to know whether the
next one is allowed. `accepted + rejected = received` and
`invoiced ≤ accepted` hold at all times, which is what makes the GR/IR accrual
a subtraction rather than a reconciliation.

Procurement deliberately stops at "approved for payment". Posting the AP entry,
scheduling the payment and remitting belong to finance-erp, which consumes
`procurement.invoice.approved_for_payment`.

## Domain model

| Concept | Shape | Key invariants |
| --- | --- | --- |
| **SupplierRecord** | Aggregate (local projection) | srm-core owns onboarding and compliance; this is procurement's answer to "may we transact today". `pending → active ⇄ blocked → inactive`; ordering requires `active` plus category approval plus the minimum order value; `syncFromMaster` is idempotent and never clobbers a local block. |
| **PurchaseRequisition** | Aggregate | `draft → pending_approval → approved → partially_ordered → ordered → closed`. Lines carry their own status and ordered quantity, so demand can be split across suppliers and the remainder stays visible; ordered quantity can never exceed requested; cancellation is refused once quantity is on order. |
| **ApprovalPolicy** / **ApprovalRequest** | Aggregates | Amount-banded rules per document type, each with an ordered chain of steps (role, named approvers, quorum, SLA, escalation role, self-approval flag). Rule selection prefers the most specific match — category and cost-centre filters beat a plain band. A rule with no steps auto-approves, which is how routine spend clears without a human. Chains run strictly in sequence; a rejection at any step ends the request. |
| **RequestForQuote** | Aggregate | `draft → issued → closed → awarded`. Issuing freezes the scope: later changes bump `revision` and append to the amendment log so invited suppliers can be re-notified. Sealed RFQs refuse evaluation until they close. Awards are per line, so one event can be split across suppliers. |
| **SupplierQuote** | Aggregate | `draft → submitted → shortlisted → accepted`, plus `rejected`/`withdrawn`/`expired`. One live quote per supplier per RFQ; revising returns it to draft and requires a fresh submit; an expired quote cannot be awarded. |
| **PurchaseOrder** | Aggregate | `draft → pending_approval → approved → issued → acknowledged → partially_received → received → closed`. Tolerances (over-receipt, price variance, revision re-approval) are **copied onto the order at creation**, so a later policy change cannot retroactively re-judge a receipt or an invoice. A change order that raises the value past the re-approval tolerance sends the order back through the chain and is reissued at the next revision. |
| **GoodsReceipt** | Aggregate | `draft → posted → reversed`. Posting is the only moment quantities touch the order, so a tolerance breach is caught in one place and a rejected post leaves nothing applied. Inspection moves quantity from accepted to rejected without changing what arrived; a return to vendor credits the line back after the fact. |
| **SupplierInvoice** | Aggregate | `registered → matched → approved_for_payment`, with `exception ⇄ on_hold` and `rejected`. Duplicate detection runs on a normalised supplier reference, not the printed string. Approval writes invoiced quantity back onto the order lines, so a second invoice for the same receipt is caught as an over-invoice. |
| **BlanketAgreement** | Aggregate | `draft → active ⇄ suspended → expired / closed`. A release reserves value and quantity **before** the order exists in the eyes of the next buyer, and every cap is checked before anything mutates, so a rejected release leaves the agreement untouched. Cancelling the release's order returns both reservations. |

### Approvals

`ApprovalService` never calls the document services. A document asks for a
chain, the chain completes, and subscribers registered at composition time
(`registerApprovalHandler`) push the outcome back onto the document. That is
what keeps requisitions, orders and approvals acyclic, and it is why an
auto-approved requisition is already `approved` by the time `submit` returns.

Steps support quorum (n-of-m named approvers), delegation (the decision records
`onBehalfOf`), and SLA escalation — `sweepOverdue` is the timer entry point and
promotes an overdue step to its escalation role rather than skipping it.

### Sourcing and evaluation

`domain/quote-evaluation.ts` is a pure function over an RFQ, its quotes and the
supplier directory. Each quote is scored out of 10 000 basis points on price,
lead time, quality and compliance, weighted by the RFQ's own weights (which
must total 10 000, so scores are comparable across events). Price scores
relative to the cheapest responsive bid rather than to an absolute, lead time
against the requested date, quality from the supplier scorecard mirrored out of
quality-qms. Expired, withdrawn and non-responsive quotes are excluded with a
stated reason instead of silently dropped. The evaluation also computes the
best **split award** — the per-line cheapest responsive bid — so a buyer can
see what single-sourcing costs before choosing it.

### Three-way match

`domain/three-way-match.ts` is pure: given an invoice, its order and the posted
receipts, it returns a verdict. Nothing is mutated, so the same run can be
replayed for audit or dry-run under different tolerances ("what if I widen the
price band to 3%").

Checks, each with a stable code on the result: duplicate supplier reference, no
/ unissued purchase order, supplier and currency mismatch, invoice line not on
the order, unit-price variance (over tolerance blocks, under tolerance is a
warning), quantity over ordered, quantity over received, no posted receipt,
unmatched freight or misc charge, header total not equal to the sum of the
lines, and declared tax against the tax the line rates imply. Blocking codes
stop payment approval; warnings travel with the invoice for reporting.

Quantity already invoiced on the order line is honoured and accumulated across
lines of the same invoice, so neither a second invoice nor a second line can
re-claim the same receipt. A buyer clears an exception either by fixing the
data (`resolved`, and re-matching) or by accepting it on the record (`waived`);
waived codes stay waived when the match is re-run and are listed on the
payment-approval event.

Tolerances are a **placeholder policy table** (`DEFAULT_MATCH_TOLERANCES`,
overridden per order). A real deployment sources them per supplier, category
and spend band; everything downstream reads the tolerance off the result, so
changing the source changes no other code. That is the "stub" in three-way
match stubs — the engine is complete, the policy feed is not.

## Layout

```
src/domain/          aggregates, value objects, state machines, pure engines
src/application/     use-case services + ports (repos, numbering, outbox, clock)
src/infrastructure/  in-memory repositories, outbox, clock, sequences
src/http/            dependency-free router, boundary validation, route modules
src/fixtures/        demo tenant seed
migrations/          Postgres DDL mirroring the domain invariants
tests/               node:test suites (unit + full HTTP integration)
```

Repositories are interfaces (`application/ports.ts`); the in-memory adapters
are single-process stand-ins and every service takes a `Clock`, so tests move
time by hand. The migrations encode the same rules for a later Postgres
adapter: `CHECK` constraints for every state machine, `accepted + rejected =
received` and `invoiced ≤ accepted` on the order line, a partial unique index
so only one approval chain is pending per document, another so a supplier
reference cannot be live twice, and views (`proc_v_open_demand`,
`proc_v_open_commitment`, `proc_v_gr_ir`, `proc_v_spend`,
`proc_v_delivery_performance`, `proc_v_invoice_exceptions`,
`proc_v_agreement_utilisation`) that mirror the in-process roll-ups.

Money is integer minor units plus an ISO currency, quantities are branded
numbers, and every rate is basis points — no floats in a decision. Document
numbers (`PO-2026-000042`) are allocated per tenant, series and year; they are
part of the public contract because suppliers quote them back on packing slips.

Domain events use the shared-kernel envelope and are appended to a
transactional outbox: an aggregate raises, the service commits state and
events together, and integration-hub drains. 74 event types namespaced
`procurement.<aggregate>.<event>` — the integration-relevant ones are
`requisition.approved`, `rfq.issued`, `rfq.awarded`, `po.issued`, `po.revised`,
`receipt.posted` (inventory-wms), `invoice.matched`,
`invoice.approved_for_payment` (finance-erp) and `agreement.released`.

## HTTP API

Multi-tenancy via headers: `x-tenant-id` (required except on `/health` and
`/routes`), `x-user-id`, `x-roles` (comma-separated).

- `GET /health`, `GET /routes`, `GET /outbox`, `POST /outbox/drain`
- `POST|GET /suppliers`, `GET /suppliers/:id`, `POST /suppliers/:id/block|unblock|categories`,
  `POST /suppliers/sync`, `GET /suppliers/:id/delivery-performance|contract-availability`
- `POST|GET /requisitions`, `GET /requisitions/:id`,
  `POST|PATCH|DELETE /requisitions/:id/lines[/:lineId]`,
  `POST /requisitions/:id/submit|withdraw|close|cancel`,
  `GET /requisitions/sourceable|overdue|demand-by-category`
- `POST|GET /approval-policies`, `POST /approval-policies/default`,
  `POST|DELETE /approval-policies/:code/rules[/:ruleCode]`,
  `GET /approval-requests`, `GET /approval-requests/inbox|overdue`,
  `POST /approval-requests/:id/approve|reject|delegate|escalate|cancel`,
  `POST /approval-requests/sweep-overdue`
- `POST|GET /rfqs`, `POST /rfqs/from-requisition`, `POST /rfqs/:id/lines|invitations|issue|amendments`,
  `POST /rfqs/:id/quotes`, `GET /rfqs/:id/evaluation`, `POST /rfqs/:id/close|award|cancel`,
  `GET /quotes`, `POST /quotes/:id/shortlist|reject|withdraw`, `POST /quotes/expire`
- `POST|GET /purchase-orders`, `POST /purchase-orders/from-requisition`,
  `POST /purchase-orders/:id/submit|issue|acknowledge|revisions|close|cancel`,
  `GET /purchase-orders/receivable|expedite|open-commitment`,
  `GET /purchase-orders/:id/gr-ir|received-quantities`
- `POST|GET /receipts`, `POST /receipts/:id/lines|inspections|post|reverse|returns`
- `POST|GET /invoices`, `POST /invoices/register-and-match`,
  `POST /invoices/:id/match|link-purchase-order|exceptions/resolve|hold|release`,
  `POST /invoices/:id/approve-for-payment|reject|cancel`,
  `GET /invoices/exception-queue|exception-statistics|overdue`
- `POST|GET /agreements`, `POST /agreements/:id/lines`,
  `POST /agreements/:id/lines/:lineNumber/price-tiers`,
  `POST /agreements/:id/activate|suspend|resume|close|quote|releases`,
  `GET /agreements/best-price?itemCode=&quantity=`, `GET /agreements/commitments|renewals-due`,
  `POST /agreements/expire-due`
- `GET /analytics/dashboard|spend/by-supplier|spend/by-category|spend/by-cost-center`,
  `GET /analytics/contract-coverage|supplier-performance|sourcing-savings`,
  `GET /analytics/open-commitments|gr-ir|requisition-cycle-time`

Errors map to the status the domain declares: `VALIDATION` 422 (with the
offending field on `details`), `INVALID_STATE` 409, `TOLERANCE_EXCEEDED` 409
(with the tolerance code and the numbers that breached it),
`SUPPLIER_NOT_ORDERABLE` 409, `AGREEMENT_LIMIT` 409 (with `limitCode`:
`RELEASE_LIMIT`, `MAXIMUM_VALUE`, `LINE_QUANTITY_CAP`, `OUT_OF_PERIOD`),
`ROLE_REQUIRED` 403, `NOT_FOUND` 404, `MISSING_TENANT` 401.

## Run it

```bash
npm run build      # tsc -p tsconfig.json
npm test           # 122 node:test cases, includes the HTTP walkthrough
npm run typecheck  # src + tests
npm run dev        # seeded demo server on :3070 (SEED=0 to start empty)
```

The seed is a small manufacturer's procurement tenant: three suppliers, both
default approval matrices, a stationery requisition that auto-approves and is
already on an issued order ready to receive against, a capital steel
requisition that walks a manager → finance chain and goes out as a sealed RFQ
to two suppliers, and a fasteners framework agreement with volume tiers and
auto-release.

```bash
curl -s -H 'x-tenant-id: acme' localhost:3070/requisitions/sourceable
curl -s -H 'x-tenant-id: acme' localhost:3070/purchase-orders/receivable
curl -s -H 'x-tenant-id: acme' localhost:3070/analytics/dashboard
curl -s -H 'x-tenant-id: acme' 'localhost:3070/agreements/best-price?itemCode=BOLT-M12-60&quantity=5000'
curl -s -H 'x-tenant-id: acme' -X POST localhost:3070/approval-requests/sweep-overdue \
     -H 'x-roles: procurement_admin'
```

## Design notes

- **Reserve before you order.** An agreement release records its drawdown
  before the purchase order can be issued, and rolls the order back if a cap
  rejects it. The alternative — check, then order, then record — lets two
  buyers spend the last of a contract at the same time.
- **Posting is the only write.** A goods receipt is inert until posted, so
  every over-receipt check happens at one point in the code. Reversals and
  returns credit the line rather than editing what was received, which keeps
  the delivery-performance history honest.
- **Tolerances are snapshotted.** Copied onto the order at creation, so
  tightening the policy tomorrow cannot turn yesterday's clean receipt into an
  exception. This is the same reason approval rules are resolved once, at
  submission, and the chain then stands on its own.
- **Warnings are not failures.** A price *below* the order, a tax rounding
  difference or an unmatched freight charge produce findings but do not block
  payment. Conflating advisory with blocking is what turns an AP exception
  queue into noise nobody reads.
- **The match is a function.** No I/O, no mutation: the engine takes three
  documents and returns a verdict, which is what makes it replayable for audit
  and testable without a database.
- **Analytics read aggregates, not projections.** The shapes returned by
  `SpendAnalyticsService` are exactly what reporting-bi would serve from
  event-fed projection tables, so moving the computation later changes no
  caller.
