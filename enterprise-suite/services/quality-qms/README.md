# @enterprise-suite/quality-qms

Quality Management System for the enterprise suite: inspection planning and
execution, non-conformance reports (NCR), CAPA, supplier quality events with
SCARs, and audit checklists/executions. Multi-tenant, event-emitting, HTTP
exposed, with Postgres migrations describing the persistent shape.

## Domain model

| Aggregate | Purpose |
|-----------|---------|
| `InspectionPlan` | Versioned definition of what to inspect (characteristics) and how much (sampling rule). Draft-only editing; one active revision per plan code. |
| `InspectionLot` | A quantity submitted for inspection. Snapshots plan characteristics and sampling at creation; collects results; ends in a usage decision. |
| `NonConformanceReport` | Documents a deviation with containment actions, a disposition (with four-eyes approval where required), and CAPA escalation. |
| `CapaCase` | Corrective/preventive action case: root cause analysis, action items, effectiveness verification, rework cycles. |
| `SupplierQualityEvent` | Supplier-attributed incident with demerit points and optional SCAR; the integration surface towards SRM scorecards. |
| `AuditChecklistTemplate` / `Audit` | Reusable checklists (conformity / score / yes-no items) and audit executions with findings and weighted scoring. |

### Sampling (ISO 2859-1 style)

`domain/sampling.ts` implements single sampling for normal inspection:
lot-size ranges map to code letters (general levels I–III), each letter has a
fixed sample size, and acceptance numbers follow the published column
structure (down-arrows above the Ac=0 row, two arrow rows resolving to the
Ac=1 plan, then 1, 2, 3, 5, 7, 10, 14, 21, up-arrows past 21). Example:
lot 1000, level II, AQL 1.0 → n=80, Ac=2. `fixed`, `percentage` and `full`
rules are also supported. Quantitative results get SPC statistics
(mean, sample stdDev, Cp, Cpk, out-of-spec count).

### Workflow state machines

```
InspectionLot: created -> in-progress -> completed -> decided
               (created | in-progress) -> cancelled
   completed requires results for every characteristic
   decide validates against results (no plain accept with failures,
   accept-with-deviation forbidden on critical failures, ...)

NCR:  draft -> open -> containment -> disposition -> closed
                 \--------------------^   (minor severity only)
      any non-terminal -> cancelled
   containment -> disposition requires all containment actions done
   use-as-is / regrade / critical dispositions need quality-manager
   approval by a different user (four-eyes)

CAPA: draft -> open -> investigation -> action-planning -> implementation
           -> verification -> closed
      verification -> action-planning   (not-effective outcome, rework cycle)
      any non-terminal -> cancelled
   guards: root cause before planning; >=1 corrective/preventive action
   before implementation; all actions finished + effectiveness check defined
   before verification; "effective" outcome before closing

SupplierQualityEvent: open -> acknowledged -> in-remediation -> resolved
                      open | acknowledged -> written-off
   in-remediation requires a SCAR; resolution requires an accepted SCAR
   response (when a SCAR exists); write-off zeroes demerit points

Audit: planned -> in-progress -> review -> completed -> closed
       (planned | in-progress) -> cancelled
   review requires all items answered; closing requires every major-nc
   finding linked to an NCR or CAPA
```

### Cross-aggregate policies (application layer)

- Rejecting (or partially rejecting) a lot auto-creates an NCR referencing
  the lot, supplier, and PO; rejected goods-receipt lots also record an
  `incoming-inspection-failure` supplier quality event.
- Opening a supplier-linked NCR records an `ncr-issued` supplier event
  (suppressed when the lot service already reported the failure).
- NCR escalation creates a CAPA, links both directions, and copies supplier
  and audit linkage into the CAPA source.
- Completing a supplier audit with major non-conformities records an
  `audit-finding` supplier event.
- Supplier summaries aggregate demerits into rating bands (A < 10 ≤ B < 30 ≤
  C < 60 ≤ D).

## HTTP API

