import type { AgiConfig } from "./config.ts";
import type { CursorTransport } from "./cursor/types.ts";
import { AgiError, TransportError } from "./errors.ts";
import { JobStore } from "./jobs.ts";
import { KeyLock, Semaphore } from "./limiter.ts";
import { wrapQuestion } from "./prompts.ts";
import type { FleetRegistry } from "./registry.ts";
import { route, type RoutedJob } from "./router.ts";
import { synthesize } from "./synthesis.ts";
import type { AskRequest, Assignment, Job, Metrics } from "./types.ts";

export class Scheduler {
  readonly jobs = new JobStore();
  readonly global: Semaphore;
  private readonly agentLocks = new KeyLock();
  peakInFlight = 0;

  constructor(
    readonly registry: FleetRegistry,
    readonly transport: CursorTransport,
    readonly config: AgiConfig,
  ) {
    this.global = new Semaphore(config.maxInFlight);
  }

  metrics(): Metrics {
    const counts = this.jobs.counts();
    return {
      jobsTotal: counts.total,
      jobsSucceeded: counts.succeeded,
      jobsFailed: counts.failed,
      jobsPartial: counts.partial,
      inFlight: this.global.inFlight,
      maxInFlight: this.config.maxInFlight,
      peakInFlight: this.global.peak,
      dispatchable: this.registry.dispatchable().length,
    };
  }

  async submit(request: AskRequest): Promise<Job> {
    const routed = route(this.registry, request);
    const job = this.jobs.create(routed);
    await this.execute(job, routed);
    return this.jobs.get(job.id);
  }

  async provision(limit = 101): Promise<Job> {
    const missing = this.registry.slots.filter(
      (s) => s.status === "unprovisioned" || s.status === "error",
    );
    const targets = missing.slice(0, limit);
    if (targets.length === 0) {
      throw new AgiError("fleet_full", "All 101 slots are already bound");
    }
    const assignments: Assignment[] = targets.map((slot) => ({
      slotName: slot.name,
      agentId: slot.agentId ?? "pending",
      status: "pending",
    }));
    const job = this.jobs.create({
      mode: "ask",
      intent: "meta",
      question: `Provision ${targets.length} official Cloud Agents into empty fleet slots.`,
      assignments,
    });
    this.jobs.setStatus(job.id, "running");

    await Promise.all(
      targets.map(async (slot, index) => {
        await this.global.acquire();
        try {
          const created = await this.transport.createAgent({
            name: slot.name,
            prompt: wrapQuestion({
              slotName: slot.name,
              question: `Stand by as ${slot.name} on the Lucy 101-slot fleet. Reply with exactly: ready ${slot.name}.`,
              mode: "ask",
              intent: "meta",
            }),
            repoUrl: this.config.repoUrl,
            startingRef: this.config.startingRef,
            modelId: this.config.modelId,
            modelParams: this.config.modelParams,
          });
          this.registry.bind(slot.name, created.agent.id);
          assignments[index] = {
            slotName: slot.name,
            agentId: created.agent.id,
            runId: created.run.id,
            status: "succeeded",
            answer: `provisioned ${created.agent.id}`,
          };
        } catch (error) {
          assignments[index] = {
            slotName: slot.name,
            agentId: slot.agentId ?? "pending",
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          this.global.release();
        }
      }),
    );

    const failed = assignments.filter((a) => a.status === "failed").length;
    this.jobs.update(job.id, {
      assignments,
      status: failed === 0 ? "succeeded" : failed === assignments.length ? "failed" : "partial",
      synthesis: `Provisioned ${assignments.length - failed}/${assignments.length} slots.`,
    });
    return this.jobs.get(job.id);
  }

  private async execute(job: Job, routed: RoutedJob): Promise<void> {
    this.jobs.setStatus(job.id, "running");
    const results = await Promise.all(
      routed.assignments.map((assignment) =>
        this.dispatchOne(
          assignment,
          routed.prompts.get(assignment.slotName)!,
          routed.sessionMode,
        ),
      ),
    );
    this.jobs.update(job.id, { assignments: results });
    const failed = results.filter((a) => a.status === "failed").length;
    const ok = results.filter((a) => a.status === "succeeded").length;
    const status =
      failed === 0 ? "succeeded" : ok === 0 ? "failed" : "partial";
    this.jobs.update(job.id, {
      status,
      synthesis: synthesize(results),
      error: ok === 0 ? results[0]?.error : undefined,
    });
  }

  private async dispatchOne(
    assignment: Assignment,
    prompt: string,
    routedSessionMode?: RoutedJob["sessionMode"],
  ): Promise<Assignment> {
    await this.global.acquire();
    this.peakInFlight = Math.max(this.peakInFlight, this.global.inFlight);
    try {
      return await this.agentLocks.run(assignment.slotName, async () => {
        this.registry.mark(assignment.slotName, "busy");
        const started = Date.now();
        const previousId = assignment.agentId;
        try {
          const sessionMode = routedSessionMode ?? this.config.sessionMode;
          let agentId = previousId;
          let runId: string;
          if (sessionMode === "fresh") {
            const created = await this.transport.createAgent({
              name: assignment.slotName,
              prompt,
              repoUrl: this.config.repoUrl,
              startingRef: this.config.startingRef,
              modelId: this.config.modelId,
              modelParams: this.config.modelParams,
            });
            agentId = created.agent.id;
            runId = created.run.id;
            this.registry.bind(assignment.slotName, agentId);
            if (previousId && previousId !== agentId) {
              await this.transport.archiveAgent(previousId).catch(() => undefined);
            }
          } else {
            const run = await this.transport.createRun(previousId, prompt);
            runId = run.id;
          }
          const finished = await this.transport.waitForRun(agentId, runId);
          if (finished.status !== "FINISHED") {
            throw new TransportError(
              "run_failed",
              `Run ${runId} ended ${finished.status}`,
              502,
            );
          }
          this.registry.mark(assignment.slotName, "idle");
          return {
            ...assignment,
            agentId,
            runId,
            status: "succeeded",
            answer: finished.result ?? "",
            durationMs: Date.now() - started,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const legacy =
            /legacy workflow|http_404|http_400/i.test(message) &&
            /legacy|not found|not running/i.test(message);
          this.registry.mark(
            assignment.slotName,
            legacy ? "error" : "idle",
            legacy
              ? "This Task-spawned agent is not follow-upable on the official API. Provision a replacement."
              : undefined,
          );
          return {
            ...assignment,
            status: "failed",
            error: message,
            durationMs: Date.now() - started,
          };
        }
      });
    } finally {
      this.global.release();
    }
  }
}
