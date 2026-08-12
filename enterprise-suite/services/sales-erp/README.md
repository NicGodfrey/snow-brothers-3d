# @enterprise-suite/sales-erp

Sales bounded context for the enterprise suite: accounts/customers (sales view),
contacts, opportunity pipeline, quotes, sales orders, price lists, tax lines,
credit checks and returns (RMA).

## Layout

```
src/kernel/           Local copy of shared-kernel primitives (Entity, AggregateRoot,
                      EventEnvelope, Money, Result, branded ids, state-machine helper)
                      so the package builds in isolation; shape-compatible with
                      @enterprise-suite/shared-kernel.
src/domain/           Aggregates, value objects, policies, state machines, events.
src/application/      Application services, command validation schemas, ports.
src/infrastructure/   In-memory repositories, outbox, clocks, composition root.
src/http/             Plain node:http router, tenant-context middleware, route handlers.
src/fixtures/         Deterministic demo seed used by tests and the dev server.
migrations/           Postgres DDL matching the domain model (runtime is in-memory).
tests/                node:test suites (unit + HTTP integration).
```

## Domain model

- **Account** — `prospect | customer | partner`; status machine `active ⇄ on_hold → closed`;
  payment terms, currency, credit limit (integer minor units, `null` = no limit),
  credit hold with reason, billing/shipping addresses. Contacts hang off accounts
  (unique active e-mail, single primary).
- **Opportunity** — pipeline `prospecting → qualification → proposal → negotiation`
  with backward moves allowed, terminal `closed_won / closed_lost`; stage-driven
  probability and weighted pipeline reporting.
- **PriceList** — per-currency, quantity-tiered item prices (highest `minQty ≤ qty`
  wins), tax category per item, one active default list per currency, archival.
- **Quote** — lines with tier-resolved or overridden unit prices, per-line discount
  (volume ladder 10/50/100 → 2.5/5/8 % applied by default, hard cap 60 %),
  validity date, revisioning. Status machine:
  `draft → pending_approval → approved → accepted | expired`, plus `rejected → draft`
  (revise) and `cancelled`. Discounts above 15 % need a `sales_manager`/`admin` approver.
- **SalesOrder** — created from an accepted quote or drafted directly. Status machine
  `draft → confirmed → allocated → shipped → invoiced → closed`, cancellable until
  shipped. Per-line `qtyAllocated`/`qtyShipped` with partial allocations/shipments;
  the aggregate advances when every line completes.
- **Credit check** (at confirmation and on demand) — exposure = grand total of open
  orders (`confirmed/allocated/shipped`); decision `approved` within limit,
  `review_required` up to 110 % (manager override needed), otherwise `declined`.
  Hold/closed accounts always decline; no configured limit always approves.
- **ReturnAuthorization (RMA)** — references shipped order lines; quantity capped at
  shipped minus already-returned (rejected/cancelled RMAs release quantity); refund
  unit price frozen from the discounted order price. Status machine
  `requested → approved → received → refunded`, plus `rejected` and `cancelled`.
- **Totals** — shared calculator for quotes and orders: gross → line discount → net →
  tax lines grouped by category with per-region rates (DE/FR/GB/US built in) → grand total.
  All amounts are integer minor units + ISO currency.

## Domain events (outbox)

`sales.account.*` (created, updated, converted-to-customer, credit-hold-placed/released,
credit-limit-changed, closed, contact-added) ·
`sales.opportunity.*` (created, stage-changed, amount-revised, won, lost) ·
`sales.quote.*` (created, submitted, approved, rejected, **accepted**, expired, cancelled, revised) ·
`sales.order.*` (created, **confirmed**, allocated, shipped, invoiced, closed, **cancelled**) ·
`sales.rma.*` (requested, approved, rejected, received, refunded, cancelled).

Events use the shared-kernel envelope shape and are appended to an in-memory
transactional outbox (`migrations/0008` holds the Postgres relay table).

## HTTP API

