# Deploy readiness review

Review queue: Sol ultra (`gpt-5.6-sol-xhigh`) ×3 + Fable5 top (`claude-fable-5-thinking-xhigh`) ×3.

## Verdict

**NOT READY for production deploy.**  
**Demo / local prototype only.** Do not expose to the public internet.

| Question | Answer |
|----------|--------|
| Full-stack OK? | Domain modules OK in isolation; suite integration is incomplete |
| Directly deployable? | No |
| Local demo usable? | Yes (`npm install && npm run suite:start`) |

## Consensus across agents

1. **Architecture** — Monorepo of strong bounded contexts, not a production-integrated system. Portal defaults to mock transport; gateway routes partially mismatch upstreams; outboxes never leave their process.
2. **Deploy/ops** — No Docker/K8s/CI/IaC; no `DATABASE_URL` or DB drivers; migrations exist but are never applied; all repos are in-memory; restart loses data.
3. **Security** — Caller-controlled `x-tenant-id` / `x-user-id` / `x-roles` trusted as auth; portal passwordless mock login; open CORS; seeded known passwords. Not internet-safe.
4. **ERP domains** — Deep, well-tested vertical slices (~919 ERP tests). Cross-domain flows (order→stock→invoice, marketing handoff, etc.) are event stubs with no consumers.
5. **SRM/PRM** — Rich domain kernels and gateway CRUD for a thin slice; portal fixtures diverge from live services; match engine complete but policy feed stubbed; no supplier/partner-facing apps.
6. **Tests/build** — Cold build + ~2414 workspace tests pass. Blockers: stale `package-lock.json` breaks `npm ci`; gateway readiness permanently 503 because finance/MES protect `/health`.

## Must-fix before any private pilot

1. Postgres (or equivalent) adapters + migration runner + durable outbox relay  
2. Identity as authority; gateway verifies tokens; strip spoofable identity headers  
3. Portal `PORTAL_TRANSPORT=http` with correct gateway port and aligned API contracts  
4. Complete/fix gateway routes; add gateway→service contract tests  
5. Containers + TLS + secrets + CI; fix lockfile and health/readiness contracts  

## What is good today

- Strict TypeScript, meaningful domain/HTTP tests, suite launcher boots many processes locally  
- Domain depth across ERP/SRM/PRM is substantial reference architecture  
- Seams (ports, migrations, outbox shapes) are in the right places for later hardening  
