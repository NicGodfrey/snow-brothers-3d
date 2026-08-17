#!/usr/bin/env node
/**
 * Live go-live probe: N parallel /v1/ask calls against official slots.
 * Does not print secrets. Requires a running control plane.
 */
const base = (process.env.AGI_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const n = Number(process.env.AGI_CONCURRENCY ?? 10);
const question =
  process.env.AGI_QUESTION ??
  "Go-live concurrent probe. Reply with exactly: LIVE OK";

const health = await fetch(`${base}/health`);
if (!health.ok) {
  console.error(`health ${health.status} from ${base}`);
  process.exit(2);
}
const info = await health.json();
const official = (info.fleet?.slots ?? [])
  .filter((s) => s.source === "official" && s.status === "idle")
  .map((s) => s.name)
  .slice(0, n);

if (official.length === 0) {
  console.error("no official idle slots");
  process.exit(2);
}

const started = Date.now();
console.log(
  JSON.stringify({
    event: "start",
    base,
    transport: info.transport,
    modelId: info.modelId,
    modelParams: info.modelParams,
    sessionMode: info.sessionMode,
    targets: official,
  }),
);

const results = await Promise.all(
  official.map(async (target) => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/v1/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, target }),
      });
      const job = await res.json();
      const row = {
        target,
        http: res.status,
        jobId: job.id,
        status: job.status,
        agentId: job.assignments?.[0]?.agentId,
        runId: job.assignments?.[0]?.runId,
        durationMs: Date.now() - t0,
        answer: (job.assignments?.[0]?.answer ?? job.synthesis ?? "").slice(0, 240),
        error: job.assignments?.[0]?.error ?? job.error ?? null,
      };
      console.log(JSON.stringify({ event: "done", ...row }));
      return row;
    } catch (error) {
      const row = {
        target,
        status: "failed",
        durationMs: Date.now() - t0,
        error: error instanceof Error ? error.message : String(error),
      };
      console.log(JSON.stringify({ event: "done", ...row }));
      return row;
    }
  }),
);

const ok = results.filter((r) => r.status === "succeeded").length;
const summary = {
  event: "summary",
  total: results.length,
  succeeded: ok,
  failed: results.length - ok,
  wallMs: Date.now() - started,
  results,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(ok === results.length ? 0 : 1);
