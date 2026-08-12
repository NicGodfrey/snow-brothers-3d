# @enterprise-suite/channel-prm

Partner relationship management for an indirect sales channel: the system of
record for **who is allowed to sell what to whom, and for how long**. Owns
partner authorization and tier policy, deal registration with protection
windows, opportunity referrals with attribution and commission, channel
quotes/orders that reference sales-ERP documents, channel-conflict
adjudication, and the partner pipeline analytics the channel team runs on.

The organising idea is the **protection window**. Approval of a registration
mints a half-open interval `[startsAt, endsAt)` during which that partner —
and nobody else — may work that customer for those product lines. Everything
downstream reads the window rather than the status, because "approved"
outlives the exclusivity it granted: a registration approved 200 days ago is
still `approved`, but its protection has lapsed, so a rival registration is no
longer a blocking conflict and special pricing falls back to the tier's base
discount.

## Domain model

| Concept | Shape | Key invariants |
| --- | --- | --- |
| **Partner** | Aggregate | Code unique per tenant; `onboarding → active ⇄ suspended → terminated` (terminated is final); territories and product lines are the authorization grants every other command checks; referral agents (`canTransact === false`) may introduce deals but never register, quote or order; tier is snapshotted onto a registration at approval so later tier moves never rewrite history. |
| **TierPolicy** | Per-tenant record, one per tier | Single source of protection days, extension head-room, approval/conflict SLA, the three-step discount band, referral commission and the auto-approval threshold. Validated as a whole: `baseDiscountBps ≤ registeredDiscountBps ≤ maxDiscountBps`, so registering a deal is always worth more than not registering it. |
| **DealRegistration** | Aggregate | `draft → submitted → under_review → approved` with `rejected`/`withdrawn`/`expired`/`closed_won`/`closed_lost`; product lines freeze at submission; approval mints protection and the registered discount, both capped by the tier; extensions are capped in count *and* days and run from the window's current end, never compounding; a lapsed window can be revived inside the tier's grace period but restarts from the grant instant; cannot be approved while a conflict case is open against it. |
| **ProtectionWindow** | Value object | Half-open interval, so back-to-back windows never double-cover a day; `remainingDays` rounds up (a window ending tonight has 1 day left, not 0); truncation can only shorten. |
| **Referral** | Aggregate | `submitted → accepted → converted → closed_won/closed_lost`, plus `rejected`/`expired`; acceptance opens an **attribution** window and fixes the commission rate (capped by tier); conversion goes either to a deal registration a transacting partner runs, or to a vendor-run opportunity the agent keeps attribution on; commission accrues on realised value and moves `accrued → approved → paid`, with payment refused until approval. |
| **ChannelQuote** | Aggregate | `draft → submitted → approved/rejected → ordered`, plus `expired`/`superseded`; lines carry list, requested and approved unit prices, so the concession against the partner's ask is always recoverable; discount authority is the tier's base band for an unregistered quote and the full registered band for one attached to a live protection window; an ask inside the band the approval already promised auto-approves; a counter-offer may come back thinner than the ask but never richer, because margin the partner never asked for should not leak out of an approval screen; revision supersedes the original into a fresh draft. |
| **ChannelOrder** | Aggregate | One channel order per sales-ERP order reference per tenant; consuming an approved quote closes the registration as won at the ordered value; `placed → invoiced → fulfilled` with cancellation refused after fulfilment; `bookedValue` is zero once cancelled, which is what keeps attainment and analytics honest. |
| **ConflictCase** | Aggregate | Raised automatically on submission when detection finds a blocking collision; `open → under_review → resolved`, plus `withdrawn`; carries the scored recommendation, both parties' evidence and an SLA clock that halves on escalation; resolution is what applies the outcome to the registrations, not a separate call. |

### Conflict detection and adjudication

Detection (`domain/conflict.ts`, pure) compares a candidate registration
against every registration on the same **customer key** and returns findings:

- `duplicate_registration` — same partner, same customer, still open. Blocking.
- `partner_vs_partner` — another partner holds live protection over an
  overlapping product line. Blocking while the window is live, **advisory**
  once it has lapsed.
- `partner_vs_direct` — the customer is a house account. Always blocking.

Customer identity is deliberately not the free-text name: `customerKey` prefers
a verified company domain (`domain:contoso.com`, public mailbox providers
rejected) and falls back to a country-scoped, legal-suffix-stripped slug
(`name:us/contoso-manufacturing`), so "Contoso Manufacturing" and "Contoso
Manufacturing GmbH" collide the way a channel manager would expect them to.

Adjudication scores each claim on stage, documents in flight (quotes/orders),
live protection and staleness. First-to-register is the default and only loses
by a decisive margin (≥ 25 points); a close call becomes `co_sell` rather than
a coin flip. Outcomes — `incumbent_upheld`, `claimant_awarded`, `co_sell`,
`split` (requires a claimant share in bps), `both_rejected` — are applied to
the underlying registrations when the case resolves.

### Analytics

`domain/pipeline.ts` is pure functions over flat records; `AnalyticsService`
only projects aggregates into those records and takes one snapshot per request
so every figure in a response describes the same instant. Reports: pipeline by
stage (with weighted value and share), forecast roll-up by category, per-partner
and per-tier performance (win rate, approval rate, cycle days, booked value),
the referral→registration→quote→order→won funnel, protection-expiry buckets
with at-risk value, sourced vs. vendor-sourced revenue split, submission
cohorts by month or quarter, explainable partner scorecards out of 100, and
hygiene (deals idle past their stage tolerance, deals past their close date).

Money never crosses currencies silently: a report is computed in one currency
and tells you how many records it excluded (`excludedByCurrency`) rather than
inventing an FX rate.

## Layout

```
src/domain/          aggregates, value objects, state machines, pure roll-ups
src/application/     use-case services + ports (repos, sequences, outbox, clock)
src/infrastructure/  in-memory adapters, composition root, demo seed
src/http/            dependency-free router, validation, route modules
migrations/          Postgres DDL mirroring the domain invariants
tests/               node:test suites (unit + full HTTP integration)
```

Repositories are interfaces (`application/ports.ts`); the in-memory adapters
are single-process stand-ins. The SQL migrations encode the same rules for a
later Postgres adapter — `CHECK` constraints for every state machine and money
sign, a partial unique index so at most one conflict case is open per
claimant/incumbent pair, unique sales-order references, and analytics views
(`prm_v_open_pipeline`, `prm_v_active_protection`, `prm_v_partner_performance`,
`prm_v_source_split`, `prm_v_registration_cohorts`) that mirror the in-process
roll-ups.

Domain events use the shared-kernel envelope and are published through an
in-memory transactional-outbox stand-in; a `Publisher` collects pending events
from every aggregate a use case touched and writes them in one call, so a
multi-aggregate command (resolve a conflict → reject one registration and
truncate another) publishes atomically. `GET /events` exposes the tenant's
stream. The catalog is namespaced `prm.<aggregate>.<event>` — 45 types across
partner, deal-registration, referral, channel-quote, channel-order and
conflict.

## HTTP API

Multi-tenancy via headers: `x-tenant-id` (required except on `/health`),
`x-user-id`, `x-roles`.

- `GET /health`, `GET /events?type=`
- `POST|GET /partners`, `GET /partners/:idOrCode`,
  `POST /partners/:id/activate|suspend|terminate|tier`,
  `PUT /partners/:id/authorizations`, `GET /partners/:id/attainment`
- `GET /tier-policies`, `PUT /tier-policies/:tier`
- `POST /deal-registrations/precheck` (eligibility + conflicts, writes nothing)
- `POST|GET /deal-registrations`, `GET|PATCH /deal-registrations/:id`,
  `POST /deal-registrations/:id/submit|review|approve|reject|withdraw`,
  `POST /deal-registrations/:id/forecast|extend-protection|win|lose|expire`,
  `GET /deal-registrations/:id/conflicts|quotes|orders`
