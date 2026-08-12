# Agent Contract — Enterprise Suite

## Hard rules

1. Write code ONLY under `/workspace/enterprise-suite/`.
2. Do NOT pad with repeated dummy lines, generated noise, or copy-paste filler to inflate LOC.
3. Prefer real domain depth: aggregates, commands, queries, validators, repos, HTTP routes, SQL migrations, fixtures, unit tests.
4. Every service is a workspace package under `services/<name>` or `apps/<name>` or `packages/<name>`.
5. Use TypeScript ESM (`"type": "module"`), extend `../../tsconfig.base.json`.
6. Depend on `@enterprise-suite/shared-kernel` via workspace protocol where useful; you may also duplicate small local types if needed to avoid blocking.
7. Expose: `src/index.ts`, `src/domain/*`, `src/application/*`, `src/infrastructure/*`, `src/http/*`, `migrations/*.sql`, `tests/*`, `README.md`.
8. package.json scripts: `build`, `test`, `typecheck`, `lint`.
9. In-memory repositories are OK; keep interfaces clean for later Postgres.
10. Emit domain events via envelopes compatible with shared-kernel style.
11. Multi-tenant: every aggregate carries `tenantId`.
12. When finished, ensure `npm run build` works for your package in isolation if possible.

## Target depth (quality over raw LOC)

Aim for a complete vertical slice of your domain with many real entities/use-cases — typically thousands of meaningful lines across models, services, routes, migrations, and tests — not millions of empty stubs.
