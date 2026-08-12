# @enterprise-suite/identity-access

Identity and access management for the enterprise suite: tenants, users, groups, roles,
permissions, role bindings, API keys, session tokens, RBAC evaluation and an audit trail
of every authorization decision.

Every other bounded context depends on this one for the answer to a single question:
**may this caller do this thing, here?**

## Model

| Aggregate     | Responsibility                                                                    |
| ------------- | --------------------------------------------------------------------------------- |
| `Tenant`      | Root of every other record; owns password, session, API key and lockout policy      |
| `User`        | Human principal: credential digest, MFA enrollments, lockout counters, attributes   |
| `Group`       | Nestable collection of users so a role is granted once to a team, not per person    |
| `Role`        | Named set of grants, composable through inheritance; system roles are immutable     |
| `RoleBinding` | Binds one role to one subject at one scope for a time window                        |
| `ApiKey`      | Machine principal with an optional scope-down list and IP allowlist                 |
| `Session`     | Bearer session with a sliding idle deadline and a fixed absolute deadline           |
| `AuditEntry`  | Append-only record of a decision, a sign-in attempt or an administrative change     |

Subjects — the things a role can be bound to — are `user`, `group`, `api_key` or
`service`.

### Permissions

A permission key names one capability as `<resource>:<action>`, where the resource is a
dotted namespace: `sales.order:approve`, `identity.api_key:issue`. Keys are declared in a
catalog; an unknown key in a check is denied with `DENIED_UNKNOWN_PERMISSION` rather than
silently never matching, and an unknown key in a grant is rejected at write time.

Grants may use wildcards:

| Pattern                | Matches                                            |
| ---------------------- | -------------------------------------------------- |
| `sales.order:read`     | exactly that permission                            |
| `sales.*:read`         | `read` on any single segment below `sales`         |
| `sales.**:read`        | `read` on any depth below `sales`                  |
| `identity.user:*`      | any action on `identity.user`                      |
| `**:*`                 | everything (the superuser grant)                   |

### Scopes

Scopes are hierarchical paths rooted at `tenant`, with `type:key` segments:

```
tenant
tenant/bu:emea
tenant/bu:emea/site:hamburg
```

A grant held at `tenant/bu:emea` covers requests at `tenant/bu:emea/site:hamburg`.
Coverage flows **down** the tree only, so a site-scoped grant never satisfies a
tenant-wide request. A grant segment key may be `*`: `tenant/bu:*/site:hamburg` matches
the Hamburg site under any business unit.

A role grant carries its own scope, which combines with the scope its binding was made
at. Whichever is narrower wins, and disjoint scopes mean the grant simply does not apply.
That is how a role can say "read everywhere, approve only in EMEA" and stay safe even if
someone later widens the binding.

## Decision algorithm

`evaluate()` in `src/application/policy/evaluator.ts` is a pure function — no
repositories, no clock, no side effects — so the whole policy is testable in isolation
and its results are safe to cache.

1. The tenant must be active, else `DENIED_TENANT_INACTIVE`.
2. The subject must be enabled (not suspended, locked, revoked or expired), else
   `DENIED_SUBJECT_INACTIVE`.
3. An API key's scope-down list must admit the permission, else
   `DENIED_CREDENTIAL_RESTRICTION`.
4. Collect grants from every active binding for the subject **and its groups**, flatten
   role inheritance, and keep the grants whose effective scope covers the request.
5. **Any matching deny wins** — `DENIED_BY_EXPLICIT_DENY`.
6. Otherwise a matching allow permits the action — `ALLOWED_BY_GRANT`, or
   `ALLOWED_BY_SUPERUSER` for `**:*`.
7. Otherwise default deny, distinguishing `DENIED_SCOPE_MISMATCH` (you hold the
   permission, but not here) from `DENIED_ALL_BINDINGS_EXPIRED` and
   `DENIED_NO_MATCHING_GRANT`.

