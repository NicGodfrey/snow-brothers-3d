# @enterprise-suite/reporting-bi

Reporting and BI for the enterprise suite: a semantic layer (metrics, cubes,
dimensions), fact ingest from the other contexts' domain events, KPI
snapshots with targets and alerting, dashboards of relative-window tiles, and
CSV/NDJSON export jobs. Multi-tenant, event-emitting, HTTP exposed, with
Postgres migrations describing the persistent shape.

This context is unusual in the suite in that it is mostly a **consumer**: it
owns no business process, it owns a *reading* of everyone else's. That shapes
the design throughout — facts are immutable projections of published events,
never edits; unrecognised events go to a dead-letter queue rather than being
dropped; and every number a dashboard shows can be traced back to the source
event id that produced it.

## Domain model

| Aggregate | Purpose |
|-----------|---------|
| `Dimension` | A hierarchy of members (`product`: family → category → SKU) with labels and attributes. Supplies grouping keys, roll-up, and the labels a chart renders. |
| `CubeDefinition` | The schema of one fact table: which dimensions it carries, which measure fields it stores, its default grain, source event types and retention. Publishing freezes the schema for queries. |
| `MetricDefinition` | Either **base** (an aggregation over one measure field) or **derived** (an expression over other metrics). Carries unit, direction, decimals and lifecycle status. |
| `FactRecord` | An immutable row: an instant, dimension member keys, numeric measures, and a pointer back to the source event. Corrections arrive as new facts, never updates. |
| `KpiDefinition` / `KpiSnapshot` | A metric plus target, thresholds, grain and filter; a snapshot is the computed period value with attainment, status, trend and sparkline. |
| `Dashboard` | Tiles over a 12-column grid, each with a *relative* window ("trailing 12 months") resolved at render time. |
| `ExportJob` | An asynchronous export with a lifecycle, a checksummed artifact and a retention window. |

### Metrics: base and derived

A base metric names an aggregation (`sum`, `avg`, `min`, `max`, `count`,
`count_distinct`, `first`, `last`) over one measure field. A derived metric is
an expression over other metrics of the same cube:

```
average_order_value = safe_div(booked_revenue, orders_booked)
scrap_rate          = safe_div(scrap_output, good_output + scrap_output) * 100
output_per_hour     = safe_div(good_output, labor_hours)   -- derived on derived
```

`domain/expression.ts` is a tokenizer plus recursive-descent parser for that
small language (`+ - * / ( )`, numeric literals, metric references, and the
functions `safe_div`, `coalesce`, `abs`, `sqrt`, `pow`, `round`, `min`, `max`,
`least`, `greatest`). Two rules do most of the work:

- **Derived metrics are evaluated after aggregation, never per fact.** The
  average order value of a month is that month's revenue over that month's
  orders — not the average of per-order values. `resolveEvaluationOrder`
  topologically sorts the metric graph so a metric derived from a derived
  metric still sees resolved inputs.
- **Null propagates and division is safe.** `safe_div` by zero is `null`, not
  `Infinity`, and a null anywhere in an expression yields null. A KPI with no
  data reads "no data", never "0%".

Cycles are rejected at definition time, cross-cube references are rejected,
and a derived metric cannot be published while a dependency is still a draft
or deprecated out from under it.

### Dimensions and roll-up

A query groups by a dimension reference: `customer` is the leaf level,
`customer.segment` rolls each account up to its segment before grouping.
Members missing from a fact collapse into a single `(unknown)` bucket, so a
missing attribute never produces both an empty-string group and a null group
for the same thing.

### Query semantics

`domain/aggregation.ts` executes in SQL's order, and the order is the point:

```
WHERE     time range + dimension filters (roll-ups resolved first)
GROUP BY  period bucket + requested dimension levels
aggregate one accumulator per base metric per group
derive    expression metrics, over aggregated values
HAVING    filters on metric results
ORDER/TOP ranking, "Other" folding, densification
LIMIT     paging, with the pre-limit group count reported back
```

