# @enterprise-suite/api-gateway

Edge gateway for the suite, and the HTTP kernel the apps behind it reuse.

Four things live here:

1. **Route table** — every public path, the upstream that owns it, its auth
   mode, throttling policy and timeout, with specificity-ordered matching and
   boot-time conflict detection.
2. **Suite auth middleware** — verifies an HS256 bearer/cookie token, turns its
   tenant, user and roles into a `TenantContext`, and overwrites inbound identity
   headers before proxying.
3. **Health and readiness** — liveness that never touches the network plus a
   cached readiness fan-out over the upstream catalog.
4. **OpenAPI aggregator** — merges upstream documents into one, and synthesizes
   a stub document from the route table for contexts that do not publish one
   yet.

## Layout

```
src/domain/          route.ts, route-table.ts, service-catalog.ts, policy.ts, openapi.ts, errors.ts
src/application/     gateway-service.ts, health-service.ts, openapi-aggregator.ts, ports.ts
src/infrastructure/  catalog.ts, routes.ts, container.ts, clock.ts, logger.ts,
                     rate-limit-store.ts, http-probe.ts, spec-source.ts
src/http/            router.ts, server.ts, main.ts, middleware/*
migrations/          gateway config + observability tables
tests/               route table, gateway decisions, health, OpenAPI, router, HTTP
```

## Run it

```bash
npm run dev   -w @enterprise-suite/api-gateway     # listens on :4100
npm run build -w @enterprise-suite/api-gateway
npm test      -w @enterprise-suite/api-gateway
```

Set `SUITE_AUTH_SECRET` to the same strong secret used by the portal login.
Unsigned `x-tenant-id` / `x-user-id` / `x-roles` authentication is disabled by
default. `SUITE_TRUST_HEADERS=true` enables it only as a local
service-to-service compatibility mode; a supplied token is still verified and
its claims always win.

| Endpoint | Purpose |
|---|---|
| `GET /health`, `GET /health/live` | Liveness. No network calls, no tenant header. |
| `GET /health/ready`, `GET /ready` | Readiness fan-out. `503` when a critical upstream is down. |
| `GET /openapi.json` | Aggregated OpenAPI 3.1 document. |
| `GET /openapi/report` | Which upstreams answered, which were stubbed, what was renamed. |
| `GET /__gateway/routes` | The route table as served, plus audit findings. |
| `GET /__gateway/services` | The upstream catalog. |
| `GET /__gateway/metrics` | In-process request counters and p95 per route. |
| `* /api/**` | Resolved against the route table and forwarded. |

## Route table

A route is a public pattern bound to an upstream:

```ts
{
  id: "product-plm.products.get",
  method: "GET",
  pattern: "/api/plm/products/:productId",
  upstream: "product-plm",
  auth: { mode: "tenant" },
  rateLimit: { limit: 600, windowMs: 60_000, key: "tenant" },
}
```

Patterns take static segments, `:param` captures and a trailing `*rest`
wildcard. Matching is **specificity-ordered**, not declaration-ordered, so
`/api/plm/products/search` wins over `/api/plm/products/:productId` however the
table was assembled. Registering the same method and normalized pattern twice
throws `RouteConflictError` at boot rather than silently shadowing a route.

`RouteTable.audit()` lints the configuration: unknown upstreams, anonymous
routes that mutate state, and routes a wildcard would swallow. The gateway logs
findings at startup and serves them from `/__gateway/routes`.

Upstream paths are derived by stripping the owning service's prefix
(`/api/plm/products/p_1` → `/products/p_1`) unless the route declares an
explicit `rewrite` template.

## Authorization and throttling

`auth.mode` is one of:

| Mode | Requirement |
|---|---|
| `anonymous` | Nothing. Probes and docs. |
| `tenant` | `x-tenant-id` and `x-user-id` must be present. |
| `roles` | The above plus one of `anyOfRoles`. |

Any mode can additionally demand `allOfPermissions`, resolved from role grants
(`DEFAULT_ROLE_GRANTS`, or the `gateway_role_grant` table). The `*` grant held
by `platform-admin` satisfies everything.

Throttling is a fixed window over one of four bucket strategies — `global`,
`tenant`, `tenant-user`, `tenant-route` — and always answers with
`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, plus
`retry-after` on a 429.

Routing, authorization and throttling are decided by `GatewayService.resolve()`,
which returns a forward-or-reject **value**. Nothing about those rules needs a
socket to test, and a service that embeds the kernel gets the same behaviour
in-process.

## Health and readiness

`HealthService.ready()` probes every catalogued upstream concurrently and caches
each result for a TTL so a rolling deploy cannot stampede the fleet:

- critical upstream down → `unready`, HTTP 503
- non-critical down or slow → `degraded`, HTTP 200 (still in rotation)
- `planned: true` upstream → `unknown`, never counted as a failure

## OpenAPI aggregation

`OpenApiAggregator.aggregate()` fetches each upstream document, prefixes its
paths with the owning service's prefix, namespaces operationIds and tags, and
merges components. Two services that publish the same schema name keep one copy
when the definitions are identical; when they differ, the second is renamed to
`<ServiceId>_<Name>` and every `$ref` in its subtree is rewritten.

A context that cannot serve a document is not fatal. With `stubMissing` the
gateway synthesizes one from the route table — real paths, path parameters,
tenant headers, the shared error envelope, and `x-stub: true` — so discovery
works before the upstream ships. `/openapi/report` says exactly which documents
were live, stubbed or failed.

## Reusing the kernel

Services and apps import the router and middleware directly:

```ts
import { Router, json, errorHandler, tenantContextMiddleware } from "@enterprise-suite/api-gateway";

const router = new Router({ serviceName: "admin-console" })
  .use(errorHandler({ logger }))
  .use(tenantContextMiddleware({ anonymousPaths: ["/health", "/openapi.json"] }))
  .get("/tenants", (req) => json(200, listTenants(req.ctx)), "tenants.list");
```

`apps/admin-console` is built entirely on it.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4100` | Listen port. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |
| `UPSTREAM_ORIGIN_TEMPLATE` | `http://127.0.0.1:{port}` | Origin template per upstream. |
| `ASSUME_DEPLOYED` | `false` | Treat `planned` upstreams as live. |

The reference catalog and route table live in `src/infrastructure/`. The
migrations mirror them so an operator can override routing at runtime without a
redeploy.