Role inheritance is a DAG: diamonds resolve once at their shallowest depth, cycles are a
configuration error and are rejected when the role is saved.

### Caching

Decisions are cached per `(tenant, subject, permission, scope, restrictions)` with a
short TTL, keyed on a per-tenant policy version. Anything that can change an outcome —
role edits, binding grants and revocations, group membership, tenant status, user status,
API key revocation — bumps that version, so a suspension takes effect on the next call
rather than when the TTL happens to lapse.

### Introspection

`GET /identity/me` and `PermissionSet` answer "what may I do here" by evaluating the
catalog rather than by reading grants directly, and they pass the caller's credential
restrictions through. A restricted API key therefore reports what it can actually do,
not what its roles would allow on their own — anything these list will survive a real
check, which is what makes them safe to drive a UI from.

## Secret handling

No plaintext secret is ever stored.

- **Passwords**: PBKDF2-SHA512 with a per-password salt; parameters are stored alongside
  the digest so an iteration bump keeps old hashes verifiable. `needsRehash` flags the
  stragglers. Swap in Argon2id behind the `PasswordHasher` port without touching callers.
- **API keys**: presented as `esk_<prefix>_<secret>`. The prefix is stored in clear so a
  lookup is one indexed read; the secret is kept as a salted SHA-256 digest and returned
  to the caller exactly once, at issue or rotation time.
- **Session tokens**: `est_<sessionId>_<secret>`, same digest treatment. Refresh rotates
  both halves by default, and a refresh secret that fails to verify against a real
  session revokes that session — a replayed token is treated as a compromise, not a typo.
- **MFA**: only a digest of the enrollment secret is kept.

Secrets are base64url, whose alphabet includes the `_` that separates the token's parts,
so both parsers treat only the leading segments as structural and rejoin the rest as the
opaque secret. The API key lookup prefix is drawn from a lowercase alphanumeric alphabet
so it can never introduce a separator of its own.

Comparisons use `timingSafeEqual`. `toPublicJSON()` on users, keys and sessions is the
projection the HTTP layer returns, and it never includes derived material.

## Layout

```
src/
  domain/          aggregates, value objects, permission/scope algebra, events, errors
  application/     ports, services, and the pure policy evaluator under policy/
  infrastructure/  clock, hashing, in-memory repositories, outbox, bootstrap, container
  http/            router, request identity, route modules, server
  rbac/            helpers other contexts call: can, requirePermission, PermissionSet
  fixtures/        demo tenant seed
migrations/        PostgreSQL schema, constraints, views and helper functions
tests/             unit and HTTP integration tests
```

Repositories are in-memory behind narrow interfaces (`src/application/ports.ts`); the SQL
schema in `migrations/` is the shape the Postgres implementations will map onto.

## Using it from another context

```ts
import {
  createIdentityModule,
  requirePermission,
  PermissionSet,
} from "@enterprise-suite/identity-access";

const identity = createIdentityModule();

// At the edge: turn a credential into a principal.
const principal = identity.authentication.authenticateBearer(request.headers.authorization);

// In a handler: throw 403 unless the caller may act at this scope.
requirePermission(identity.authorization, principal, "sales.order:approve", {
  scope: "tenant/bu:emea",
  resourceId: order.id,
});

// Non-throwing variants for rendering decisions.
if (identity.authorization.can(principal, "sales.order:create")) {
  /* show the button */
}

// One round trip for a whole screen.
const permissions = PermissionSet.from(identity.authorization, principal);
permissions.has("sales.order:approve");
```

`guarded()` wraps a handler in a check, and `filterByScope()` narrows a collection to the
rows a caller may see with one decision per distinct scope.

## HTTP API

`createIdentityServer(module)` returns a `node:http` server. `GET /identity/routes` lists
every route with the permission it requires; authentication and that check happen in the
router, so no handler can forget them.

