# @enterprise-suite/supply-chain

Supply chain planning bounded context: demand forecasting, safety stock
policies, multi-level MRP netting, supply plans with a planned-order
lifecycle, discrete ATP / simplified CTP, allocations, lightweight supplier
capacity calendars, and fully audited planning runs.

## Position in the suite

```
Sales/Marketing forecast input ─┐
Sales Orders (allocations) ─────┤
Inventory on-hand projection ───┼──► Supply Chain MRP ──► planned PURCHASE orders ──► Procurement
Open POs / WOs (receipts) ──────┤                     └─► planned PRODUCTION orders ─► Manufacturing
SRM supplier capacity ──────────┘
```

Integrations are event-driven (shared-kernel envelopes through a
transactional outbox) plus projection endpoints (`PUT /inventory`,
`PUT /scheduled-receipts`) that upstream contexts push into.

## Domain model

| Aggregate / concept | Purpose |
| --- | --- |
| `PlanningItem` | Per-SKU MRP parameters: MAKE/BUY, lead time, lot-sizing rule, safety stock policy reference, preferred supplier, standard cost, single-level BOM (with scrap). |
| `DemandForecast` | Weekly series per (sku, location); DRAFT → PUBLISHED → ARCHIVED; exactly one PUBLISHED series per item/location. |
| `SafetyStockPolicy` | STATIC, DAYS_OF_COVER, or SERVICE_LEVEL (z-factor via Acklam's inverse-normal approximation, `z · σ_week · √LT_weeks`). |
| `PlanningRun` | One MRP execution over a location/horizon/scope with an append-only, sequenced audit log; DRAFT → RUNNING → COMPLETED/FAILED. |
| `SupplyPlan` | Netting result per (run, sku, location): full MRP grid, exceptions, planned orders (PLANNED → FIRMED → RELEASED / CANCELLED). |
| `Allocation` | Hard reservation of supply for committed demand (the demand side of ATP; consumes forecast in MRP). |
| `SupplierCapacityCalendar` | Weekly capacity commitments per supplier (optionally per SKU) with a default; used for MRP overload checks and CTP. |
| `ScheduledReceipt`, `InventoryRecord` | Lightweight projections of open external supply and on-hand stock. |

## MRP semantics

- **Buckets** — weekly, Monday-anchored, horizon 1–104 weeks.
- **Gross requirements** — residual published forecast (same-bucket
  consumption by allocations, i.e. `max(forecast, actuals)`) plus active
  allocations plus dependent demand exploded from parent planned orders.
- **Netting** — projected on-hand kept at/above safety stock; shortfalls
  become net requirements, lot-sized into planned receipts
  (`LOT_FOR_LOT`, `FIXED_ORDER_QTY`, `MIN_MAX` with multiple/cap,
  `PERIOD_ORDER_QTY` with on-hand-aware lookahead).
- **Multi-level** — low-level codes computed as longest path over the BOM
  DAG (cycles rejected); level N is fully planned before exploding into
  level N+1. Firmed orders from an item's previous plan re-enter as
  scheduled receipts, so planner commitments survive regeneration.
- **Exceptions** — `RELEASE_PAST_DUE`, `SHORTAGE`, `BELOW_SAFETY_STOCK`,
  `EXPEDITE_RECEIPT`, `EXCESS_RECEIPT`, `LOT_MAX_EXCEEDED`,
  `SUPPLIER_CAPACITY_OVERLOAD`. Stock exceptions are derived from a
  *feasibility* projection where past-due orders cannot arrive earlier than
  the item lead time — i.e. what actually happens unless someone intervenes.

## ATP / CTP

Discrete ATP with backward consumption: supply buckets (on-hand, scheduled
receipts, firmed planned orders) absorb committed demand (active
allocations) up to the next supply bucket; deficits consume earlier ATP.
CTP promises from cumulative ATP first, then from supplier capacity offset
by lead time (simplified: gross calendar capacity; use the load report for a
netted view). Allocations are rejected when ATP is insufficient unless
`force: true`.

## HTTP API (headers: `x-tenant-id`, `x-user-id`, `x-roles`)

```
GET  /health                                     (anonymous)
POST /items                GET /items[/:id]      PUT /items/:id/{lot-sizing,bom,safety-stock-policy}   POST /items/:id/deactivate
POST /safety-stock-policies[/preview]            GET /safety-stock-policies[/:id]   PUT /safety-stock-policies/:id/method
POST /forecasts            GET /forecasts[/:id]  PUT /forecasts/:id/entries         POST /forecasts/:id/{publish,archive}
PUT  /inventory            GET /inventory
PUT  /scheduled-receipts   GET /scheduled-receipts                                  DELETE /scheduled-receipts/:id
POST /supplier-calendars   GET /supplier-calendars[/:id]                            PUT /supplier-calendars/:id/weeks
GET  /supplier-capacity-load?supplierId=&weeks=
POST /planning-runs        GET /planning-runs[/:id]                                 POST /planning-runs/:id/execute   GET /planning-runs/:id/audit
GET  /supply-plans[/:id]                         POST /supply-plans/:id/orders/:orderId/{firm,release,cancel}
GET  /atp?sku=&location=&weeks=                  POST /ctp
POST /allocations          GET /allocations      POST /allocations/:id/cancel
```

## Events

`supplychain.item.{created,bom_changed}`, `supplychain.forecast.{published,archived}`,
`supplychain.safety_stock_policy.changed`, `supplychain.planning_run.{started,completed,failed}`,
`supplychain.supply_plan.created`, `supplychain.planned_order.{firmed,released,cancelled}`,
`supplychain.allocation.{created,cancelled}`, `supplychain.supplier_capacity.changed`.

`planned_order.released` is the hand-off to Procurement (PURCHASE) /
Manufacturing (PRODUCTION); those contexts push resulting real orders back
as scheduled receipts.

## Layout

```
src/domain/           calendar, lot-sizing, safety stock math, MRP engine, ATP/CTP,
                      aggregates (item, forecast, policy, run, plan, allocation, calendar)
src/application/      ports (repos, outbox, clock) + services (item, forecast, safety stock,
                      planning, supply plan, ATP, capacity)
src/infrastructure/   in-memory repos, in-memory outbox, clocks, composition root
src/http/             dependency-free router, tenant context, validation, route modules
migrations/           Postgres DDL mirroring the aggregates + transactional outbox
tests/                node:test suites: engine math, aggregates, end-to-end planning, HTTP
```

## Development

```sh
# from the monorepo root (builds the shared kernel dependency too)
npm run build -w @enterprise-suite/supply-chain     # tsc -b with project references
npm run test  -w @enterprise-suite/supply-chain     # node --import tsx --test tests/*.test.ts
npm run typecheck -w @enterprise-suite/supply-chain
```

Start an HTTP server programmatically:

```ts
import { createSupplyChainServer } from "@enterprise-suite/supply-chain";
createSupplyChainServer().listen(3005);
```

Repositories are in-memory behind narrow ports; `migrations/*.sql` defines
the equivalent Postgres schema (including ordering and partial-unique
constraints the in-memory versions rely on) for a later adapter.
