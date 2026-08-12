# @enterprise-suite/integration-hub

The suite's integration boundary. Every event leaving a domain service and
every message arriving from outside passes through here: transactional outbox
relay, de-duplicated inbox, idempotency keys, signed webhook fan-out with
delivery bookkeeping, an adapter registry for partner systems, and routing
rules that decide where a given event goes. Multi-tenant, event-emitting, HTTP
exposed, with Postgres migrations describing the persistent shape.

In-process pub/sub lives in [`@enterprise-suite/event-bus`](../../packages/event-bus);
this service owns everything durable around it.

```
 domain service                integration-hub                    outside world
 ──────────────                ───────────────                    ─────────────
  aggregate  ──write──> outbox_message ──relay──> event bus ──> in-process consumers
                                          │
                                          ├──> webhook_delivery ──signed POST──> partner
                                          └──> route rule ──> adapter (HTTP/SFTP/S3/Kafka/CSV/email)
                                                          └──> bus, translated topic

  partner ──POST /inbox──> inbox_message ──dedupe──> handler
  caller  ──Idempotency-Key──> idempotency_record ──replay stored response
```

## Aggregates

| Aggregate | Purpose |
|-----------|---------|
| `OutboxMessage` | One event awaiting relay. Leased to a worker, published, retried with backoff, dead-lettered when the budget is spent. |
| `InboxMessage` | One inbound message, de-duplicated on `(tenant, source, messageKey)` with a payload checksum, then processed by a registered handler. |
| `IdempotencyRecord` | Reservation for an inbound command key, holding the stored response so a retry replays instead of re-executing. |
| `WebhookSubscription` | A tenant's endpoint: event patterns, signing secret (with rotation grace), custom headers, timeout, attempt budget, circuit breaker. |
| `WebhookDelivery` | One event heading to one subscription, with the full attempt history. Endpoint, headers and body are snapshotted at scheduling time. |
| `AdapterRegistration` | A tenant's configured instance of a driver ("ACME's EDI SFTP drop"), with schema-validated config, health state and traffic counters. |
| `RouteRule` | Wiring table entry: patterns + content filter + payload transform → webhook, adapter or bus topic. |

## Outbox relay

Domain services write events into their own transactional outbox alongside the
aggregate change; the hub owns the relay half. Ingestion is idempotent on
`(tenant, source, eventId)`, so a service re-draining its outbox after a crash
cannot double-publish.

```
pending ──claim──> in-flight ──published──> published
   ^                   │
   └─── failed (budget left, availableAt = now + backoff)
                       └──> dead-lettered
failed | dead-lettered ──replay──> pending
```

Claims are **leased**: only the lease owner may acknowledge, and an expired
lease is reclaimable, so a crashed worker strands nothing. `RelayService`
publishes the envelope on the bus, schedules webhook deliveries and applies
route rules; a failure in any step fails the *message*, not the loop. Because
the bus publish may already have happened when a later step fails, consumers
must be idempotent — which is what the inbox provides.

## Inbox

```
received ──begin──> processing ──ok──> processed
    ^                   │
    └── retry backoff ──┴──> failed ──replay──> received
received | failed ──discard──> discarded
```

A redelivery of a known `messageKey` is absorbed and counted. A duplicate key
carrying a *different* payload checksum is a real sender bug, so it surfaces as
a conflict rather than being ignored silently. Handlers register per event type
and the message records their result.

## Idempotency keys

`IdempotencyService.execute(ctx, { key, scope, request }, operation)` reserves
the key, runs the operation at most once and stores the response. Three cases
are distinguished by design:

| Situation | Outcome |
|-----------|---------|
| same key + same request fingerprint, completed | replay the stored response (200) |
| same key + same fingerprint, still running | `409` — retry later |
| same key + different fingerprint | `422 IDEMPOTENCY_KEY_REUSE` |

Fingerprints come from `canonicalJson`, so key order in the request body is
irrelevant while any real difference is caught. A failed operation releases the
key so a genuine retry proceeds. Keys expire (24h default) and expired ones can
be purged or re-reserved.

## Webhooks

Subscriptions carry topic patterns (`quality.**`, `sales.order.*`), so fan-out
needs no per-event configuration. Endpoints are validated: http/https only, no
credentials embedded in the URL, no fragment, and headers the hub sets itself
cannot be overridden.

