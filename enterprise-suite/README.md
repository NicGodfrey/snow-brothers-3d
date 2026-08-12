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

## Run the integrated suite

```bash
cd enterprise-suite
npm install
npm run suite:start
```

This boots domain services (4101–4118), API gateway (`:4100`, `ASSUME_DEPLOYED`), admin console (`:4119`), web portal (`:4300`), and a suite shell at:

| Surface | URL |
|---------|-----|
| Suite shell | http://127.0.0.1:4000/ |
| Web Portal | http://127.0.0.1:4300/ |
| Admin Console | http://127.0.0.1:4119/ |
| API Gateway | http://127.0.0.1:4100/ |
| OpenAPI | http://127.0.0.1:4100/openapi.json |

Export a portable archive + link map:

```bash
npm run suite:export
# writes /opt/cursor/artifacts/enterprise-suite-*.tar.gz
# and docs/export-links.json
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
