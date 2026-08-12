# @enterprise-suite/srm-core

Supplier relationship management bounded context: everything procurement needs
to know before it may give a supplier work, and everything it learns
afterwards. Owns supplier master data (sites, contacts, banking, panel
assignments), the onboarding workflow, qualifications and certifications,
KPI scorecards over performance periods, supplier contracts with their service
levels, and the risk register with the compliance holds that enforce it.

The single question the rest of the suite asks this service is
`GET /suppliers/:id/eligibility?categoryId=…`: *can we award this supplier this
work today, and if not, exactly why not?*

## Domain model

| Concept | Shape | Key invariants |
| --- | --- | --- |
| **Supplier** | Aggregate | Unique code per tenant; lifecycle `prospect → onboarding → active ⇄ suspended`, plus `blocked`/`rejected`/`inactive`, with an explicit transition table — `active` is only reachable by approving an onboarding case, never by fiat. Exactly one primary site and one primary contact; a trading supplier cannot lose its last operational site; bank account numbers are stored masked and a supplier is payable only once a primary account is verified; diversity flags stay *declared* until the matching certificate is verified. |
| **Category** | Record + tree service | Slug-unique per tenant, materialized `path`, cycle-safe moves that rewrite descendant paths. Carries **sourcing policy** (risk tier, qualification requirement, required certificates, requalification interval) that is *inherited down the tree*, taking the strictest value at each level. |
| **OnboardingCase** | Aggregate | Instantiated from a template (`indirect-low-risk`, `direct-material`, `critical-service`); typed steps with prerequisites, requested documents that materialize into certifications when verified, a scored risk questionnaire, and an approval matrix whose required roles are derived from the computed risk tier. `draft → in_progress → pending_approval → approved/rejected`; approving activates the supplier, materializes its certificates and copies questionnaire risk into the risk register; the case is frozen afterwards. |
| **Qualification** | Aggregate | Audit with weighted sections (quality system, manufacturing, delivery, financial, ESG, infosec, capacity); zero-weight sections drop out, weighted sections must all be scored before completion. Outcome derives from score *and* findings: an open critical finding fails an otherwise perfect audit, an open major one caps it at conditional. Failing places a sourcing hold and raises a quality risk flag; closing the last finding re-rates the audit and lifts the hold it caused. Validity is dated, so `expired` is derived, never drifted into. |
| **Certification** | Aggregate | `pending_verification → valid → expired → valid (renewal)`, plus `rejected`/`revoked`. Dated third-party claim with a renewal chain; a renewal must extend beyond the current expiry; revocation holds sourcing immediately. |
| **Scorecard** | Aggregate | One per supplier per performance period (`2026-Q1`, `2026-05`, `2026`). Mandatory KPIs must be measured before publishing; each measurement is scored by linear interpolation between the KPI's floor and target and banded green/amber/red; the weighted result maps to a rating. `probation` blocks sourcing and demands an improvement plan that must be *completed* before the period can close; `watch` warns. Publishing pushes the same numbers through the supplier's contractual SLAs. |
| **Contract** | Aggregate | Typed (`nda`, `msa`, `framework`, `pricing_agreement`, `sow`, `sla`, `quality_agreement`); `draft → pending_signature → active → expired/terminated/superseded`. Both parties must sign before activation; amendments create revisions rather than mutating a live contract; termination respects the notice period; price lines are quantity-tiered and date-effective, so a quote resolves the tightest break valid on the day. |
| **SLA** | Value objects on Contract | Commitment = metric + target + tolerance + measurement window + penalty model + liability cap. Deviation only counts in the direction that hurts; severity grades by tolerance bands missed; service credits scale with severity, respect a grace allowance and are capped at the negotiated liability; escalations fire on cumulative breach counts. |
| **SupplierRiskProfile** | Aggregate | Risk register scored like a real one — likelihood × impact on 1-5 — where mitigation lowers the *residual* score without erasing the inherent one and a critical risk cannot simply be accepted. Profile score lets the worst open risk dominate while additional risks add pressure. Holds are the enforcement arm: typed by activity (`sourcing`, `purchase_order`, `payment`, `onboarding`, `shipment`), scoped to the supplier, categories or sites, released only by the roles named when placed — except when the system lifts a hold because the fact behind it changed. |

Cross-aggregate rules live in the application services: approving a category
assignment checks the inherited policy, publishing a scorecard evaluates SLAs,
the nightly sweep turns dated facts into holds, and eligibility gathers all of
it into one answer.

## Layout

```
src/domain/          aggregates, value objects, state machines, scoring rules
src/application/     use-case services + ports (repos, outbox, clock)
src/infrastructure/  in-memory adapters, composition root, demo seed
src/http/            dependency-free router, validation, route modules
migrations/          Postgres DDL mirroring the domain invariants
tests/               node:test suites (unit + full HTTP integration)
```

Repositories are interfaces (`application/ports.ts`); the in-memory adapters
are single-process stand-ins and the seven SQL migrations encode the same
constraints for a later Postgres adapter. Domain events use the shared-kernel
envelope and flow through an in-memory transactional-outbox stand-in;
`GET /events` exposes the tenant's stream.

## HTTP API

Multi-tenancy via headers: `x-tenant-id` (required), `x-user-id`, `x-roles`.
Domain errors map to their declared status — a compliance hold surfaces as a
409 carrying the hold ids, a role-gated release as a 403 naming the roles.

