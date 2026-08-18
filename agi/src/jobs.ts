import { randomUUID } from "node:crypto";
import { AgiError } from "./errors.ts";
import type { Assignment, Intent, Job, JobStatus, QaMode } from "./types.ts";

export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(input: {
    mode: QaMode;
    intent: Intent;
    question: string;
    assignments: Assignment[];
  }): Job {
    const now = new Date().toISOString();
    const job: Job = {
      id: `job-${randomUUID()}`,
      mode: input.mode,
      intent: input.intent,
      question: input.question,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      assignments: input.assignments,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new AgiError("unknown_job", `Unknown job ${id}`, 404);
    return job;
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  update(id: string, patch: Partial<Job>): Job {
    const job = this.get(id);
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  }

  setStatus(id: string, status: JobStatus, error?: string): Job {
    return this.update(id, { status, error });
  }

  counts(): { total: number; succeeded: number; failed: number; partial: number } {
    let succeeded = 0;
    let failed = 0;
    let partial = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "succeeded") succeeded += 1;
      else if (job.status === "failed") failed += 1;
      else if (job.status === "partial") partial += 1;
    }
    return { total: this.jobs.size, succeeded, failed, partial };
  }
}
