# @enterprise-suite/admin-console

The tenant administration shell for the suite: the one place where a tenant is
provisioned, its people and roles are managed, its code lists are curated, its
integrations are wired up and its rollouts are steered.

Five areas, each a DDD aggregate with an application service in front of it:

| Area | What it owns |
|---|---|
| **Tenants** | Lifecycle, plan and quotas, locale/currency defaults, contacts. |
| **Users and roles** | Membership, invitations, and tenant-scoped roles with inheritance. |
| **Reference data** | Effective-dated, optionally hierarchical code lists with draft/publish. |
| **Webhooks** | Signed outbound delivery with retries, dead letters and a circuit breaker. |
| **Feature flags** | Targeting rules and percentage rollouts, evaluated deterministically. |

Everything a command changes is written to an **audit log** with the acting
principal and a redacted before/after snapshot.

## Layout

```
src/domain/          tenant.ts, user.ts, role.ts, reference-data.ts, webhook.ts,
                     feature-flag.ts, audit.ts, events.ts, errors.ts
src/application/     one service per aggregate + ports.ts
src/infrastructure/  memory-repositories.ts, crypto.ts, webhook-sender.ts,
                     container.ts, seed.ts
src/http/            server.ts, main.ts, context.ts, validate.ts, ui.ts, routes/*
migrations/          tenants + identity, reference data, webhooks/flags/audit
tests/               117 tests across domain, services, container and HTTP
```

## Run it

```bash
npm run dev   -w @enterprise-suite/admin-console   # :4700, seeded demo tenant
npm run demo  -w @enterprise-suite/admin-console   # walks the workflows on stdout
npm test      -w @enterprise-suite/admin-console
npm run build -w @enterprise-suite/admin-console
```

`http://localhost:4700/` serves the shell; the JSON API is under
`/api/admin`, which is where the gateway's `/api/*` proxy lands.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4700` | Listen port. |
| `ADMIN_SEED` | `true` | Seed the demo tenant. Set `false` for empty stores. |
| `ADMIN_TENANT`, `ADMIN_USER` | seeded values | Pre-filled in the shell's header. |
| `WEBHOOK_DRAIN_MS` | `5000` | How often due deliveries are attempted. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |

## Request contract

Built on the gateway's HTTP kernel, so the header contract is the suite's:
`x-tenant-id` and `x-user-id` are required, `x-roles` carries the caller's
**tenant role codes**, and `x-request-id` is echoed back on every response.

`/health`, `/health/ready`, `/openapi.json` and the shell itself are the only
anonymous paths.

## Authorization

Roles here are records, not strings. A header of `x-roles: integration-engineer`
means nothing until it resolves against that tenant's own role definitions, so
an invented role code grants nothing and a role that inherits another gets the
parent's grants too.

Permissions are `<resource>:<action>` over seven resources
(`tenant`, `user`, `role`, `reference-data`, `webhook`, `feature-flag`, `audit`)
and four actions (`read`, `write`, `delete`, `admin`). `:admin` expands to the
whole resource; `*` expands to everything and is what `platform-admin` holds.

Every route's requirement is declared once in `ROUTE_PERMISSIONS`, and
`requirePermissions` enforces it by route name before the handler runs — so the
permission surface of the app is one table, not a scavenger hunt through
handlers. `PUBLIC_ROUTES` is the deliberate exception list; it contains exactly
one entry, `users.accept-invite`, because an invitee presents a token and by
definition holds no role yet. A denial is itself audited.

Four system roles are seeded per tenant and cannot be edited: `tenant-admin`,
`tenant-operator`, `auditor`, `service`. Clone one to get an editable copy.

## Behaviour worth knowing

**The last administrator cannot be removed.** Suspending, deactivating or
demoting the only *active* `tenant-admin` is refused. An invited or suspended
administrator does not count as cover.

