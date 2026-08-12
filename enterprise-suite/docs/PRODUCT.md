# Enterprise Suite — usable pilot product

One integrated ERP / SRM / PRM suite: 18 domain services, API gateway, admin
console, web portal, outbox relay, and a suite shell.

## Quick start (Windows / macOS / Linux)

```bash
cd enterprise-suite
npm ci
npm run suite:start
```

Keep that terminal open, then open:

| Surface | URL |
|---------|-----|
| Suite shell / status | http://127.0.0.1:4000/ |
| Web portal | http://127.0.0.1:4300/ |
| Admin console | http://127.0.0.1:4119/ |
| API gateway | http://127.0.0.1:4100/ |
| OpenAPI | http://127.0.0.1:4100/openapi.json |

Portal demo login: `avery.chen@acme.test` / tenant **demo**.

Smoke test (suite must already be running):

```bash
npm run suite:smoke
```

## What works in this pilot

- Gateway routes to live domain services; `/health/ready` is 200 when critical upstreams are up.
- Portal default transport is **HTTP** against the gateway (not mock fixtures).
- Shared suite JWT (`SUITE_AUTH_SECRET`) for portal/gateway auth; local demo also trusts `x-tenant-id` / `x-roles` headers for smoke tooling.
- Outbox relay drains domain outboxes into integration-hub.
- **SRM-core** persists suppliers (and related aggregates) under `.data/srm-core/` so a restart keeps the seeded master data.
- Docker: `docker compose up --build` (binds `0.0.0.0` inside the container).

## Scope honesty

This is a **local / private pilot**, not a hardened multi-tenant SaaS. Domain
services use in-memory repositories (SRM adds JSON file backing). Postgres
migration SQL exists as schema design docs but is not applied at runtime.