Beyond the basics:

- **Time grains** — hour, day, week (ISO), month, quarter, year. Bucketing,
  labelling, period arithmetic and range enumeration live in
  `domain/time-grain.ts`, and the SQL functions in `migrations/0001` mirror
  them exactly so a pushdown implementation buckets identically.
- **Comparisons** — `previous-period` or `previous-year`. The comparison
  window is scanned in the same pass and its period keys are shifted forward
  so each row carries its own `comparison`, `delta` and `deltaPct`.
- **Top-N** — keeps the N biggest groups and folds the rest into one `Other`
  row, so the slices of a chart still reconcile to the headline total.
  Additive metrics are summed into it; ratios come back null, because the
  ratio of a residual bucket is meaningless. The row always sorts last.
- **Densification** — emits rows for empty periods inside the range, so a
  sparkline has no gaps and a count over an empty bucket is `0` rather than
  unknown.
- **Totals are pre-HAVING and pre-limit**, so a filtered or paged table still
  tells the reader what it is a slice of.

## Fact ingest

`POST /ingest` takes a batch of upstream domain events (raw envelopes off the
bus) and projects each one through the mapping catalog in
`application/mappings.ts`. Per event:

```
1. already seen?        -> duplicate, skip (idempotent on source eventId)
2. no mapping?          -> dead-letter, reason 'no-mapping'
3. mapping returns null -> recognised, intentionally produces no facts
4. mapping throws       -> dead-letter, reason 'mapping-failed'
5. cube schema check    -> unknown dimension/measure: dead-letter
6. append facts, advance the watermark
```

Batch semantics are per-event, never all-or-nothing: one malformed payload out
of a thousand is a dead-letter row, not a transport error, and the response is
a tally the relay can acknowledge against. Idempotency is non-negotiable —
an at-least-once bus will redeliver, and a warehouse that double-counts a
redelivered order is worse than one that is an hour behind.

Mapped contexts and their target cubes:

| Cube | Fed by |
|------|--------|
| `sales_orders` | `sales.order.{confirmed,cancelled,shipped,invoiced}` |
| `sales_pipeline` | `sales.opportunity.{created,stage-changed,won,lost}` |
| `marketing_funnel` | `marketing.{lead.captured,lead.converted,lead.disqualified,send-job.completed,touchpoint.recorded,budget.spend-recorded}.v1` |
| `finance_receivables` | `finance.ar.{invoice-issued,invoice-paid,payment-received,invoice-voided}` |
| `inventory_movements` | `inventory.stock.{received,issued,transferred,adjusted}`, `inventory.cycle-count.completed` |
| `logistics_shipments` | `logistics.shipment.{booked,delivered,exception}`, `logistics.pod.captured` |
| `production_output` | `mes.work-order.{operation-reported,completed}`, `mes.production-receipt.posted`, `mes.scrap.recorded` |
| `quality_inspections` | `quality.inspection-lot.usage-decided`, `quality.ncr.{opened,closed}`, `quality.supplier-event.recorded`, `quality.capa.created` |

Master-data events (`sales.account.created`, `plm.product.created`, …) are
mapped explicitly to *nothing*, which keeps the dead-letter queue meaningful:
everything in it is a genuine surprise.

Conventions the mappings hold to: money is stored in integer minor units in
fields ending `_minor`; each event contributes counter measures
(`orders_confirmed: 1`) so a plain `sum` gives the count; and a fact is
stamped at the instant the thing happened (a late delivery confirmation lands
in the right day), not at publication.

Per-source **watermarks** record the newest event seen and never rewind on
out-of-order delivery, which is what lets a dashboard say "sales data as of
09:42". Retention is per cube and applied by an explicit call, so a scheduler
decides when reclaiming happens.

## KPIs

