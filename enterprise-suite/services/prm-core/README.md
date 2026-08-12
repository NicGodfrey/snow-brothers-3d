# @enterprise-suite/prm-core

Partner relationship management core: the record of truth for **who your
partners are** and **what they are entitled to**. Owns the partner master and
its onboarding state machine, the tier program and its qualification engine,
partner contracts, market development funds (budgets → requests → claims),
partner enablement (courses, exams, certifications), and the portal identity /
entitlement model.

`channel-prm` is the transactional side of the channel (deal registration,
pipeline, co-sell); it consumes partner, tier and contract facts from here.
The two can share a database: every table in this package is prefixed `prmc_`.

## Domain model

| Concept | Shape | Key invariants |
| --- | --- | --- |
| **Partner** | Aggregate | Number `PRT-00001` and legal name unique per tenant; `prospect → applied → in_review → approved/rejected → active → suspended ⇄ active → terminated`; an application needs a primary contact and an HQ address; activation needs an effective trading contract; only distributors may parent a tier-2 partner; at most one primary contact and one HQ address; termination clears the tier and demands a reason. |
| **TierDefinition** | Record + pure engine | Code and rank unique per tenant (ranks are sparse: 10/20/30/40); requirements are *additive* — trailing revenue, certified individuals, named certifications, deals won, months active, signed contract — so revenue cannot buy past a certification bar; `evaluateTier` returns the qualification per tier plus the gaps blocking the next one. |
| **PerformanceSnapshot** | Record | One row per partner per fiscal period (`FY26-Q1`), re-stating a period replaces it; `dealsWon ≤ dealsRegistered`; `trailingPerformance` sums only the periods fully inside the trailing window, in the partner's currency. |
| **PartnerContract** | Aggregate | `draft → pending_signature → active → expired \| terminated`, plus `cancelled`; both parties must sign and the same mailbox may not sign both sides; **one active trading contract** (reseller/distribution/msp/referral) per partner — NDAs and MDF terms sit alongside; discount resolution is "exact scope, else `*`, else base"; obligations are `pending → met/waived/breached` with evidence; amendments are numbered and keep the previous discount and end date. |
| **MdfBudget** | Aggregate (allocations inside) | `draft → open → closed`; one allocation per partner, topped up rather than duplicated; the ledger invariant is `committed + paid ≤ allocated`; approval **commits**, payment **settles** (committed → paid), closing a request **releases** the unclaimed remainder; a budget cannot close while money is committed. |
| **MdfRequest** | Aggregate | `draft → submitted → approved/rejected/cancelled → closed`; activity must fall inside the budget's fiscal period; the partner's matching contribution is derived from the budget's matching rate; approving less than requested requires a reason; approval sets the claim deadline (`activityEnd + claimWindowDays`); the requester may not approve. |
| **MdfClaim** | Aggregate | `draft → submitted → in_review → approved/rejected → paid`; submission needs at least one invoice/receipt **and** one proof of performance, and the documented spend must cover the amount claimed; late claims are refused against the deadline; short payment needs a reason; payment records the AP reference. |
| **Course / CertificationDefinition** | Records | Codes unique and normalised per tenant; prerequisite graph rejects self-reference; enrollments pin the course version, passing score and attempt limit, so changing the catalog cannot retroactively fail somebody. |
| **Enrollment** | Aggregate | `enrolled → in_progress → completed \| failed \| withdrawn`; one *open* enrollment per person per course (completed rows do not block a retake — that is how recertification works); attempts are capped, and a reset is an explicit, reasoned act. |
| **Certification** | Aggregate | Held by a person, counted at the partner; awarded only when every required course is passed; renewal inside the window requires fresh coursework and always pushes the expiry out; expiry is a sweep, revocation needs a reason. |
| **PortalUser** | Aggregate | One identity per mailbox per tenant, email normalised; `invited → active → disabled ⇄ active`; the invite token is never stored, only a reference; a partner cannot be left without a portal admin. |
| **Entitlement** | Definition + grants + pure resolver | Access is *resolved*, not stored: a definition carries a policy (tier rank, roles, user/partner certifications, contract types, partner statuses) and grants hold only deliberate overrides. Deny beats allow beats policy; grants expire and are revoked, never deleted; every denial comes back with the reasons that produced it. |