Identity headers (per ARCHITECTURE.md): `x-tenant-id` (required), `x-user-id`,
`x-roles` (comma-separated; `sales_rep`, `sales_manager`, `admin`).
Errors: `{ "error": { code, message, details } }` with 400/401/403/404/409/413/422.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness (public) |
| GET | `/sales/outbox` | Tenant's domain events (debug) |
| POST | `/sales/accounts` | Create account |
| GET | `/sales/accounts` | List (`accountType`, `status`, `q`, `page`, `pageSize`) |
| GET/PATCH | `/sales/accounts/:id` | Fetch / update |
| POST | `/sales/accounts/:id/convert-to-customer` | Prospect → customer |
| POST / DELETE | `/sales/accounts/:id/credit-hold` | Place / release credit hold |
| POST | `/sales/accounts/:id/credit-limit` | Change credit limit (`null` = no limit) |
| POST | `/sales/accounts/:id/close` | Close account |
| GET | `/sales/accounts/:id/credit-check?orderTotalMinor=` | What-if credit decision |
| POST/GET | `/sales/accounts/:id/contacts` | Add / list contacts |
| DELETE | `/sales/accounts/:id/contacts/:contactId` | Deactivate contact |
| POST | `/sales/opportunities` | Create opportunity |
| GET | `/sales/opportunities` | List (`stage`, `accountId`, paging) |
| GET | `/sales/opportunities/pipeline` | Per-stage counts, totals, weighted totals |
| GET | `/sales/opportunities/:id` | Fetch |
| POST | `/sales/opportunities/:id/stage` | Move to open stage |
| POST | `/sales/opportunities/:id/advance` | Advance one stage |
| POST | `/sales/opportunities/:id/amount` | Revise amount |
| POST | `/sales/opportunities/:id/win` / `lose` | Close won / lost (reason required) |
| POST | `/sales/price-lists` | Create price list |
| GET | `/sales/price-lists` / `/:id` | List / fetch |
| POST | `/sales/price-lists/:id/items` | Upsert item with tiers |
| DELETE | `/sales/price-lists/:id/items/:sku` | Remove item |
| POST | `/sales/price-lists/:id/archive` | Archive |
| GET | `/sales/price-lists/:id/price?sku=&qty=` | Resolve tier price |
| POST | `/sales/quotes` | Create quote (lines priced from list unless overridden) |
| GET | `/sales/quotes` | List (`status`, `accountId`, paging) |
| GET | `/sales/quotes/:id` | Quote + computed totals/tax lines |
| POST | `/sales/quotes/:id/lines` | Add line (draft only) |
| PATCH / DELETE | `/sales/quotes/:id/lines/:lineId` | Update / remove line |
| POST | `/sales/quotes/:id/submit` / `approve` / `reject` | Approval workflow |
| POST | `/sales/quotes/:id/accept` | Customer accepts → wins opportunity, creates draft order |
| POST | `/sales/quotes/:id/cancel` / `revise` | Cancel / new revision |
| POST | `/sales/quotes/expire-sweep` | Expire approved quotes past validity |
| POST | `/sales/orders` | Create draft order |
| POST | `/sales/orders/from-quote` | Create order from accepted quote |
| GET | `/sales/orders` / `/:id` | List / fetch with totals |
| POST / DELETE | `/sales/orders/:id/lines(/:lineId)` | Edit lines (draft only) |
| POST | `/sales/orders/:id/confirm` | Runs credit check (`overrideCreditReview` for managers) |
| POST | `/sales/orders/:id/allocate` / `ship` | Partial quantities per line |
| POST | `/sales/orders/:id/invoice` / `close` / `cancel` | Tail of the lifecycle |
| GET | `/sales/orders/:id/returns` | RMAs for the order |
| POST | `/sales/returns` | Request return against shipped lines |
| GET | `/sales/returns/:id` | Fetch |
| POST | `/sales/returns/:id/approve` / `reject` / `receive` / `refund` / `cancel` | RMA workflow |

## Running

```bash
npm run build       # tsc -> dist/
npm test            # build + node:test (59 tests)
npm run typecheck   # tsc --noEmit
PORT=3005 SEED=1 npm start   # dev server with demo tenant "tenant-demo"
```

Programmatic use:

```ts
import { createSalesModule, buildServer, seedDemoData } from "@enterprise-suite/sales-erp";

const module = createSalesModule();
seedDemoData(module);
buildServer(module).listen(3005);
```