**Signing.** Bodies are signed Stripe-style, versioned so the scheme can
evolve:

```
x-es-signature: t=1786000000,v1=<hex hmac-sha256 of "${timestamp}.${body}">
```

Because the timestamp is inside the signed string, replaying a body under a new
timestamp does not validate. `verifySignature` takes an ordered *set* of
secrets, which is what makes zero-downtime rotation work: after
`POST /webhooks/:id/rotate-secret` the previous secret keeps verifying for a
grace window (24h default) while new attempts are signed with the new one.

**Delivery.** Scheduling and dispatching are separate halves so a slow endpoint
never blocks the relay. Retryable failures are network errors, timeouts, HTTP
408/429 and 5xx; everything else (400, 401, 404, 422, …) is a receiver-side
contract problem that retrying cannot fix, so it dead-letters immediately.
`Retry-After` is honoured when it exceeds the computed backoff, capped by the
policy. Consecutive dead letters trip a circuit breaker that auto-disables the
subscription and emits `integration.webhook.subscription-auto-disabled`; a
success resets the streak. Paused endpoints keep their queue instead of
dropping it, and a disabled endpoint's queued deliveries are cancelled with a
reason.

## Adapter registry

A *driver* knows how to talk to one kind of external system; a *registration*
is a tenant's configured instance of one. Config is validated against the
driver's declared schema — defaults applied, unknown keys rejected (a typo must
not silently disable a setting), `secret://` references required for anything
credential-shaped.

| Driver | Direction | Notes |
|--------|-----------|-------|
| `http` | outbound | Batched POST to a partner API; per-message rejections reported without failing the batch. |
| `sftp` | bidirectional | ndjson/json/edifact drops; inbound files are consumed once. |
| `s3` | outbound | Batch or one-object-per-message layout. |
| `kafka` | bidirectional | Append-only log with a **cursor**, so pulls resume from an offset. |
| `csv-file` | outbound | Column list of payload paths, delimiter and header configurable. |
| `email` | outbound | `{{path}}` templates for subject and body. |

The drivers are stubs in the sense that they open no socket: each keeps an
in-memory representation of the remote system (a directory, a bucket, a topic
log) so the registry, validation, health tracking, routing and inbox ingestion
run end to end without external dependencies. They are also the seam where a
real client library drops in later — the `AdapterDriver` interface would not
change. Each exposes `simulation` controls (`failNext`, `unhealthy`,
`rejectKeys`, `latencyMs`) for tests.

Health folds into the registration: one bad check is a blip (`degraded`, still
routable), three in a row is an outage (`error`); a good check restores
`connected`. Pulled messages always land in the inbox, so pushed and pulled
traffic share the same de-duplication and retry rules.

## Routing rules

Webhook subscriptions already carry their own patterns, so a route rule covers
everything beyond plain fan-out: pushing to an adapter, re-publishing under a
translated topic (anti-corruption between contexts), or reshaping a payload for
one consumer. Rules are evaluated highest `priority` first, then by pattern
specificity, then by age, which makes overlapping rules deterministic.

**Filters** narrow by content on dotted paths — `eq`, `neq`, `in`, `nin`,
`exists`, `missing`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts-with`,
`matches` — combined with `all` / `any` / `none`.

**Transforms** are data, never code, since operators edit them and they live in
the database:

```jsonc
{
  "fields": {
    "messageType": { "const": "ORDER_CREATE" },
    "reference":   { "path": "payload.orderId" },
    "summary":     { "template": "{{payload.orderId}}: {{payload.total.amount}}" },
    "amounts":     { "fields": { "gross": { "path": "payload.total.amount" } } },
    "items":       { "each": "payload.lines", "item": { "path": "it.sku" } }
  }
}
```

`POST /routes/preview` dry-runs an event against the table without recording a
match.

## HTTP API

Every route except `/health` and `/adapters/drivers` requires `x-tenant-id` and
`x-user-id` headers. `DomainError` maps to its status code; the raw request
body is preserved so inbound signatures can be verified over the exact bytes.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/outbox`, `/outbox/batch` | Ingest events from a domain service |
| `GET` | `/outbox`, `/outbox/stats`, `/outbox/:id` | Inspect the queue |
| `POST` | `/outbox/:id/replay`, `/outbox/:id/dead-letter`, `/outbox/replay-dead-letters` | Operator actions |
| `POST` | `/relay/run`, `/relay/drain` | Run the relay synchronously |
| `POST` | `/inbox`, `/inbox/:id/process`, `/inbox/process-due`, `/inbox/:id/discard`, `/inbox/:id/replay` | Inbound messages |
| `POST` | `/idempotency/begin`, `/complete`, `/fail`, `/purge-expired` | Drive the key state machine explicitly |
| `POST` | `/webhooks`, `/webhooks/:id/{pause,resume,disable,enable,rotate-secret,ping}` | Subscription lifecycle |
| `GET` | `/webhooks`, `/webhooks/:id`, `/webhooks/:id/deliveries`, `/webhooks/:id/stats` | Subscription reads |
| `GET`/`POST` | `/deliveries`, `/deliveries/dispatch`, `/deliveries/:id/{retry,cancel}`, `/deliveries/retry-dead-letters` | Delivery queue |
| `GET`/`POST` | `/adapters/drivers`, `/adapters`, `/adapters/:id/{test,enable,disable,send,pull}`, `PATCH /adapters/:id/config` | Adapter registry |
| `GET`/`POST` | `/routes`, `/routes/:id`, `/routes/:id/{enable,disable}`, `/routes/preview` | Routing rules |
| `GET` | `/health`, `/metrics` | Liveness and queue depths |

