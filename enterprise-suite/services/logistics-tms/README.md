# @enterprise-suite/logistics-tms

Transportation Management System (TMS) bounded context for the enterprise
suite: carrier management, rate shopping, shipment execution with tracking,
load/route planning, dock scheduling, and proof of delivery.

## Domain model

| Aggregate | Purpose | Key invariants |
| --- | --- | --- |
| `Carrier` | Carrier master data + service levels (GROUND, EXPRESS, …) | unique code per tenant; service levels validated (transit days 0–60, cutoff hour 0–23) |
| `RateCard` | Zone rules, weight breaks, accessorials, fuel surcharge per (carrier, service level) | draft → published → archived; publishing requires every zone to have breaks; published cards are immutable |
| `Shipment` | Origin/destination, packages, booking, tracking history, POD link | status only moves forward; late scans never regress it; price is computed server-side at booking |
| `Load` | Truck movement with ordered stops and shipment assignments | pickup stop must precede delivery stop; stops visited in sequence; dispatch requires carrier + ≥2 stops + ≥1 shipment |
| `DockAppointment` | Door/time-window reservation at a facility | no overlapping windows per door (requested/confirmed/checked-in hold the door); check-in window with 30-minute early grace |
| `ProofOfDelivery` | Signature/photo/PIN capture with OS&D exceptions | one POD per shipment; capture drives the DL tracking event and delivers the shipment |

### Shipment status machine

```
draft → booked → picked_up → in_transit → out_for_delivery → delivered
          │            \________ exception (EX scan; recovers on next forward scan)
          └→ cancelled (only draft/booked)
```

Tracking codes (EDI 214-inspired): `PU` pickup, `DP` departed, `AR` arrived,
`OD` out for delivery, `DL` delivered, `EX` exception, `NT` note. Every scan
is retained in history; only forward progress changes the status.

### Rating

Billable weight = Σ per package `max(actual, volume/dimFactor)` rounded up
to 0.5 kg. Zone resolution picks the most specific rule (longest matching
postal prefix, then country). Price = weight-break base + fuel surcharge %
+ flat accessorial fees. `POST /quotes` shops every active carrier; booking
re-rates the specific carrier/service so the price is always server-derived.

### Cross-aggregate behavior

- Load stop **departure** at a pickup stop pushes `PU` tracking events to
  the shipments picked up there; **arrival** at a delivery stop pushes `AR`.
- POD capture records `DL`, delivers the shipment, and links `podId`.
- All state changes emit envelope events (`logistics.*`) through a
  transactional outbox (`InMemoryOutbox`; schema in `migrations/007`).

## HTTP API

Identity headers: `x-tenant-id` (required), `x-user-id`, `x-roles`.

```
GET    /health
GET    /outbox/pending

POST   /carriers                          PATCH  /carriers/:id
GET    /carriers[?status=&mode=]          GET    /carriers/:id
POST   /carriers/:id/activate|deactivate
POST   /carriers/:id/service-levels       DELETE /carriers/:id/service-levels/:code

POST   /rate-cards                        GET    /rate-cards/:id
GET    /carriers/:id/rate-cards
POST   /rate-cards/:id/zones|breaks|accessorials|fuel-surcharge|publish|archive
POST   /quotes

POST   /shipments                         GET    /shipments[?status=&orderRef=]
GET    /shipments/:id                     GET    /tracking/:trackingNumber
POST   /shipments/:id/packages            DELETE /shipments/:id/packages/:packageId
POST   /shipments/:id/book                POST   /shipments/:id/cancel
POST   /shipments/:id/tracking-events     GET    /shipments/:id/tracking-events
POST   /shipments/:id/pod                 GET    /shipments/:id/pod
POST   /pods/:podId/exceptions

POST   /loads                             GET    /loads[?status=]
GET    /loads/:id                         POST   /loads/:id/carrier|driver
POST   /loads/:id/stops                   DELETE /loads/:id/stops/:stopId
POST   /loads/:id/assignments             DELETE /loads/:id/assignments/:shipmentId
POST   /loads/:id/dispatch|complete|cancel
POST   /loads/:id/stops/:stopId/arrive|depart

POST   /dock-appointments                 GET    /dock-appointments[?facility=&status=&date=]
GET    /dock-appointments/:id
POST   /dock-appointments/:id/confirm|reschedule|check-in|complete|cancel|no-show
```

Errors are structured: `{ "error": { "code", "message", "details?" } }` with
`400 VALIDATION`, `401 UNAUTHENTICATED`, `404 NOT_FOUND`, `409 CONFLICT`,
`422` for rating/booking failures (`NO_RATE`, `CARRIER_UNAVAILABLE`).

### Example: quote and book

```bash
curl -s localhost:3007/quotes -X POST \
  -H 'x-tenant-id: acme' -H 'content-type: application/json' \
  -d '{
    "destination": {"name":"Kunde","line1":"Kaufingerstr 12","city":"Munich","postalCode":"80331","country":"DE"},
    "packages": [{"weightKg": 4, "dimensions": {"lengthCm":30,"widthCm":20,"heightCm":10}}]
  }'

curl -s localhost:3007/shipments/$SHIPMENT_ID/book -X POST \
  -H 'x-tenant-id: acme' -H 'content-type: application/json' \
  -d '{"carrierId": "'$CARRIER_ID'", "serviceLevelCode": "GROUND"}'
```

## Events published

`logistics.carrier.{created,updated,activated,deactivated,service_level_upserted,service_level_removed}`,
`logistics.rate_card.{created,published,archived}`,
`logistics.shipment.{created,booked,tracking_updated,exception,delivered,cancelled}`,
`logistics.load.{created,dispatched,stop_arrived,stop_departed,completed,cancelled}`,
`logistics.dock_appointment.{requested,confirmed,rescheduled,checked_in,completed,cancelled,no_show}`,
`logistics.pod.{captured,exception_noted}`

Integration hooks for the rest of the suite: `shipment.booked` /
`shipment.delivered` carry `orderRef` for sales-order fulfilment and AR
billing; `pod.captured` carries the exception count for claims.

## Layout

```
src/domain/          aggregates, value objects, rating math, event catalog
src/application/     use-case services (one per workflow area)
src/infrastructure/  repository ports, in-memory adapters, outbox
src/http/            router, validation, route modules, composition root
migrations/          Postgres DDL mirroring the domain (incl. gist exclusion
                     constraint for dock overlaps and the outbox table)
tests/               unit + HTTP integration suites (node:test)
```

## Scripts

```bash
npm run build      # tsc → dist/
npm run typecheck
npm test           # node --import tsx --test tests/*.test.ts
npm start          # HTTP server on :3007 (PORT overridable)
```

Repositories are in-memory (per AGENT_CONTRACT); the interfaces in
`src/infrastructure/repositories.ts` plus the SQL in `migrations/` define
the Postgres adapter contract.
