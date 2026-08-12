# @enterprise-suite/web-portal

The employee-facing portal shell: one tenant-aware application that mounts the
six business modules — **Sales, Marketing, Inventory, SRM, PRM, Finance** — and
talks to their services through typed clients.

It is a *shell*, not a business service. It owns navigation, session and tenant
context, permission-filtered chrome, cross-module search and the shape of a
list view. It owns no business data; every figure on screen comes from a domain
service (or, in development, from the in-memory mock backend).

```bash
npm run build       # tsc -b
npm test            # 107 tests, node:test
npm run typecheck   # sources + tests
npm run lint        # typecheck
npm run dev         # http://127.0.0.1:4300 with the mock backend
```

## What is in here

```
src/
  domain/          module catalog, routes/nav, RBAC mirror, session, KPIs, preferences
  api/             ApiClient + one typed stub per module
  application/     dashboard, list views, search, preferences
  infrastructure/  config, mock identity, transports, fixtures, composition root
  http/            router, SSR views, JSON BFF, static assets
migrations/        preferences and portal activity tables
tests/             domain, client, service and end-to-end HTTP tests
```

## Module catalog

`src/domain/module-catalog.ts` is the single source of truth. Each descriptor
carries the upstream service, the nav items (with the permission and the
resource each one lists), the actions the module accepts and the KPIs the
dashboard shows:

| Module | Service | Views |
|--------|---------|-------|
| Sales | `sales-erp` | Quotes, Orders, Customers, Discount approvals |
| Marketing | `marketing-erp` | Campaigns, Leads, Segments, Attribution |
| Inventory | `inventory-wms` | Stock on hand, Movements, Replenishment, Cycle counts |
| SRM | `srm-core` / `procurement-srm` | Suppliers, Requisitions, Purchase orders, Contracts |
| PRM | `prm-core` / `channel-prm` | Partners, Deal registrations, MDF requests, Enablement |
| Finance | `finance-erp` | Receivables, Payables, Journals, Periods |

Adding a seventh module means adding a descriptor and a client; the rail, the
dashboard, the command palette, the BFF and the generic list view all pick it up
without further changes.

## Typed API clients

`ApiClient` (`src/api/client.ts`) is the only place that knows about transport
concerns: URL resolution, auth headers, per-request timeout, retry with
exponential backoff for idempotent calls, error classification and a telemetry
hook. Module stubs add types and nothing else:

```ts
const { sales } = createApiClients({ endpoints, transport, auth });

const page = await sales.listQuotes({ status: "sent", pageSize: 20 });
//    ^? ApiPage<QuoteDto>
await sales.approveDiscount("apv-1", { approvedPct: 0.15 });
```

Every client also implements `ModuleApi` — `summary()`, `list()`, `search()`,
`command()` — which is what the shell itself is written against.

Failures arrive as `ApiError` with a `kind` (`unauthorized`, `forbidden`,
`not-found`, `conflict`, `validation`, `timeout`, `network`, `server`), so the
UI can distinguish "you may not see this" from "that service is down". The
dashboard uses exactly that distinction: a failing module renders as a degraded
tile and the rest of the page still loads.

## Auth and tenant headers (mock)

Identity is mocked until `identity-access` is available. Two ways in, both
yielding the same `PortalSession`:

1. **Sign-in** (`POST /sign-in`) against the mock directory in
   `src/infrastructure/auth/directory.ts`. It mints an HS256 bearer token
   (`src/infrastructure/auth/token.ts`) and sets it as an `HttpOnly`,
   `SameSite=Lax` cookie. Tokens are verified for signature and expiry.
2. **Gateway headers** — `x-tenant-id`, `x-user-id`, `x-roles` — which is how an
   already-authenticated principal will arrive in production, and how `curl` and
   the tests drive the portal. Refusable per deployment (`trustHeaders: false`).

Every outbound call carries the session:

```
x-tenant-id: acme
x-user-id: u-avery
x-roles: sales-manager,channel-manager
x-on-behalf-of: u-admin        # only while impersonating
authorization: Bearer <token>
x-request-id / x-correlation-id: req_…
```

The directory ships two tenants so multi-tenancy is visible rather than
asserted: **acme** (all six modules, USD) and **globex** (no PRM subscription,
EUR). A user's roles differ per tenant, and switching tenants re-issues the
token with the new role set.

### Permissions

