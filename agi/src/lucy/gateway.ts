import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgiConfig } from "../config.ts";
import type { CursorTransport } from "../cursor/types.ts";
import { AgiError } from "../errors.ts";
import { formatSse } from "../sse.ts";
import { StreamWatchdog } from "./watchdog.ts";
import type { LucyPool } from "./pool.ts";
import type {
  LucyAskRequest,
  LucyFulfillName,
  LucyHealth,
  LucyJob,
  LucyJobStatus,
  LucySseEvent,
} from "./types.ts";

interface LiveJob {
  job: LucyJob;
  watchdog: StreamWatchdog;
  heartbeat?: ReturnType<typeof setInterval>;
  abort: AbortController;
  listeners: Set<ServerResponse>;
}

const TERMINAL: LucyJobStatus[] = ["succeeded", "failed", "aborted"];
const MAX_JOBS = 500;

export class LucyGateway {
  private readonly jobs = new Map<string, LiveJob>();

  constructor(
    readonly pool: LucyPool,
    readonly config: AgiConfig,
    readonly transport: CursorTransport,
  ) {}

  health(): LucyHealth {
    return {
      ...this.pool.snapshot(),
      pool: this.config.lucyPool,
      fulfill: this.config.lucyFulfill,
      streamIdleTimeoutMs: this.config.streamIdleTimeoutMs,
      streamHeartbeatMs: this.config.streamHeartbeatMs,
      maxBodyBytes: this.config.maxBodyBytes,
    };
  }