- `GET /health`, `GET /events?type=&aggregateId=`
- `POST|GET /categories`, `GET /categories/tree`, `GET /categories/:id/policy|panel`,
  `PATCH /categories/:id`, `POST /categories/:id/move`
- `POST|GET /suppliers`, `GET|PATCH /suppliers/:id`, `GET /suppliers/by-code/:code`,
  `GET /suppliers/:id/overview|group|panel`
- `POST /suppliers/:id/classify|activate|suspend|reinstate|block|unblock|deactivate`
- `POST /suppliers/:id/sites|contacts|bank-accounts|diversity|categories`,
  `POST /suppliers/:id/sites/:siteId/primary|deactivate`,
  `POST /suppliers/:id/bank-accounts/:accountId/verify`,
  `POST /suppliers/:id/categories/:categoryId/approve|restrict`
- `GET /onboarding/templates`, `POST|GET /onboarding`, `GET /onboarding/:id[/progress]`,
  `POST /onboarding/:id/steps[/:code/start|complete|waive]`,
  `POST /onboarding/:id/documents[/:code/receive|verify|reject]`,
  `POST /onboarding/:id/answers|submit|decisions|withdraw`
- `POST|GET /qualifications`, `GET /qualifications/due|:id`,
  `POST /qualifications/:id/start|sections|findings|complete|withdraw`,
  `POST /qualifications/:id/findings/:findingId/close|waive`
- `POST|GET /certifications`, `GET /certifications/:id`,
  `POST /certifications/:id/verify|reject|renew|revoke`
- `POST|GET /kpis`, `PATCH /kpis/:code`, `POST /kpis/seed-standard`,
  `GET /periods[/:code]`
- `POST|GET /scorecards`, `GET /scorecards/:id`,
  `POST /scorecards/:id/measurements|submit|publish|close|actions|dispute`,
  `GET /suppliers/:id/performance/trend`,
  `GET /performance/ranking/:periodCode`, `GET /performance/gaps/:periodCode`
- `POST|GET /contracts`, `GET /contracts/expiring|:id`, `GET /sla-metrics`,
  `POST /contracts/:id/signatories|send-for-signature|sign|activate`,
  `POST /contracts/:id/price-lines`, `GET /suppliers/:id/price-quote?itemCode&quantity`,
  `POST /contracts/:id/commitments|sla-results`,
  `POST /contracts/:id/breaches/:breachId/acknowledge|credit|waive`,
  `POST /contracts/:id/amendments|renew|terminate|supersede`
- `GET /suppliers/:id/risk|holds`, `POST /suppliers/:id/risk/flags[/:flagId/mitigate|accept|close]`,
  `POST /suppliers/:id/holds[/:holdId/release]`,
  `GET /suppliers/:id/clearance/:activity`, `GET /suppliers/:id/eligibility`,
  `GET /risk/heatmap|review-queue`
- Jobs: `POST /jobs/compliance-sweep`, `POST /jobs/contract-term-sweep`

## Run it

```bash
npm run build      # tsc -b (builds the shared-kernel reference too)
npm test           # build + 193 node:test cases, includes HTTP integration
npm run typecheck  # src + tests
npm run dev        # seeded demo server on :3014 (SRM_SEED=false to skip)
```

The seed builds a small but complete tenant: a category tree with real
sourcing policy, five suppliers at different lifecycle stages, an audit that
passed and one that came back conditional, a certificate 45 days from expiry,
two contracts with price tiers and service levels, published scorecards, and a
critical-service onboarding case still in flight.

```bash
curl -s -H 'x-tenant-id: demo' localhost:3014/suppliers?status=active
curl -s -H 'x-tenant-id: demo' "localhost:3014/suppliers/<id>/eligibility?categoryId=<metals>"
curl -s -H 'x-tenant-id: demo' "localhost:3014/suppliers/<id>/price-quote?itemCode=COIL-GALV-1.5&quantity=25000"
curl -s -H 'x-tenant-id: demo' -X POST localhost:3014/jobs/compliance-sweep
curl -s -H 'x-tenant-id: demo' -H 'x-roles: srm.compliance' \
  -X POST localhost:3014/suppliers/<id>/holds -d '{"type":"sourcing","reasonCode":"failed_audit"}'
```

## Design notes

- **Holds are the integration point.** Other bounded contexts do not reimplement
  supplier rules; they call `GET /suppliers/:id/clearance/:activity` before
  issuing a PO or paying an invoice. A sourcing hold implies a purchase-order
  hold, category-scoped holds only bite in the categories they name, and every
  block answers with the hold ids and who may lift them.
- **Automatic vs manual releases.** Release roles guard *manual* releases, where
  nobody can verify the claim that the problem is gone. When the system placed a
  hold from an observable fact (a lapsed certificate, a failed audit, an expired
  contract) it releases it when that fact changes, so renewing a certificate does
  not need a compliance role.
- **Dates are calendar days.** Validity windows, notice periods and expiry
  warnings use a `DateOnly` type with explicit calendar arithmetic; nothing
  depends on the process time zone. Services take a `Clock` port and the tests
  advance a fixed clock to walk certificates and contracts over their edges.
- **Derived, not drifted.** Expiry, qualification validity, scorecard ratings
  and risk tiers are computed from the facts on the aggregate. The nightly
  sweeps (`/jobs/compliance-sweep`, `/jobs/contract-term-sweep`) turn a derived
  state into an event and an enforcement action exactly once.
```