`src/domain/rbac.ts` mirrors the role → permission map so the shell can avoid
rendering actions the backend would reject. Grants are `resource:action` with
wildcard support, roles inherit transitively (`controller` → `accountant` →
`viewer`), and the mirror is advisory: services re-check everything.

Visibility is two gates, and they are not the same: a module the tenant has not
bought is **absent** (404, hidden from nav and search), a view the role cannot
open is **denied** (403, rendered disabled in the rail).

## Running against real services

The default transport is the in-memory mock, so the portal runs with nothing
else booted. Point it at real services with:

```bash
PORTAL_TRANSPORT=http PORTAL_GATEWAY_URL=http://127.0.0.1:8080 npm run dev
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4300` | Listen port |
| `PORTAL_TRANSPORT` | `mock` | `mock` or `http` |
| `PORTAL_GATEWAY_URL` | `http://127.0.0.1:8080` | api-gateway base; modules mount at `/api/<module>` |
| `PORTAL_<MODULE>_URL` | — | Override one module (e.g. `PORTAL_SALES_URL`) |
| `PORTAL_REQUEST_TIMEOUT_MS` | `5000` | Per-call timeout |
| `PORTAL_RETRIES` | `2` | Retries for idempotent calls |
| `PORTAL_SESSION_SECRET` | `dev-only-portal-secret` | Token signing key |
| `PORTAL_SESSION_TTL_MINUTES` | `480` | Session lifetime |
| `PORTAL_MOCK_LATENCY_MS` | `0` | Artificial latency for the mock backend |

Each module is expected to expose `GET /summary`, `GET /search`, paginated list
endpoints matching the descriptor's `resource` keys, and the action endpoints
the descriptor declares.

## HTTP surface

Server-rendered pages (no build step, no framework, usable without JavaScript):

| Route | Purpose |
|-------|---------|
| `GET /` | Dashboard: one tile per visible module |
| `GET /m/:module` | Redirect to the module's first permitted view |
| `GET /m/:module/:slug` | List view with filter, paging and saved-view control |
| `POST /m/:module/actions/:action` | Run a declared module action |
| `GET /search?q=` | Cross-module search |
| `GET /profile`, `GET /preferences` | Session detail, shell settings |
| `GET /sign-in`, `POST /sign-in`, `POST /sign-out`, `POST /switch-tenant` | Session lifecycle |

JSON BFF, same services and the same filtering, for a future SPA or native
client:

| Route | Purpose |
|-------|---------|
| `GET /api/session` | Session, roles, expanded permissions |
| `GET /api/nav` | Permission-filtered navigation tree |
| `GET /api/dashboard` | Tiles, KPIs, degraded modules, nav counts |
| `GET /api/modules/:module/:slug` | List view model (columns + formatted rows) |
| `POST /api/modules/:module/actions/:action` | Dispatch an action |
| `GET /api/search?q=` | Grouped hits and unavailable modules |
| `GET/PATCH /api/preferences`, `POST /api/preferences/pins/:module`, `POST/DELETE /api/preferences/views` | Shell preferences |
| `GET /api/diagnostics` | Per-service latency and recent calls (tenant-admin only) |
| `GET /health` | Liveness |

```bash
TOKEN=$(curl -s -XPOST localhost:4300/sign-in -H 'content-type: application/json' \
  -d '{"email":"avery.chen@acme.test","tenantId":"acme"}' | jq -r .token)
curl -s -H "authorization: Bearer $TOKEN" localhost:4300/api/dashboard | jq '.tiles[].module'
```

## Persistence

The portal stores only shell state. `migrations/0001_portal_preferences.sql`
covers preferences, ordered pins and saved views; `0002_portal_audit.sql` covers
page/command activity and outbound service-call timings. Until Postgres is
wired in, `InMemoryPreferencesRepository` implements the same interface, and
`CallLog` holds the last 200 outbound calls behind `/api/diagnostics`.

## Tests

```bash
npm test
```

Covers the RBAC wildcard/inheritance rules, route resolution and nav filtering,
token signing/tampering/expiry and tenant switching, client retry and error
classification, dashboard degradation, column inference and money formatting,
preference validation and pruning, HTML escaping, and an end-to-end pass over
the server: anonymous redirects, sign-in cookies, entitlement isolation between
`acme` and `globex`, action dispatch and BFF error envelopes.
