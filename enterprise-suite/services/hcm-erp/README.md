# @enterprise-suite/hcm-erp

Human Capital Management bounded context for the enterprise suite: organizational
structure, employees and employment contracts, leave, attendance, compensation
(with a stubbed payroll calculator), skills/certifications, and hiring
requisitions. Multi-tenant throughout, event-emitting via the shared-kernel
envelope + transactional outbox pattern.

## Layout

```
src/
  domain/           # aggregates, entities, value helpers, event catalog
  application/      # use-case services + repository/outbox/clock ports
  infrastructure/   # in-memory adapters (Postgres-ready interfaces)
  http/             # dependency-free router, RBAC, validation, route modules
  fixtures/         # demo tenant seed used by tests and local dev
migrations/         # Postgres DDL matching the domain model
tests/              # node:test suites (59 tests): unit + HTTP integration
```

## Domain model

| Aggregate / Entity | Highlights |
|---|---|
| `OrgUnit` | company → division → department → team nesting rules, move with cycle detection, deactivation requires inactive children + no filled positions (open ones auto-eliminated) |
| `Position` | grade ladder (IC1–IC7, M1–M5), open/filled/frozen/eliminated lifecycle, reporting-line cycle prevention |
| `Employee` | hire/terminate with reason codes + rehire flag, on-leave/suspend transitions, manager chains with cycle prevention; offboarding re-parents direct reports, vacates the position, and terminates the active contract |
| `EmploymentContract` | permanent/fixed_term/contractor/intern with date rules, probation, FTE/weekly-hour bounds, versioned amendments, expiry sweep for fixed terms; activation fills the position and bootstraps compensation |
| `LeavePolicy` / `LeaveBalance` / `LeaveRequest` | per-type policies (accrual, carryover cap, approval, negative balance), holiday-aware working-day computation, balance reservation on submit → commit on approve / release on reject, refund of cancelled future leave, pro-rated hire-year entitlement, monthly accrual sweep, year-end carryover |
| `AttendancePeriod` | monthly timesheets: timed entries (overlap + 16h/day guards) and day markers (leave/sick/holiday), totals with per-day overtime, open → submitted → approved → locked with reopen |
| `CompensationRecord` / `BonusAward` | annual base salary in minor units, reasoned salary revisions (merit cannot decrease, demotion cannot increase, currency immutable), unique allowances, bonus pending → paid/cancelled |
| `Skill` / `EmployeeSkill` / `Certification` / `EmployeeCertification` | 1–5 proficiency with assessment history, staffing queries, expiry computed from validity months, expiring-soon report, expiry sweep, revocation |
| `HiringRequisition` | draft → pending_approval → open ⇄ on_hold → filled, self-approval blocked, salary band enforcement, multi-headcount fills across sibling positions |

### Payroll is a stub — by design

`calculatePayslipStub` produces a structured payslip preview per pay period.
**Earnings are real** (base per frequency, allowances, bonuses due in the
month); **all deductions come from `STUB_DEDUCTION_TABLE`** (flat placeholder
rates) and every derived line carries `stub: true`, as does the payslip itself.
A real tax engine replaces the table + calculator without touching the rest of
the domain.

## Cross-aggregate orchestrations

- **Contract activation** — fills the position, sets the employee's primary
  position, and initializes a compensation record from contract terms.
- **Employee termination** — vacates the position, terminates the active
  contract, and re-parents direct reports to the leaver's manager.
- **Requisition fill** — hires the employee (reporting to the hiring manager),
  drafts + activates the contract (band-checked against the requisition),
  records the hire, and closes the requisition at headcount.

## HTTP API

Dependency-free router over `node:http`. Identity comes from headers per the
architecture doc: `x-tenant-id` (required, 401 otherwise), `x-user-id`,
`x-roles` (comma-separated; privileged endpoints require `hr_admin` and/or
`manager`). Errors map `DomainError` → `{ error: { code, message } }` with its
HTTP status; body validation returns 422 with the offending field.

~70 endpoints across `/org-units`, `/positions`, `/employees`, `/contracts`,
`/leave-policies`, `/leave-requests`, `/attendance-periods`,
`/employees/:id/compensation`, `/employees/:id/bonuses`,
`/employees/:id/payslip-preview`, `/skills`, `/certifications`,
`/requisitions`, plus `/outbox` + `/outbox/drain` for the event dispatcher and
`/health`.

```ts
import { createHcmModule, createHcmServer, seedDemoTenant } from "@enterprise-suite/hcm-erp";

const module = createHcmModule();      // in-memory adapters by default
seedDemoTenant(module, "acme");        // optional demo data
createHcmServer(module).listen(3007);
```

## Events

All mutations emit `hcm.<aggregate>.<verb>` envelopes (see `HcmEvents`) into a
transactional outbox; `drain()` (or `POST /outbox/drain`) hands them to the
integration hub exactly once. Finance/reporting-relevant payload shapes are
typed in `src/domain/events.ts`.

## Persistence

Repositories are ports (`src/application/ports.ts`) with in-memory adapters.
`migrations/*.sql` contains the matching Postgres DDL: tenant-scoped composite
keys and FKs, status/date CHECK constraints, partial unique indexes (one active
contract per employee, one active certification grant, one day marker per
date), and the `hcm_outbox` table.

## Scripts

```bash
npm run build      # tsc → dist
npm run typecheck  # src + tests, no emit
npm test           # node:test via tsx (59 tests, includes HTTP integration)
npm run lint
```
