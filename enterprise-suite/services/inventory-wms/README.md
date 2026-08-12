# @enterprise-suite/inventory-wms

Inventory & Warehouse Management bounded context: warehouse topology, stock
balances, lot/serial tracking, an append-only inventory ledger, sales-order
reservations with FEFO/FIFO allocation, cycle counting, and putaway/pick
execution tasks.

## Domain model

| Aggregate / entity | Purpose |
| --- | --- |
| `Warehouse` → `Zone` → `Bin` | Physical topology. Bins carry a pick sequence (travel path), optional capacity, and can be blocked/unblocked. |
| `Lot`, `SerialUnit` | Batch- and unit-level tracking with their own status machines (quarantine, expiry, ship/return/scrap). |
| `StockBalance` | One row per `(warehouse, bin, sku, lot)`. Enforces the context's core invariant: `0 ≤ reserved ≤ onHand`, `available = onHand − reserved`. |
| `InventoryTransactionRecord` | Append-only ledger. Every physical change writes exactly one row (`RECEIPT`, `ISSUE`, `TRANSFER`, `ADJUSTMENT`, `COUNT_ADJUSTMENT`); balances are rebuildable by replay. |
| `Reservation` | Soft allocation of stock to a sales order, line by line, with concrete bin/lot allocations. |
| `CycleCountOrder` | Counting work order with a frozen baseline snapshot and variance posting. |
| `PutawayTask`, `PickTask` | Execution task stubs with full status machines. Putaway completion performs the physical transfer; pick completion records operator progress (the issue is posted at reservation fulfillment). |

Every aggregate carries `tenantId`; in-memory stores are partitioned by tenant
first, and every SQL unique key includes `tenant_id`.

## State machines

```
Warehouse     ACTIVE ⇄ INACTIVE

Lot           AVAILABLE ⇄ QUARANTINE → EXPIRED → CONSUMED

Serial        IN_STOCK ⇄ RESERVED → SHIPPED → RETURNED → IN_STOCK | SCRAPPED

Reservation   OPEN → PARTIALLY_ALLOCATED → ALLOCATED → FULFILLED
                └────────┴──────────┴──→ RELEASED | CANCELLED

Cycle count   DRAFT → IN_PROGRESS ⇄ REVIEW → COMPLETED
                └──────────┴─────────┴──→ CANCELLED

Putaway       PENDING ⇄ ASSIGNED → IN_PROGRESS → COMPLETED
                └──────────┴───────────┴──→ CANCELLED

Pick          PENDING ⇄ ASSIGNED → PICKING → PICKED | SHORT_PICKED
                └──────────┴──────────┴──→ CANCELLED
```

Transitions are declared as data (`TransitionMap`) and violations fail with 409.

## Allocation

`ReservationService.allocate` walks usable stock (skipping blocked bins,
quarantined/expired lots, and zero-availability balances) sorted by:

- **FEFO** — earliest lot expiry first (non-expiring stock last); default.
- **FIFO** — earliest lot receipt (falling back to balance creation time).

Both tie-break on bin pick sequence, then balance id, so output is
deterministic. Balance `reserve()` and the aggregate's allocation records
commit together; release/cancel return the reserved units, fulfill consumes
them and writes `ISSUE` ledger rows referencing the sales order.

## Cycle counting

Expected quantities are snapshotted at `start`; adjustments post the
**variance as a delta** (`counted − expected`), so movements that happen
between snapshot and completion are preserved. Completion writes one
`COUNT_ADJUSTMENT` per variance line referencing the order.

## HTTP API

Identity comes from gateway headers `x-tenant-id`, `x-user-id`, `x-roles`.
Mutations require role `inventory.write` (or `admin`). `GET /health` is
unauthenticated.

```
POST /warehouses                         GET  /warehouses[, /:id, /:id/topology]
POST /warehouses/:id/{rename,activate,deactivate,zones,bins}
POST /bins/:binId/{block,unblock}

POST /stock/{receipts,issues,transfers,adjustments}
GET  /stock/balances                     GET  /stock/availability/:sku
GET  /stock/transactions                 GET  /lots?sku=  /serials?sku=
POST /lots/:lotId/{quarantine,release}

POST /reservations                       GET  /reservations[, /:id]
POST /reservations/:id/{allocate,release,cancel,fulfill,pick-tasks}

POST /cycle-counts                       GET  /cycle-counts[, /:id]
POST /cycle-counts/:id/{start,recount,complete,cancel}
POST /cycle-counts/:id/lines/:lineId/count

GET  /tasks/putaways[, /:id]             GET  /tasks/picks[, /:id]
POST /tasks/putaways/:id/{assign,start,complete,cancel}
POST /tasks/picks/:id/{assign,start,complete,cancel}
```

Errors are structured: `{ "error": { "code", "message", "details?" } }` with
domain codes such as `INSUFFICIENT_STOCK`, `BIN_BLOCKED`, `LOT_NOT_USABLE`,
`ADJUSTMENT_BELOW_RESERVED`, `OVER_ALLOCATION`.

## Events

Published through the transactional outbox port (`EventOutbox`) as
shared-kernel envelopes. Key types:

`inventory.stock.{received,issued,transferred,adjusted}`,
`inventory.reservation.{created,allocated,released,cancelled,fulfilled}`,
`inventory.cycle-count.{created,started,completed,cancelled}`,
`inventory.{putaway-task,pick-task}.{created,completed,cancelled}`,
plus warehouse/zone/bin/lot lifecycle events. See `src/domain/events.ts`
for payload contracts.

## Persistence

In-memory repositories implement the ports in `src/application/ports.ts`.
`migrations/*.sql` defines the Postgres schema the ports map onto, including
the `reserved ≤ on_hand` check, a generated `available` column, the
append-only ledger trigger, the partial unique index enforcing one *active*
reservation per sales order, and one pick task per allocation.

## Layout

```
src/domain            aggregates, value objects, state machines, event contracts
src/application       ports, validation, allocation strategies, services
src/infrastructure    in-memory repos, outbox, composition root (container.ts)
src/http              dependency-free router, tenant context, routes, node:http server
migrations            SQL schema (0001..0006)
tests                 domain, service, and HTTP end-to-end suites
```

## Usage

```ts
import { createInventoryModule, startServer } from "@enterprise-suite/inventory-wms";

const module = createInventoryModule();
await startServer(module, 8080);
```

## Scripts

```
npm run build       # tsc
npm run typecheck   # tsc --noEmit
npm test            # node --test via tsx (64 tests)
npm run lint
```
