# Enterprise Suite — ERP / SRM / PRM

Modular monorepo covering Sales, Marketing, Product, Supply Chain, Finance, Manufacturing, HR, Quality, Logistics, Master Data, plus SRM and PRM.

## Layout

```
enterprise-suite/
  packages/          # shared kernel, contracts, event-bus, api-gateway
  services/          # domain microservices
  apps/              # web portal & admin console
  configs/           # deployment & env templates
  docs/              # architecture & domain docs
  scripts/           # codegen & workspace helpers
```

## Domains

| Package / Service | System | Owner domain |
|-------------------|--------|--------------|
| sales-erp | ERP | Quote → Order → Fulfillment |
| marketing-erp | ERP | Campaigns, leads, attribution |
| product-plm | ERP | SKU, BOM, lifecycle |
| supply-chain | ERP | Planning, MRP, allocation |
| inventory-wms | ERP | Warehouses, stock, movements |
| finance-erp | ERP | GL, AR/AP, costing |
| manufacturing-mes | ERP | Work orders, capacity |
| hcm-erp | ERP | Org, employees, payroll hooks |
| quality-qms | ERP | NCR, CAPA, inspections |
| logistics-tms | ERP | Shipments, carriers, tracking |
| master-data | ERP | Customers, sites, UoM, currency |
| srm-core | SRM | Suppliers, scorecards, contracts |
| procurement-srm | SRM | Requisitions, POs, receipts |
| prm-core | PRM | Partners, tiers, MDF |
| channel-prm | PRM | Opportunities, deal reg, portals |
| identity-access | Platform | AuthN/Z, tenants, RBAC |
| integration-hub | Platform | Events, outbox, adapters |
| reporting-bi | Platform | Metrics, cubes, exports |
| web-portal | Apps | Employee / partner UX |
| admin-console | Apps | Tenant ops & config |

## Tech baseline

- TypeScript (Node 20+), workspace packages
- Domain modules expose HTTP + domain events
- Shared kernel: Entity, Result, Money, TenantId, EventEnvelope
- No fake 5M-line padding — depth comes from real domain models, services, APIs, tests, and migrations

## Product runbook (local / private pilot)

**Scope honesty, up front:** this suite is built for a local or private-network
pilot. Persistence is in-memory (plus optional JSON-file snapshots) unless you
add real database adapters. Tenant isolation, token signing, and rate limits
exist but have not been hardened, audited, or load-tested for public
multi-tenant SaaS. Do not expose these ports to the internet.

### Run natively (Node 20+)

```bash
cd enterprise-suite
npm ci                 # reproducible install from the lockfile
npm run suite:start    # boots all services; declares READY only when 100%
                       # of critical processes answer HTTP 200 on /health
npm run suite:smoke    # e2e smoke: shell, gateway health/ready, portal,
                       # admin, and gateway data routes; exits non-zero on failure
```

`suite:start` fails fast if port 4000 is already taken (no orphaned children),
and keeps the shell up for diagnosis if readiness times out
(`SUITE_READY_TIMEOUT_MS`, default 120000). Per-process logs land in
`.suite-logs/`; the readiness verdict is visible on the shell page,
`/api/status`, and `docs/suite-runtime.json`.

### Run with Docker

```bash
cd enterprise-suite
docker compose up --build
```

One `suite` container runs every process and publishes 4000 (shell),
4100 (gateway), 4119 (admin), 4300 (portal). The compose healthcheck flips to
`healthy` only after the suite declares READY. Smoke-test it from the host
with `npm run suite:smoke`.

### Surfaces

| Surface | URL |
|---------|-----|
| Suite shell | http://127.0.0.1:4000/ |
| Web Portal | http://127.0.0.1:4300/ (live gateway; tenant `demo`) |
| Admin Console | http://127.0.0.1:4119/ |
| API Gateway | http://127.0.0.1:4100/ |
| OpenAPI | http://127.0.0.1:4100/openapi.json |

Portal sign-in uses directory emails (e.g. `jordan.blake@acme.test`) on tenant **demo**.  
`SUITE_AUTH_SECRET` signs suite tokens; the baked-in local demo default is only
for private use — set your own secret for any shared deployment.

### Windows notes

- Prefer **WSL2 or Docker Desktop** on Windows: the launcher relies on POSIX
  signal semantics (SIGTERM/SIGINT) for clean child shutdown, which Node only
  emulates on native Windows.
- If running natively anyway: use PowerShell or cmd (`npm run suite:start`
  works as-is — the launcher spawns Node directly, no shell scripts), stop the
  suite with a single Ctrl+C, and check `.suite-logs\` if a port conflict is
  reported (default ports: 4000–4300 range, see `scripts/suite-manifest.json`).

Export a portable archive:

```bash
npm run suite:export
```

## Build progress dashboard

```bash
cd enterprise-suite
npm run progress          # refresh docs/progress.json from the filesystem
npm run progress:serve    # serve docs/ at http://127.0.0.1:8765/progress.html
```

Open `docs/progress.html` (via the local server) for a live view of the 20 domain modules, Fable5 / Opus5-fast batches, LOC, and completion checks.

## Quick start

```bash
cd enterprise-suite
npm install
npm run build
npm test
```