`npm start` also runs the relay and the webhook dispatcher on timers
(`RELAY_INTERVAL_MS`, `DISPATCH_INTERVAL_MS`, `PORT`); in a deployment those
would be separate processes sharing the database.

## Events published

The hub is itself a producer — operators build dashboards and alerts from
these. Full catalog in `domain/events.ts`:

```
integration.outbox.{enqueued,published,failed,dead-lettered,replayed}
integration.inbox.{received,duplicate-ignored,processed,failed,discarded}
integration.idempotency.{reserved,completed,replay-served,conflict}
integration.webhook.{subscription-created,subscription-updated,subscription-paused,
                     subscription-resumed,subscription-disabled,
                     subscription-auto-disabled,secret-rotated}
integration.webhook.{delivery-scheduled,delivery-succeeded,delivery-retry-scheduled,
                     delivery-dead-lettered,delivery-cancelled}
integration.adapter.{registered,configured,health-changed,enabled,disabled,
                     messages-sent,messages-pulled}
integration.route.{created,updated,enabled,disabled}
```

## Persistence

`migrations/0001..0008` create the `integration` schema: `outbox_message`,
`inbox_message`, `idempotency_record`, `webhook_subscription` (+
`_pattern`), `webhook_delivery` (+ `_attempt`), `adapter_registration` (+
`adapter_cursor`) and `route_rule` (+ `_pattern`). Every table is
tenant-scoped, carries `version` for optimistic concurrency via the shared
`touch_row` trigger, and has partial indexes on the claim/dispatch paths
(`(available_at) WHERE status = 'pending'`) plus the uniqueness constraints the
de-duplication rules depend on.

The shipped repositories are in-memory implementations of the same interfaces,
which is what lets the whole hub — relay, retries, circuit breakers, adapters —
be tested deterministically.

## Determinism in tests

Everything time-driven goes through the `Clock` port: `FixedClock.advance(ms)`
decides when a backoff elapses, a lease expires or a key TTL runs out.
`RecordingWebhookTransport` scripts responses (`enqueue`, `always`) and records
every request, `SequentialSecretGenerator` makes secrets predictable, and
`recordEvents: true` on the module captures every published envelope.

```ts
const h = harness();
await activeWebhook(h, { patterns: ["quality.**"], maxAttempts: 3 });
h.transport.enqueue({ status: 503 }, { networkError: "ECONNRESET" }, { status: 200 });

await h.hub.services.outbox.enqueue(h.ctx, { source: "quality-qms", event: ncrOpened(h.ctx) });
await h.hub.services.relay.runOnce();

await h.hub.services.deliveries.dispatchDue();   // 503 -> retry in 1s
h.clock.advance(1_000);
await h.hub.services.deliveries.dispatchDue();   // network error -> retry in 4s
h.clock.advance(4_000);
await h.hub.services.deliveries.dispatchDue();   // delivered
```

## Scripts

```
npm run build      # tsc -b
npm run typecheck  # includes tests
npm test           # node --test with tsx
npm start          # HTTP API + relay/dispatch loops
```