  list(): LucyJob[] {
    return [...this.jobs.values()]
      .map((live) => live.job)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  pending(): LucyJob[] {
    return this.list().filter((j) => j.status === "running" && j.fulfill === "queue");
  }

  get(id: string): LucyJob {
    const live = this.jobs.get(id);
    if (!live) throw new AgiError("unknown_job", `Unknown lucy job ${id}`, 404);
    return live.job;
  }

  create(request: LucyAskRequest): LucyJob {
    const question = request.question?.trim() ?? "";
    if (!question) throw new AgiError("empty_question", "Question is required");
    const conversationId = request.conversationId?.trim() || `conv-${randomUUID()}`;
    const pool = this.pool.resolvePool(
      request.pool,
      this.config.lucyPool,
      this.config.transport,
    );
    const slot = this.pool.acquire({
      pool,
      conversationId,
      target: request.target,
    });
    const fulfill = resolveFulfill(this.config, slot.kind);
    const now = Date.now();
    const job: LucyJob = {
      id: `lucy-${randomUUID()}`,
      conversationId,
      lucyName: slot.name,
      agentId: slot.agentId,
      kind: slot.kind,
      fulfill,
      question,
      status: "running",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      answer: "",
      events: [],
      startedAtMs: now,
      lastModelAtMs: now,
    };
    const abort = new AbortController();
    const watchdog = new StreamWatchdog(this.config.streamIdleTimeoutMs, () => {
      this.fail(
        job.id,
        "stream_idle_timeout",
        `No model tokens for ${this.config.streamIdleTimeoutMs}ms (Claude Code-style idle watchdog)`,
      );
    });
    const live: LiveJob = {
      job,
      watchdog,
      abort,
      listeners: new Set(),
    };
    this.jobs.set(job.id, live);
    this.gc();
    this.emit(live, "meta", {
      jobId: job.id,
      conversationId,
      lucy: { name: slot.name, agentId: slot.agentId, kind: slot.kind },
      fulfill,
      idleTimeoutMs: this.config.streamIdleTimeoutMs,
      maxBodyBytes: this.config.maxBodyBytes,
    });
    return job;
  }

  start(jobId: string, conversationMode?: "agent" | "plan"): void {
    const live = this.require(jobId);
    live.watchdog.start();
    if (this.config.streamHeartbeatMs > 0) {
      live.heartbeat = setInterval(() => {
        if (live.job.status !== "running") return;
        this.write(live, {
          id: `hb-${Date.now()}`,
          event: "heartbeat",
          data: { ts: new Date().toISOString() },
        });
      }, this.config.streamHeartbeatMs);
      live.heartbeat.unref?.();
    }
    void this.fulfill(live, conversationMode);
  }

  attach(jobId: string, req: IncomingMessage, res: ServerResponse): void {
    const live = this.require(jobId);
    if (!res.headersSent) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      });
      res.socket?.setNoDelay(true);
    }
    for (const event of live.job.events) {
      res.write(formatSse(event.event, event.data, event.id));
    }
    if (TERMINAL.includes(live.job.status)) {
      res.end();
      return;
    }
    live.listeners.add(res);
    const detach = (): void => {
      live.listeners.delete(res);
    };
    res.on("close", detach);
    req.socket?.on("close", detach);
  }

  injectTokens(jobId: string, text: string): LucyJob {
    const live = this.requireRunning(jobId);
    if (!text) throw new AgiError("empty_tokens", "Token text is required");
    live.job.answer += text;
    this.emitModel(live, "delta", { text });
    return live.job;
  }

  complete(jobId: string, text?: string): LucyJob {
    const live = this.jobs.get(jobId);
    if (!live) throw new AgiError("unknown_job", `Unknown lucy job ${jobId}`, 404);
    if (TERMINAL.includes(live.job.status)) return live.job;
    if (text) live.job.answer = text;
    live.job.status = "succeeded";
    live.job.updatedAt = new Date().toISOString();
    this.emitModel(live, "result", { text: live.job.answer });
    this.finish(live, "succeeded");
    return live.job;
  }

  fail(jobId: string, code: string, message: string): LucyJob {
    const live = this.jobs.get(jobId);
    if (!live) throw new AgiError("unknown_job", `Unknown lucy job ${jobId}`, 404);
    if (TERMINAL.includes(live.job.status)) return live.job;
    live.job.status = code === "stream_idle_timeout" ? "aborted" : "failed";
    live.job.error = message;
    live.job.errorCode = code;
    live.job.updatedAt = new Date().toISOString();
    this.emit(live, "error", { code, message });
    this.finish(live, live.job.status);
    return live.job;
  }

  abortAll(): void {
    for (const live of this.jobs.values()) {
      if (live.job.status === "running") {
        this.fail(live.job.id, "aborted", "Control plane is shutting down");
      }
    }
  }

  async wait(jobId: string): Promise<LucyJob> {
    const live = this.require(jobId);
    if (TERMINAL.includes(live.job.status)) return live.job;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (TERMINAL.includes(live.job.status)) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
      timer.unref?.();
    });
    return live.job;
  }

  private async fulfill(
    live: LiveJob,
    conversationMode?: "agent" | "plan",
  ): Promise<void> {
    try {
      if (live.job.fulfill === "queue") return;
      if (live.job.fulfill === "official") {
        await this.fulfillOfficial(live, conversationMode);
        return;
      }
      await this.fulfillMock(live);
    } catch (error) {
      if (live.abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      this.fail(live.job.id, "fulfill_failed", message);
    }
  }

  private async fulfillMock(live: LiveJob): Promise<void> {
    const text = `[${live.job.lucyName}] ${live.job.question.slice(0, 280)}`;
    const chunks = chunkText(text, 24);
    for (const part of chunks) {
      if (live.abort.signal.aborted) return;
      if (this.config.lucyMockDelayMs > 0) {
        await sleep(this.config.lucyMockDelayMs, live.abort.signal);
      }
      live.job.answer += part;
      this.emitModel(live, "delta", { text: part });
    }
    if (!live.abort.signal.aborted) this.complete(live.job.id, text);
  }

  private async fulfillOfficial(
    live: LiveJob,
    conversationMode?: "agent" | "plan",
  ): Promise<void> {
    let run = await this.transport.createRun(
      live.job.agentId,
      live.job.question,
      conversationMode,
    );
    while (run.status === "CREATING" && !live.abort.signal.aborted) {
      await sleep(300, live.abort.signal);
      run = await this.transport.getRun(live.job.agentId, run.id);
    }
    if (!live.abort.signal.aborted) {
      await sleep(800, live.abort.signal);
    }
    for (let attempt = 0; attempt < 6 && live.job.status === "running"; attempt += 1) {
      let retry = false;
      let sawModel = false;
      try {
      for await (const frame of this.transport.streamRun(live.job.agentId, run.id, {
        signal: live.abort.signal,
      })) {
        if (live.abort.signal.aborted) return;
        if (frame.event === "assistant" || frame.event === "delta") {
          const text = textOf(frame.data);
          if (text) {
            sawModel = true;
            live.job.answer += text;
            this.emitModel(live, "delta", { text });
          }
        } else if (frame.event === "thinking") {
          const text = textOf(frame.data);
          if (text) {
            sawModel = true;
            this.emitModel(live, "thinking", { text });
          }
        } else if (frame.event === "interaction_update") {
          const data = asRecord(frame.data);
          const text = textOf(data);
          if (data.type === "text-delta" && text) {
            sawModel = true;
            live.job.answer += text;
            this.emitModel(live, "delta", { text });
          } else if (data.type === "thinking-delta" && text) {
            sawModel = true;
            this.emitModel(live, "thinking", { text });
          } else if (data.type === "token-delta") {
            sawModel = true;
            live.watchdog.touch();
          }
        } else if (frame.event === "result") {
          const text = textOf(frame.data) || live.job.answer;
          this.complete(live.job.id, text);
          return;
        } else if (frame.event === "error") {
          const data = asRecord(frame.data);
          if (data.code === "stream_unavailable" && !sawModel) {
            retry = true;
            break;
          }
          this.fail(
            live.job.id,
            String(data.code ?? "official_stream_error"),
            String(data.message ?? "Official stream error"),
          );
          return;
        }
      }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (live.abort.signal.aborted) return;
        if (/stream_unavailable|http_409/i.test(message)) {
          retry = true;
        } else {
          throw error;
        }
      }
      if (!retry || live.job.status !== "running") break;
      await sleep(400 * 2 ** attempt, live.abort.signal);
    }
    if (live.job.status === "running") {
      const finished = await this.transport.waitForRun(live.job.agentId, run.id);
      this.complete(live.job.id, finished.result ?? live.job.answer);
    }
  }

  private emitModel(
    live: LiveJob,
    event: string,
    data: Record<string, unknown>,
  ): void {
    live.job.lastModelAtMs = Date.now();
    live.watchdog.touch();
    this.emit(live, event, data);
  }

  private emit(live: LiveJob, event: string, data: Record<string, unknown>): void {
    const frame: LucySseEvent = {
      id: String(live.job.events.length + 1),
      event,
      data,
    };
    live.job.events.push(frame);
    live.job.updatedAt = new Date().toISOString();
    this.write(live, frame);
  }

  private write(live: LiveJob, frame: LucySseEvent): void {
    const chunk = formatSse(frame.event, frame.data, frame.id);
    for (const res of live.listeners) {
      if (!res.writableEnded) res.write(chunk);
    }
  }

  private finish(live: LiveJob, status: LucyJobStatus): void {
    live.job.status = status;
    live.watchdog.stop();
    if (live.heartbeat) clearInterval(live.heartbeat);
    live.abort.abort();
    this.pool.release(live.job.lucyName, live.job.kind);
    this.emit(live, "done", {
      status,
      jobId: live.job.id,
      conversationId: live.job.conversationId,
      durationMs: Date.now() - live.job.startedAtMs,
    });
    for (const res of live.listeners) {
      if (!res.writableEnded) res.end();
    }
    live.listeners.clear();
  }

  private require(jobId: string): LiveJob {
    const live = this.jobs.get(jobId);
    if (!live) throw new AgiError("unknown_job", `Unknown lucy job ${jobId}`, 404);
    return live;
  }

  private requireRunning(jobId: string): LiveJob {
    const live = this.require(jobId);
    if (live.job.status !== "running") {
      throw new AgiError("job_not_running", `Job ${jobId} is ${live.job.status}`, 409);
    }
    return live;
  }

  private gc(): void {
    const finished = [...this.jobs.values()]
      .filter((live) => TERMINAL.includes(live.job.status))
      .sort((a, b) => a.job.updatedAt.localeCompare(b.job.updatedAt));
    while (this.jobs.size > MAX_JOBS && finished.length > 0) {
      const oldest = finished.shift();
      if (oldest) this.jobs.delete(oldest.job.id);
    }
  }
}

export function resolveFulfill(
  config: AgiConfig,
  kind: LucyJob["kind"],
): Exclude<LucyFulfillName, "auto"> {
  if (config.lucyFulfill !== "auto") return config.lucyFulfill;
  if (config.transport === "mock") return "mock";
  if (kind === "official") return "official";
  return "queue";
}

function chunkText(text: string, size: number): string[] {
  if (!text) return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  const rec = asRecord(data);
  if (typeof rec.text === "string") return rec.text;
  return "";
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