The tier engine, the entitlement resolver and the trailing-performance
calculation are pure functions over facts, so they are testable without a
repository and reusable by a read model.

## Layout

```
src/domain/          aggregates, value objects, state machines, pure engines
src/application/     use-case services + ports (repos, outbox, clock, tokens)
src/infrastructure/  in-memory adapters, composition root, demo seed
src/http/            dependency-free router, validation, route modules
migrations/          Postgres DDL mirroring the domain invariants
tests/               node:test suites (unit + full HTTP integration)
```

Repositories are interfaces (`application/ports.ts`); the in-memory adapters
are single-process stand-ins, and the SQL migrations encode the same rules for
a later Postgres adapter — partial unique indexes for "one active trading
contract" and "one open enrollment", a check constraint for the MDF ledger,
and status/timestamp checks that make an illegal row unrepresentable. Domain
events use the shared-kernel envelope and flow through a transactional-outbox
stand-in; `GET /events` exposes the tenant's stream and `0007_outbox.sql` is
the table a relay would drain.

## HTTP API

Multi-tenancy via headers: `x-tenant-id` (required except on `/health`),
`x-user-id`, `x-roles`. `x-user-id` is what the segregation-of-duties checks
compare, so the person who submits an MDF request cannot approve it by
switching roles.

- `GET /health`, `GET /events?type=&aggregateId=`
- `POST|GET /partners`, `GET|PATCH /partners/:id`, `GET /partners/:id/hierarchy|overview`
- `POST /partners/:id/contacts|addresses|territories` (+ `DELETE`, `POST .../contacts/:id/primary`)
- `POST /partners/:id/application|review|approve|reject|activate|suspend|reinstate|terminate`
- `POST|GET /partners/:id/performance`
- `GET|POST /tiers`, `POST /tiers/install-standard`, `POST /tier-reviews`
- `GET /partners/:id/tier-evaluation|tier-facts|tier-benefits`, `POST /partners/:id/tier[/auto]`
- `POST|GET /contracts`, `GET /contracts/:id`, `PATCH /contracts/:id`,
  `POST /contracts/:id/send|sign|activate|cancel|renew|terminate|amendments`,
  `POST|DELETE /contracts/:id/discount-lines[/:lineId]`,
  `POST /contracts/:id/obligations[/:code]`, `POST /contract-sweeps`
- `GET /partners/:id/contracts|pricing?scope=`
- `POST|GET /mdf/budgets`, `GET /mdf/budgets/:id`,
  `POST /mdf/budgets/:id/open|top-up|close|allocations`,
  `PATCH /mdf/budgets/:id/allocations/:allocationId`
- `GET /partners/:id/mdf/balance|eligibility`
- `POST|GET /mdf/requests`, `GET|PATCH /mdf/requests/:id`,
  `POST /mdf/requests/:id/submit|approve|reject|cancel|close`
- `POST|GET /mdf/claims`, `GET /mdf/claims/:id`,
  `POST|DELETE /mdf/claims/:id/proofs[/:proofId]`,
  `POST /mdf/claims/:id/submit|review|approve|reject|pay`
- `POST|GET /courses`, `GET /courses/:code`, `POST /courses/:code/retire`,
  `POST|GET /certification-definitions`
- `POST|GET /enrollments`, `GET /enrollments/:id`,
  `POST /enrollments/:id/start|attempts|reset|withdraw`
- `POST|GET /certifications`, `GET /certifications/:id`,
  `POST /certifications/:id/renew|revoke`, `POST /certification-sweeps`,
  `GET /partners/:id/certifications`, `GET /portal-users/:id/transcript`