**Reference entries are retired, never deleted.** Retirement closes the entry's
effective window, so a document raised last quarter still resolves the code it
was raised with. `active: false` is the separate authoring flag for an entry
that is never in force. Retiring a parent retires its subtree, and the read path
always takes a point in time:

```ts
referenceData.resolve(tenantId, "order-hold-reason", { at: "2026-01-15T00:00:00Z" });
```

**Draft sets are invisible.** A domain service reading a code list gets nothing
back until the set is published, so nobody observes a half-migrated list.
Publishing bumps a revision consumers can cache on and emits
`admin.reference-data.set-published`.

**Webhook delivery is a queue, not a fire-and-forget.** Each delivery is a
record with its attempts, its next retry time (exponential backoff, capped) and
a terminal outcome. Payloads are signed `sha256=HMAC(secret, "<timestamp>.<body>")`
over `x-webhook-signature`; the timestamp is inside the signed material, so a
captured request cannot be replayed later. Ten consecutive failures trip a
circuit breaker that pauses the subscription. Spent deliveries go to `dead` and
stay there for inspection. Secrets are returned exactly once — at registration
and on rotation — and never appear in a read, a log or the audit trail.

**Flag evaluation is deterministic and offline.** Disabled → `offValue`; first
matching rule in priority order → its value; percentage rollout → `onValue`;
otherwise the default. Bucketing hashes `<flagKey>:<subject>` into 0–9999, so a
subject keeps its bucket as a rollout widens and two flags never correlate.
`explain` and `simulate` answer "what would this subject get, and why" without
recording anything.

**Commands do not know about webhooks.** Aggregates raise events, services
publish them to the outbox, and the composition root subscribes the webhook
dispatcher to it. Pass `bridgeEventsToWebhooks: false` to `createContainer` to
consume the outbox some other way.

## Endpoints

All paths are relative to `/api/admin`.

| Path | Methods |
|---|---|
| `/overview` | `GET` — everything the landing page needs in one call |
| `/tenants`, `/tenants/:key` | `GET`, `POST`, `PATCH` |
| `/tenants/:key/{activate,suspend,archive,plan,contacts}` | `POST` |
| `/tenants/:key/quotas` | `GET` |
| `/users`, `/users/:userKey` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/users/:userKey/{roles,accept-invite,reissue-invite,suspend,reinstate}` | `POST` |
| `/roles`, `/roles/:code`, `/roles/:code/clone` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/reference-data`, `/reference-data/:code` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/reference-data/:code/{publish,entries,entries/:entry,labels}` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/webhooks`, `/webhooks/:id` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/webhooks/:id/{pause,resume,rotate-secret,test,deliveries}` | `GET`, `POST` |
| `/webhooks/drain`, `/webhooks-dead-letters` | `POST`, `GET` |
| `/feature-flags`, `/feature-flags/:key` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/feature-flags/{evaluate}`, `/feature-flags/:key/{explain,simulate,rules,rules/:id}` | `GET`, `POST`, `DELETE` |
| `/audit-log`, `/audit-log/summary`, `/events` | `GET` |

`GET /openapi.json` is generated from the routes as registered — it cannot drift
from what the router serves — and each operation carries the permissions its
guard will demand under `x-required-permissions`.

## The shell

`src/http/ui.ts` renders one self-contained page: no build step, no framework,
no CDN. It calls the same JSON API as any other client, with the tenant headers
taken from the toolbar, which makes it a working demonstration of the header
contract rather than a mock. Change the tenant, user or roles in the header and
the next request goes out as that principal — including the 403s.

## Storage

The repositories are in-memory and shaped so a Postgres adapter drops in without
the services changing: tenant-scoped reads, explicit `save`, and the outbox as
the only way an event leaves a command. `migrations/` holds the schema those
adapters will target, including the partial index the delivery queue scans, the
uniqueness constraint that makes a replayed outbox harmless, and the rules that
keep the audit log append-only.