A snapshot is one dense trailing series at the KPI's grain: the current
bucket is the value, the one before it the comparison, the whole series the
sparkline. Attainment is **direction-normalised** — a lower-is-better KPI
inverts the ratio, so 1.0 means "on target" for a defect rate and for revenue
alike, and one set of threshold bands reads the same way across the whole
scorecard.

```
attainment >= 1              on-track
           >= warning (0.95) watch
           >= critical (0.85) at-risk
           otherwise         off-track
no target -> no-target       no value -> no-data
```

Trends use a dead band (±0.5% by default) so noise is not a trend, and
alerting fires on the *edge*: `reporting.kpi.threshold-breached` on the
transition into an alerting state, `reporting.kpi.recovered` on the way out,
not on every recompute while still unhealthy.

## Dashboards

Tiles store relative windows, never absolute dates, so a dashboard saved in
January is still correct in June with nobody editing it. `groupByPeriod`
distinguishes a grain used as a *grouping key* (a line chart by month) from
one used only as a *window length* (a donut of the last quarter). Rendering
is per tile: a tile whose metric was deprecated out from under it returns an
error payload on that tile and the other eleven panels still draw.

## Export jobs

Exports are jobs, not synchronous downloads: the work is unbounded and the
artifact must stay retrievable and checksummed afterwards.

```
queued -> running -> completed
                  -> failed -> queued (retry, bounded to 3 attempts)
queued | running  -> cancelled
```

Three shapes: `cube-query` (the aggregated table a user is looking at),
`fact-dump` (raw facts with their source event id, for reconciliation against
the emitting service) and `kpi-scorecard`. Both CSV and NDJSON.

`POST /exports/run` is an explicit worker tick rather than a background
thread, so a deployment drives the queue from whatever scheduler it likes, a
test drives it inline, and a small export can be turned around in one
request/response pair.

CSV rendering is RFC 4180, plus the two things shipping CSV to real users
forces on you: cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed
with an apostrophe so Excel treats them as text rather than executing them
(dimension members are untrusted text from upstream systems), and an optional
UTF-8 BOM, because Excel otherwise reads UTF-8 as the local codepage.

## HTTP API

Tenant context comes from headers: `x-tenant-id`, `x-user-id`, `x-roles`
(comma-separated). `/health` and `/` are unauthenticated. Errors are
`{ error: { code, message, details } }` with 400 (validation), 401 (missing
context), 403 (audience), 404 (not found), 409 (state conflict), 422
(definition).

| Area | Endpoints |
|------|-----------|
| Dimensions | `GET/POST /dimensions`, `GET /dimensions/:key`, `GET/POST /dimensions/:key/members` |
| Cubes | `GET/POST /cubes`, `GET /cubes/:name`, `GET /cubes/:name/describe`, `POST /cubes/:name/{dimensions,measures,publish,archive,retention}`, `GET /cubes/:name/lineage` |
| Metrics | `GET/POST /metrics`, `GET/PATCH /metrics/:code`, `POST /metrics/:code/{publish,deprecate}` |
| Ingest | `POST /ingest`, `GET /ingest/{watermarks,dead-letters,mappings}` |
| Query | `POST /query`, `POST /query/scalar` |
| KPIs | `GET/POST /kpis`, `GET /kpis/:code`, `PATCH /kpis/:code/{target,filters}`, `POST /kpis/:code/{retire,snapshot}`, `GET /kpis/:code/history`, `GET /scorecard`, `POST /scorecard/recompute` |
| Dashboards | `GET/POST /dashboards`, `GET /dashboards/:code`, `POST /dashboards/:code/{tiles,publish,archive}`, `PATCH/DELETE /dashboards/:code/tiles/:tileId`, `GET /dashboards/:code/render`, `GET /dashboards/:code/tiles/:tileId/render` |
| Exports | `POST/GET /exports`, `GET /exports/:jobNumber`, `POST /exports/:jobNumber/{cancel,retry}`, `GET /exports/:jobNumber/download`, `POST /exports/run` |
| Diagnostics | `GET /health`, `GET /status`, `GET /outbox`, `POST /outbox/drain`, `POST /admin/install-catalog`, `POST /admin/seed` |