- `POST|GET /portal-users`, `GET|PATCH /portal-users/:id`,
  `POST /portal-users/:id/invite-resend|accept-invite|logins|disable|enable`,
  `PUT /portal-users/:id/roles`, `GET|POST /partners/:id/portal-users[/disable-all]`
- `POST|GET /entitlements`, `POST /entitlements/standard-catalog`,
  `POST|GET|DELETE /entitlement-grants[/:id]`,
  `GET /portal-users/:id/entitlements[?code=]|entitlement-facts|menu`,
  `GET /partners/:id/entitlements|entitlement-facts`

Errors carry a stable code: `VALIDATION` (400), `ENTITLEMENT_DENIED` (403),
`NOT_FOUND` (404), `CONFLICT` (409), and the 422 family — `INVALID_STATE`,
`SEGREGATION_OF_DUTIES`, `TIER_INELIGIBLE`, `MDF_BUDGET_EXHAUSTED`,
`MDF_CLAIM_WINDOW_CLOSED`, `CERTIFICATION_REQUIREMENTS_NOT_MET`,
`CURRENCY_MISMATCH`.

## Run it

```bash
npm run build      # tsc -b (builds the shared-kernel reference too)
npm test           # 88 node:test cases, includes the HTTP integration suite
npm run typecheck  # src + tests
npm run dev        # seeded demo server on :3017 (PRM_SEED=false to skip)
```

The seed builds a small channel program: a DACH distributor (Northwind), its
tier-2 VAR (Contoso, Gold, four quarters of revenue, three certified people,
a paid webinar claim and a trade-show request awaiting approval), a referral
partner, and an applicant still in review with a time-boxed entitlement
override.

```bash
curl -s -H 'x-tenant-id: demo' localhost:3017/partners
curl -s -H 'x-tenant-id: demo' localhost:3017/partners/<contosoId>/overview
curl -s -H 'x-tenant-id: demo' localhost:3017/partners/<contosoId>/tier-evaluation
curl -s -H 'x-tenant-id: demo' localhost:3017/partners/<contosoId>/mdf/balance
curl -s -H 'x-tenant-id: demo' localhost:3017/portal-users/<adaId>/menu
curl -s -H 'x-tenant-id: demo' -H 'x-user-id: channel-manager' \
     -X POST localhost:3017/mdf/requests/<requestId>/approve \
     -d '{"approvedAmount":{"amountMinor":2000000,"currency":"USD"},"notes":"Booth only"}'
```

## Design notes

- **Money is a ledger, not a number.** MDF amounts live as integer minor units
  with an ISO currency, and the budget allocation carries the three buckets
  (allocated / committed / paid) that every state transition moves between.
  Approval, payment, release and close are the only ways money moves, so
  "what has this partner actually been paid?" is answerable from one row and
  cannot drift from the claims that justify it.
- **Entitlements are resolved, not stored.** A partner's access is a function
  of facts that change on their own — tier, contract, certification, status —
  so caching it as an ACL would go stale silently. Overrides are explicit,
  reasoned, expiring and revocable, and a denial always explains itself, which
  is what turns "you don't have access" into "reach Silver and sign the
  reseller agreement".
- **Segregation of duties is a domain rule.** The requester cannot approve the
  request, the submitter cannot review their own claim, and one mailbox cannot
  countersign both sides of a contract. These live in the aggregates rather
  than in a middleware, because they are the reason the audit trail is worth
  anything.
- **Certifications belong to people, partner tiers to companies.** The same
  credential is counted two ways — an individual holds it, the partner is
  scored on how many individuals hold it — which is why the certification row
  carries both ids and why revoking one person's credential can move a
  partner's tier.
- **Deterministic tests.** Every service takes a `Clock` port and the token
  issuer is injectable; tests use a fixed clock to drive claim windows,
  certification expiry and contract effectivity without sleeping.
