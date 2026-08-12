# @enterprise-suite/event-bus

Shared publish/subscribe library for the enterprise suite. Domain services
append `EventEnvelope`s to their transactional outbox; `integration-hub`
relays them onto a bus instance built from this package, and any in-process
consumer (projections, policies, webhook fan-out) subscribes with a topic
pattern.

The package has no runtime dependency beyond `@enterprise-suite/shared-kernel`
and ships an in-memory transport. The `EventBus` interface is the seam for a
later NATS/Kafka/Postgres transport.

## Topic patterns

Event types are dot-separated segments (`quality.ncr.opened`,
`sales.order.line-added`). Patterns add two wildcards:

| Pattern | Matches |
|---------|---------|
| `quality.ncr.opened` | that event type only |
| `quality.*.opened` | `quality.ncr.opened`, `quality.audit.opened` — exactly one segment |
| `quality.**` | `quality.ncr.opened`, `quality.capa.created`, and bare `quality` — zero or more segments |
| `**.opened` | any event whose last segment is `opened` |
| `**` | everything |

`TopicRouter<T>` indexes patterns in a prefix tree, so a publish only visits
the branches that can match instead of testing every subscription. Matches
come back deduplicated and in registration order. `patternSpecificity()`
ranks literal > `*` > `**` for ordering overlapping routing rules.

## Bus semantics

```ts
const bus = new InMemoryEventBus({ retry: retryPolicy({ maxAttempts: 5 }) });

const subscription = bus.subscribe(
  ["quality.ncr.**", "quality.capa.closed"],
  async (event, context) => {
    if (context.isRedelivery) log.warn("redelivery", { attempt: context.attempt });
    await projections.apply(event);
  },
  { name: "quality-projections", tenantId },
);

await bus.publish(event);
await bus.drain();          // waits for queued + in-flight deliveries
```

- **Ordered per subscriber.** Every subscription owns a FIFO queue drained one
  event at a time, so handlers observe publish order.
- **Isolated.** A slow or throwing subscriber cannot block or fail another;
  `publish` resolves as soon as the event is queued.
- **At-least-once within the process.** A throwing handler is retried under
  the subscription's retry policy; the same envelope is redelivered with an
  incremented `context.attempt`, so handlers must be idempotent.
- **Nothing is dropped silently.** Exhausted retries produce a `DeadLetter`
  (event, subscription, attempts, error) in the sink; `bus.deadLetters` is the
  default in-memory queue with `list`/`take`/`purge` for replay tooling.
- **Backpressure.** `maxQueueDepth` caps a subscription's queue; overflow
  discards the oldest event and increments the `dropped` counter rather than
  growing without bound.
- **Pause/resume.** A paused subscription keeps queueing and flushes in order
  on `resume()` — used when a downstream system is in maintenance.
- **Filters.** `tenantId` and an arbitrary `filter` predicate are applied
  after topic matching.

## Retry policies

`RetryPolicy` is capped exponential backoff with optional jitter:

```
delay(attempt) = min(maxDelayMs, initialDelayMs * multiplier^(attempt-1))
jitter: "none" | "full" (0..delay) | "equal" (delay/2..delay)
```

`DEFAULT_RETRY_POLICY` (3 attempts, 50ms base) suits in-process handlers;
`NETWORK_RETRY_POLICY` (8 attempts, 1s base, ×5, 10 min cap, equal jitter)
suits webhook and adapter delivery. `retrySchedule()` renders the whole
deterministic ladder, `maxTotalDelayMs()` its sum.

## Middleware

Publish-side middleware can observe, rewrite or veto an event by not calling
`next`: `loggingMiddleware`, `filterMiddleware`, `requireTenantMiddleware`,
`correlationMiddleware`, `tenantScopeMiddleware`, `tapMiddleware`. Replay
tooling can skip the chain with `publish(event, { bypassMiddleware: true })`.

## Time control

Retry backoff goes through a `Scheduler` port:

- `TimerScheduler` — production, unref'd `setTimeout` so pending retries never
  keep the process alive.
- `ImmediateScheduler` — runs callbacks on the microtask queue but records the
  requested delays; keeps retry-heavy tests instant.
- `ManualScheduler` — virtual clock; `advanceBy(ms)` / `runAll()` decide when
  retries fire, so backoff timing is assertable.

## Metrics

`bus.metrics()` returns published / delivered / failedAttempts / retried /
deadLettered / dropped counters plus per-event-type and per-subscription
breakdowns. `subscription.stats()` gives the same view for one subscriber
including current queue depth.

## Testing helpers

`collect(bus, pattern)` records everything a pattern sees, `flakyHandler(n)`
fails its first `n` invocations, `testEvent(type, payload)` builds an envelope.

## Scripts

```
npm run build      # tsc -b
npm run typecheck
npm test           # node --test with tsx
```