Queries are POSTed rather than URL-encoded: a real query carries a metric
list, dimension references, filters, a having clause and a window, none of
which survives a query string in readable form.

Example:

```bash
curl -s localhost:3111/query \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: demo-tenant' -H 'x-user-id: analyst' \
  -d '{
    "cube": "sales_orders",
    "metrics": ["booked_revenue", "orders_booked", "average_order_value"],
    "dimensions": ["customer.segment"],
    "timeGrain": "month",
    "timeRange": { "from": "2026-01-01", "to": "2026-09-01" },
    "compareTo": "previous-year",
    "topN": { "metric": "booked_revenue", "limit": 5 }
  }'
```

## Domain events

Published through the transactional outbox as shared-kernel `EventEnvelope`s
(payload contracts in `src/domain/events.ts`):

`reporting.metric.{defined,updated,published,deprecated}`,
`reporting.dimension.{registered,members-loaded}`,
`reporting.cube.{defined,published,archived}`,
`reporting.facts.{ingested,rejected,purged}`,
`reporting.kpi.{defined,snapshot-computed,threshold-breached,recovered}`,
`reporting.dashboard.{created,published,archived}`,
`reporting.export.{requested,started,completed,failed,cancelled}`.

## Migrations

Nine migrations under schema `reporting`. Beyond the tables, the interesting
parts are the invariants pushed into the database so they hold for any writer:

- `period_key()` / `bucket_start()` SQL functions mirroring the TypeScript
  grain arithmetic, so pushdown aggregation buckets identically.
- `roll_up()` recursive ancestry walk, and a trigger asserting a member's
  parent sits exactly one level above it.
- `fact_record` partitioned by `occurred_at`, JSONB dimensions/measures with
  GIN indexes, a unique idempotency key on the source event, and a trigger
  that rejects mutation outright.
- Metric dependencies constrained to one cube, with a `metric_lineage` view
  giving the transitive closure.
- A watermark trigger that refuses to move `last_occurred_at` backwards.
- `EXCLUDE USING gist` for dashboard tile overlap, and type-specific tile
  constraints (a KPI tile needs a code, a chart tile a kind).
- The outbox relay table and the per-tenant/year export number series.

## Layout

```
src/
  domain/           metrics, expressions, dimensions, cubes, facts, time
                    grains, the aggregation engine, KPIs, dashboards, export
                    jobs, CSV rendering, events
  application/      metric/dimension/cube/ingest/query/KPI/dashboard/export
                    services, the mapping catalog, ports
  infrastructure/   in-memory repos, outbox, clock, blob store, composition
                    root, the shipped catalog, synthetic seed
  http/             dependency-free router, request validation, serializers,
                    route modules, server, entry point
migrations/         Postgres DDL (schema `reporting`, 9 migrations)
tests/              213 node:test cases (unit, engine, service, HTTP)
```

## Running

```bash
npm run build      # tsc -b (builds the shared-kernel reference too)
npm test           # node --import tsx --test tests/*.test.ts
npm run typecheck  # sources + tests, no emit
npm start          # HTTP server on :3111 (PORT overridable)
```

`npm start` installs the shipped catalog and, unless `REPORTING_SEED=false`,
generates a synthetic warehouse (`REPORTING_SEED_DAYS`, default 120) from a
deterministic RNG — so the endpoints are explorable with real numbers behind
them and no data pipeline attached.

Repositories are in-memory behind narrow interfaces; the migrations define
the Postgres shape a persistent implementation would target, and the
aggregation engine's interfaces are the ones a SQL-backed version needs, so
swapping the store means generating SQL in `selectFacts`/`groupFacts` rather
than rewriting the semantic layer.
