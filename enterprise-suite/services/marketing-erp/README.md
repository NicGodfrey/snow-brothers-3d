# @enterprise-suite/marketing-erp

Marketing bounded context for the enterprise suite: campaigns, channels,
segments/audiences, leads with scoring and Sales handoff, content assets,
simulated email/SMS sends, multi-touch attribution, budgets/ROI, and UTM
tracking. TypeScript ESM, built on `@enterprise-suite/shared-kernel`
(entities, event envelopes, money, tenant context).

## Layout

```
src/
  domain/           aggregates, value objects, pure domain logic
  application/      use-case services, ports (repos/clock/outbox/sender), DTOs
  infrastructure/   in-memory repos, outbox, clocks, simulated sender, demo seed
  http/             router, tenant-context parsing, REST handlers, node:http server
migrations/         PostgreSQL DDL mirroring the domain model
tests/              node:test suites (domain, services, HTTP end-to-end)
```

## Domain model

| Aggregate | Highlights |
| --- | --- |
| `Channel` | kind (email/sms/paid_search/…), cost model (cpc/cpm/cpa/flat), activation |
| `Campaign` | guarded lifecycle `draft → scheduled → active → paused → completed → archived`, channel/segment assignment, UTM defaults (utm_campaign = campaign code) |
| `Segment` | dynamic (JSON rule AST: and/or/not + field conditions) or static membership; validated, evaluable, describable |
| `Audience` | immutable snapshot of segment membership with consent + suppression applied per channel |
| `Lead` | funnel stages `subscriber → lead → mql → sql → opportunity → customer` (+ disqualified), activity stream, per-channel consent, tags, enrichment |
| `ScoringModel` | activity weights with exponential time decay (half-life), demographic fit rules, MQL/SQL thresholds, A–D grading |
| `ContentAsset` | email/SMS templates and other assets, review workflow, revisions, `{{variable}}` rendering |
| `SendJob` | queued/running/completed lifecycle, per-recipient delivery records, open/click/unsubscribe stats |
| `Touchpoint` | append-only attribution facts (capture, clicks, opens, webinars, …) |
| `TrackedLink` | short-code links stamped with UTM params; clicks become touchpoints |
| `CampaignBudget` | spend ledger by channel/category, overspend guard, warn-threshold event, ROI/ROAS/CPL/CPA math |

### Attribution

`src/domain/attribution.ts` implements **first_touch**, **last_touch**,
**linear**, and **position_based** (40/20/40) models as pure functions.
Conversion value is split in integer minor units with a largest-remainder
scheme, so credit always sums exactly to the conversion value. Reports
aggregate credited revenue per campaign and per channel;
`AttributionService.compareModels` returns all models side by side.

### Lead → Opportunity handoff

`HandoffService.handOff` converts an SQL lead into an opportunity and builds
`LeadOpportunityHandoffDto` (`src/application/dto.ts`): contact + company,
qualification (score/grade/source/tags), estimated value, per-campaign
attribution slices, and the first-touch source campaign. The same information
is emitted as the `marketing.lead.handed-off.v1` event for the Sales context.
Sales replies with `HandoffAcknowledgementDto`; won deals close the loop via
`recordDealWon`, which feeds actual revenue back into attribution.

## HTTP API

Identity comes from gateway headers `x-tenant-id`, `x-user-id`, `x-roles`.
Every route is tenant-scoped. Selected routes:

```
POST /channels                          POST /campaigns
POST /campaigns/:id/activate|pause|complete|archive|schedule
POST /campaigns/:id/channels            GET  /campaigns/:id/roi?model=linear
POST /segments                          GET  /segments/:id/preview
POST /audiences                         POST /content-assets
POST /content-assets/:id/submit|approve|reject|retire|revise|preview
POST /leads                             POST /leads/:id/activities
POST /leads/:id/handoff                 POST /leads/:id/deal-won
POST /handoffs/acknowledge              GET  /leads/:id/timeline
GET  /scoring/model                     POST /scoring/rescore-all
POST /send-jobs                         POST /send-jobs/:id/queue|run|cancel
GET  /attribution/report?model=…        GET  /attribution/compare
POST /budgets                           POST /budgets/:id/spend
GET  /roi/portfolio?model=…             GET  /funnel
POST /tracked-links                     GET  /t/:code   (302 redirect + click)
POST /utm/parse                         POST /utm/build
```

## Events

All aggregates raise versioned events (`marketing.*.v1`) through the
shared-kernel envelope; services push them to the transactional outbox
(`InMemoryOutbox`), which relays in publish order — swap in the Postgres
outbox table from `migrations/0010_outbox.sql` without changing semantics.

## Simulated delivery

`SimulatedMessageSender` models per-channel funnels (delivery, open, click,
unsubscribe) with a seeded PRNG keyed on `(jobId, recipient)`: realistic
aggregate rates, fully deterministic runs. `ScriptedMessageSender` lets tests
pin exact outcomes.

## Running

```bash
npm run build      # tsc → dist/
npm run typecheck  # src + tests, no emit
npm run test       # node:test via tsx
npm run demo       # seeded tenant: attribution comparison, ROI, funnel, send stats
npm run serve      # HTTP server on :3040 (PORT env to override)
```

The demo/demo seed (`src/infrastructure/seed.ts`) builds a full sample
tenant — 5 channels, 2 budgeted campaigns, 6 leads with multi-touch journeys,
an executed email send, and 2 handoffs (1 closed-won) — and is also exercised
by `tests/seed.test.ts` to pin attribution and ROI invariants.
