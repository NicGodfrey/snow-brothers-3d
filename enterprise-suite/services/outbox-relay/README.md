# outbox-relay

Infrastructure process that connects every domain service's transactional
outbox to **integration-hub**, so domain events actually leave the process
that produced them.

Each domain service appends events to an in-memory outbox in the same logical
unit of work as its aggregate save. Without a relay those events never cross a
process boundary. This service closes the loop:

```
sales-erp ─┐
finance-erp ├─ POST /outbox/drain ──> outbox-relay ── POST /outbox/batch ──> integration-hub
…          ─┘        (per service)                        (per tenant)          (routes to bus /
17 services                                                                      webhooks / adapters)
```

## How it works

1. **Discovery** — the relay reads `scripts/suite-manifest.json` for every
   service id + port (excluding integration-hub and itself), then probes what
   each service actually exposes: the peek paths `GET /outbox/pending`,
   `GET /outbox`, `GET /sales/outbox`, `GET /events`, and the drain path
   `POST /outbox/drain`. Services that expose a drain are consumed
   destructively/exactly-once; peek-only services are deduplicated client-side
   by `eventId`.
2. **Collection** — every `RELAY_INTERVAL_MS` (default 2000 ms) each service is
   drained into a local buffer. Buffered events survive a hub outage and are
   retried on the next cycle, so a drain is never lost.
3. **Forwarding** — buffered events are posted to the hub's bulk-ingestion
   endpoint `POST /outbox/batch` as `{ source: <service-id>, events: [...] }`,
   one batch per tenant (the hub authenticates per `x-tenant-id`).

## Idempotency

Producer `eventId`s are preserved end to end and integration-hub deduplicates
on `(tenant, source, eventId)`. A crash between drain and acknowledgement, a
retried batch, or a peek re-read can therefore never double-publish an event.

## Endpoints

| Method | Path      | Purpose                                              |
| ------ | --------- | ---------------------------------------------------- |
| GET    | `/health` | Liveness for the suite shell                         |
| GET    | `/status` | Per-service mode, counters, buffer depth, last error |
| POST   | `/run`    | Trigger one poll cycle synchronously                 |

## Configuration

| Env variable        | Default                        | Meaning                          |
| ------------------- | ------------------------------ | -------------------------------- |
| `PORT`              | `4120`                         | Health/status HTTP port          |
| `RELAY_INTERVAL_MS` | `2000`                         | Poll interval                    |
| `HUB_URL`           | manifest integration-hub port  | Integration-hub base URL         |
| `SUITE_MANIFEST`    | `scripts/suite-manifest.json`  | Manifest with service ids/ports  |

## Run

Started automatically by `scripts/start-suite.mjs` (it is listed in
`scripts/suite-manifest.json`). Standalone:

```bash
npm start --workspace @enterprise-suite/outbox-relay
```

## Test

```bash
npm test --workspace @enterprise-suite/outbox-relay
```

The tests spin up a fake drainable service and a fake hub and verify shape
normalization, per-tenant batching, exactly-once forwarding, and the retry
buffer under a hub outage.