| Area      | Endpoints                                                                              |
| --------- | -------------------------------------------------------------------------------------- |
| Auth      | `POST /identity/auth/login`, `/refresh`, `/logout`; `GET /identity/me`                   |
| Tenants   | `POST /identity/tenants`, `GET|PATCH /identity/tenants/:id`, `/activate`, `/suspend`     |
| Users     | `GET|POST /identity/users`, `/:id/activate`, `/password`, `/suspend`, `/unlock`, `/mfa`  |
| Groups    | `GET|POST /identity/groups`, `/:id/members`                                              |
| Roles     | `GET|POST /identity/roles`, `/:code/grants`, `/inherits`, `/clone`, `/effective`         |
| Bindings  | `GET|POST /identity/role-bindings`, `/delegate`, `/expiring`, `DELETE /:id`              |
| API keys  | `GET|POST /identity/api-keys`, `/:id/rotate`, `/restrictions`, `DELETE /:id`             |
| Authz     | `POST /identity/authz/check`, `/check-batch`, `/explain`; `GET /identity/permissions`    |
| Audit     | `GET /identity/audit`, `/denials`, `/denial-summary`, `/subject-activity`, `/export`     |

Callers authenticate with `Authorization: Bearer <token>` (a session token or an API key).
Internal callers inside the monolith may instead send `x-tenant-id` / `x-user-id`, the
convention described in `docs/ARCHITECTURE.md`.

Errors are `{ "error": { "code", "message", "details" } }` with a stable machine-readable
code — `WEAK_PASSWORD`, `AUTHORIZATION_DENIED`, `SYSTEM_ROLE_IMMUTABLE` and so on. Clients
branch on `code`, never on the message.

## Auditing

Denials are always recorded. Allows are recorded only when the tenant sets
`auditAllDecisions`, because a busy tenant produces far more allows than anyone will read.
Each entry carries the subject, permission, scope, reason code, the matched role and the
correlation id of the request, so `GET /identity/audit/trace/:correlationId` reconstructs
everything one inbound call decided.

`denialSummary()` groups denials by permission and reason — the report that tells you a
*role* is missing a permission rather than an individual being misconfigured.

## Seeded roles

`installSystemRoles(tenantId)` gives a tenant an immutable starting set: `platform_owner`,
`tenant_admin`, `security_admin`, `user_manager`, `auditor`, `integration_client`,
`member`, and the non-assignable `base_reader` building block the others inherit. Tenants
customize by cloning (`POST /identity/roles/:code/clone`), which is what keeps a platform
upgrade from being silently reverted by a local edit.

`seedDemoTenant(module)` builds a realistic tenant on top of that — a scope tree, two
tenant-defined roles, nested groups, a time-boxed contractor binding and an integration
API key — used by the demo server and most tests.

## Database

Nine migrations under `migrations/`. Highlights:

- Every table is tenant-scoped with `tenant_id` leading the primary key.
- Domains validate permission keys, grant patterns, scope paths and role codes in the
  database, so a malformed grant cannot land even if it bypasses the application.
- `role_effective_grants` and `user_effective_bindings` are recursive views that flatten
  role inheritance and group nesting for reporting.
- A partial unique index allows one *active* binding per subject/role/scope while keeping
  revoked rows for audit.
- `audit_log` is append-only, enforced by a trigger; retention runs through
  `purge_audit_before()`.
- Domain events land in an `outbox` table with `claim_outbox_batch()` for the relay.

## Development

```bash
npm run build      # tsc to dist/
npm run typecheck  # src + tests, no emit
npm test           # node:test via tsx
npm start          # demo server on :8087 with the seeded tenant
```

213 tests cover the permission and scope algebra, role inheritance and dedup, lockout,
password history, session expiry and refresh rotation, API key restrictions and IP
allowlists, delegation, group-inherited bindings, cache invalidation, the audit queries
and the HTTP surface end to end. Most run on a fixed clock and a deterministic token
generator; `tests/credential-format.test.ts` deliberately uses the production generator,
because token shape is exactly the thing a deterministic stand-in cannot exercise.
