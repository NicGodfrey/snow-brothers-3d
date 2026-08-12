# @enterprise-suite/manufacturing-mes

Manufacturing Execution System for the enterprise suite: work centers,
routings, work orders with a strict status machine, material issues and
production receipts, capacity calendars with shift templates, and
scrap/rework handling.

## Domain model

| Aggregate | Purpose |
|-----------|---------|
| `WorkCenter` | Production resource with cost rates (labor/machine/overhead, minor units), machine count, efficiency/utilization factors, and an assigned capacity calendar |
| `ShiftTemplate` | Weekly working-time pattern (multiple shifts per day, breaks, weekday masks; overlap and midnight-crossing rejected) |
| `CapacityCalendar` | Shift template + dated exceptions (`HOLIDAY`, `DOWNTIME`, `OVERTIME`); answers "how many productive minutes on date X?" |
| `Routing` | Process definition per SKU/revision: sequenced operations (setup / run-per-unit / teardown / queue / move minutes, crew size, inspection flag) with a `DRAFT → RELEASED → OBSOLETE` lifecycle |
| `WorkOrder` | Execution document created from a released routing + BOM lines; owns the status machine, operation-level reporting, material requirement bookkeeping, and receipt limits |
| `MaterialIssue` | Posted, immutable component movement (ISSUE / RETURN) between a warehouse and WIP |
| `ProductionReceipt` | Posted, immutable finished-goods receipt from a work order into stock |
| `ScrapRecord` | Quantity lost or deviated at an operation with reason code + disposition (`SCRAP`, `REWORK`, `USE_AS_IS`); REWORK records spawn rework work orders |

### Work order status machine

```
DRAFT ──► PLANNED ──► RELEASED ──► IN_PROGRESS ──► COMPLETED ──► CLOSED
  │           │           │          │    ▲
  │           │           │          ▼    │ (resume returns to held-from status)
  │           └───────────┴─────► ON_HOLD ┘
  └───────────┴───────────┴─────► CANCELLED   (only with nothing reported/issued)
```

Operation-level flow control: quantity can only move through operation *n*
after operation *n−1* produced it; the first operation is capped by the
ordered quantity; scrap shrinks downstream availability; the last
operation's good quantity becomes receivable. Closing requires all
completed units received to stock.

### BOM explosion

`quantity × qtyPerUnit × (1 + scrapFactorPct/100)` per component at order
creation; issues/returns track against these requirements, `unplanned`
issues are allowed but flagged. `GET /work-orders/:id/shortages` lists
under-issued planned components.

### Scheduling

`src/domain/scheduling.ts` implements calendar-aware **backward scheduling**
(finish by due date) with automatic fallback to **forward scheduling** from
today when the backward pass would start in the past. Working windows come
from the shift template adjusted by calendar exceptions. Queue and move
times consume working-calendar minutes (documented, conservative
simplification).

Capacity reporting: `effectiveMinutes = calendarMinutes × machines ×
efficiency × utilization`; load spreads planned operation minutes across
scheduled days and reports `loadPct` per day.

## HTTP API (52 routes incl. /health)

Tenant context via headers: `x-tenant-id` (required), `x-user-id`,
`x-roles`. Errors are `{ error: { code, message } }` with domain-mapped
status codes (400 validation, 401 tenant, 404 not found, 409 conflict,
422 unprocessable).

```
POST/GET    /work-centers[/:id]           PATCH /work-centers/:id
POST        /work-centers/:id/rates|status|calendar
GET         /work-centers/:id/capacity|load?from&to
GET         /work-centers/:id/dispatch-list

POST/GET    /shift-templates[/:id]
POST/GET    /capacity-calendars[/:id]
POST/DELETE /capacity-calendars/:id/exceptions[/:date]

POST/GET    /routings[/:id]               GET /routings/:id/lead-time?quantity
POST        /routings/:id/operations      PATCH/DELETE /routings/:id/operations/:seq
POST        /routings/:id/release|obsolete

POST/GET    /work-orders[/:id]            GET /work-orders/:id/shortages
POST        /work-orders/:id/plan|release|start|report|hold|resume|complete|close|cancel
POST/GET    /work-orders/:id/material-issues
POST        /work-orders/:id/material-returns
POST/GET    /work-orders/:id/receipts
GET         /work-orders/:id/scrap-records

POST/GET    /scrap-records[/:id]          GET /scrap-records/summary
POST        /scrap-records/:id/rework-order
```

## Events

All events use the shared-kernel `EventEnvelope` with `mes.*` types
(`mes.work-order.released`, `mes.material.issued`,
`mes.production-receipt.posted`, `mes.scrap.recorded`, …); see
`src/domain/events.ts` for the catalog and cross-service payload
contracts. The in-memory outbox (`src/infrastructure/outbox.ts`) supports
prefix subscriptions and `drain()` for a relay; the Postgres shape is
`migrations/0009_outbox.sql`.

## Layout

```
src/domain/           aggregates, value objects, scheduling engine, event catalog
src/application/      ports (repository/publisher/clock interfaces) + 6 services
src/infrastructure/   in-memory repositories, outbox, clocks, composition root
src/http/             dependency-free router, validation helpers, 6 route modules
migrations/           Postgres DDL (9 files) incl. transactional outbox
tests/                node:test suites: domain, application, HTTP end-to-end
```

## Usage

```bash
npm run build        # tsc
npm test             # 69 tests via node:test + tsx
npm start            # HTTP server on :3007 (PORT to override)
```

```ts
import { createContainer, createMesServer } from "@enterprise-suite/manufacturing-mes";

const { server } = createMesServer(createContainer());
server.listen(3007);
```

Repositories are in-memory behind narrow interfaces (`src/application/ports.ts`);
every method is tenant-scoped. The SQL in `migrations/` mirrors the domain
invariants (status checks, quantity checks, partial indexes for shortages
and undispatched outbox rows) for the later Postgres adapter.