Tenant context comes from headers: `x-tenant-id`, `x-user-id`, `x-roles`
(comma-separated). `/health` is unauthenticated. Errors are
`{ error: { code, message } }` with 400 (validation), 401 (missing context),
403 (role), 404 (not found), 409 (workflow conflict).

| Area | Endpoints (base + key actions) |
|------|-------------------------------|
| Inspection plans | `POST/GET /inspection-plans`, `GET /inspection-plans/:id`, `POST .../characteristics`, `DELETE .../characteristics/:characteristicId`, `PUT .../sampling-rule`, `POST .../activate | retire | revise` |
| Inspection lots | `POST/GET /inspection-lots`, `GET /inspection-lots/:id`, `POST .../start`, `POST .../results/quantitative | attribute`, `POST .../complete`, `POST .../decision`, `POST .../cancel` |
| NCRs | `POST/GET /ncrs`, `GET /ncrs/:id`, `POST .../submit`, `POST .../containment/start`, `POST .../containment/actions`, `POST .../containment/actions/:actionId/complete`, `POST .../move-to-disposition`, `POST .../disposition`, `POST .../disposition/approve`, `POST .../escalate`, `POST .../close | cancel` |
| CAPAs | `POST/GET /capas`, `GET /capas/overdue`, `GET /capas/:id`, `POST .../submit`, `.../start-investigation`, `.../root-cause`, `.../move-to-action-planning`, `.../actions`, `.../actions/:actionId/start | complete | cancel`, `.../begin-implementation`, `.../effectiveness-check`, `.../request-verification`, `.../effectiveness`, `.../return-to-planning`, `.../close | cancel` |
| Supplier quality | `POST/GET /supplier-quality/events`, `GET /supplier-quality/events/:id`, `POST .../acknowledge`, `.../scar`, `.../scar/response`, `.../resolve`, `.../write-off`, `GET /supplier-quality/suppliers/:supplierId/summary` |
| Audits | `POST/GET /audit-templates`, `POST .../sections`, `POST .../sections/:sectionId/items`, `POST .../activate`, `POST/GET /audits`, `GET /audits/:id`, `POST .../start`, `.../responses`, `.../findings`, `.../findings/:findingId/link`, `.../review`, `.../complete`, `.../close`, `.../cancel` |
| Diagnostics | `GET /health`, `GET /outbox/pending`, `POST /outbox/drain` |

## Domain events

Published through the transactional outbox as shared-kernel `EventEnvelope`s
(see `src/domain/events.ts` for payload contracts):

`quality.inspection-plan.{created,activated,retired,revised}`,
`quality.inspection-lot.{created,started,result-recorded,completed,usage-decided,cancelled}`,
`quality.ncr.{created,opened,containment-started,dispositioned,disposition-approved,closed,cancelled,escalated-to-capa}`,
`quality.capa.{created,state-changed,action-added,action-completed,effectiveness-recorded,closed,cancelled}`,
`quality.supplier-event.{recorded,scar-issued,scar-response-recorded,resolved}`,
`quality.audit-template.activated`,
`quality.audit.{planned,started,finding-recorded,completed,closed}`.

## Layout

```
src/
  domain/           aggregates, sampling & SPC math, state machine, events
  application/      use-case services, ports (outbox, number series, clock)
  infrastructure/   in-memory repos/outbox/number-series, composition root
  http/             dependency-free router, validation, route modules, server
migrations/         Postgres DDL (schema `quality`, 7 migrations)
tests/              81 node:test cases (unit, workflow, end-to-end, HTTP)
```

## Running

```bash
npm run build      # tsc -b (builds shared-kernel reference too)
npm test           # node --import tsx --test tests/*.test.ts
npm run typecheck  # sources + tests, no emit
npm start          # HTTP server on :3010 (PORT overridable)
```

Repositories are in-memory behind narrow interfaces; the migrations define
the Postgres shape a persistent implementation would target (including the
outbox relay table and per-tenant/year number series).