- `POST|GET /referrals`, `GET /referrals/:id`,
  `POST /referrals/:id/accept|reject|convert|hand-off|win|lose`,
  `POST /referrals/:id/commission/approve|pay`, `GET /commission-ledger`
- `POST|GET /channel-quotes`, `GET /channel-quotes/:id`,
  `POST|PATCH|DELETE /channel-quotes/:id/lines[/:lineId]`,
  `POST /channel-quotes/:id/submit|approve|reject|revise`
- `POST|GET /channel-orders`, `GET /channel-orders/:id`,
  `POST /channel-orders/:id/invoice|fulfill|cancel`
- `GET /conflicts`, `GET /conflicts/:id`,
  `POST /conflicts/:id/evidence|review|escalate|resolve|withdraw`,
  `GET|POST /house-accounts`, `DELETE /house-accounts/:customerKey`
- `GET /analytics/pipeline|forecast|partners|tiers|funnel`,
  `GET /analytics/protection-expiry|source-split|cohorts|scorecards|hygiene`
- `POST /operations/expiry-sweep` (scheduler entry point)

Errors map to the status the domain declares: `VALIDATION` 400,
`DEAL_CONFLICT` 409 (with the findings on `details`, so a partner portal can
explain the refusal without a second round-trip), `INVALID_STATE`,
`POLICY_VIOLATION` and `CURRENCY_MISMATCH` 422, `NOT_FOUND` 404.

## Run it

```bash
npm run build      # tsc -b (builds the shared-kernel reference too)
npm test           # build + 146 node:test cases, includes HTTP integration
npm run typecheck  # src + tests
npm run dev        # seeded demo server on :3016 (PRM_SEED=false to skip)
```

The seed is a small security-software vendor's channel: a gold reseller takes
Contoso from registration through special pricing to a booked, invoiced order;
a silver reseller walks into that protection and opens a live conflict case
with evidence from both sides; a small deal auto-approves; a platinum deal sits
on a 120-day window so the expiry report has something to show; a referral
agent introduces Umbrella and earns commission; and one protected deal is lost
to a competitor.

```bash
curl -s -H 'x-tenant-id: demo' localhost:3016/deal-registrations
curl -s -H 'x-tenant-id: demo' localhost:3016/conflicts
curl -s -H 'x-tenant-id: demo' localhost:3016/analytics/scorecards
curl -s -H 'x-tenant-id: demo' localhost:3016/analytics/protection-expiry
curl -s -H 'x-tenant-id: demo' -X POST localhost:3016/operations/expiry-sweep
```

## Design notes

- **Two clocks, deliberately.** The shared kernel stamps `updatedAt` from wall
  time; channel reporting needs the *business* clock. `DealRegistration`
  therefore derives `openedAt`/`lastActivityAt` from its own timeline, which is
  written with the injected `Clock`. Aging, cohort and cycle-time figures are
  reproducible as a result, and every service takes the `Clock` port so tests
  advance time by hand.
- **Detection is pure, reaction is not.** `detectConflicts` and
  `recommendOutcome` are functions over flat claims with no I/O, which is what
  makes the pre-check endpoint possible: the portal gets the same verdict the
  submission would produce, without writing anything.
- **Advisory vs. blocking.** A lapsed window still produces a finding — the
  channel team wants to know someone else was there — but it does not stop the
  registration. Conflating the two is what makes deal-registration systems
  hated by partners.
- **Discount authority is derived, never stored on the quote.** It is a
  function of tier policy and the registration's protection *at the moment of
  the request*, so a quote submitted the day protection lapses is priced
  correctly rather than from a stale snapshot.
- **Sourced vs. influenced.** Revenue attribution reads the order's
  `sourceType` and never double-counts a co-sell deal on both sides of the
  split.
