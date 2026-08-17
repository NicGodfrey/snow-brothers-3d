import { randomUUID } from "node:crypto";
import { TransportError } from "../errors.ts";
import type { ConversationMode } from "../types.ts";
import {
  asRunInput,
  type CreateAgentInput,
  type CreateRunInput,
  type CursorAgent,
  type PromptImage,
  type CursorRun,
  type CursorStreamEvent,
  type CursorTransport,
} from "./types.ts";

interface MockAgent extends CursorAgent {
  busy: boolean;
  archived: boolean;
  history: string[];
  artifacts: Array<{ path: string; sizeBytes: number; updatedAt: string }>;
}

export class MockCursorClient implements CursorTransport {
  readonly agents = new Map<string, MockAgent>();
  readonly runs = new Map<string, CursorRun>();
  latencyMs = 5;
  failNext = false;
  streamUnavailableOnce = false;
  streamToolCall = false;
  holdStream = false;
  autoFinish = true;
  busyIds = new Set<string>();
  lastCreate?: CreateAgentInput;
  lastRun?: CreateRunInput;
  cancelled = new Set<string>();

  constructor(seedIds: string[] = []) {
    for (const id of seedIds) {
      this.agents.set(id, {
        id,
        name: id,
        status: "ACTIVE",
        url: `https://cursor.com/agents/${id}`,
        busy: false,
        archived: false,
        history: [],
        artifacts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async getAgent(id: string): Promise<CursorAgent> {
    await this.delay();
    return this.requireAgent(id);
  }

  async listAgents(query?: Record<string, string | undefined>): Promise<unknown> {
    await this.delay();
    const includeArchived = query?.includeArchived !== "false";
    return {
      items: [...this.agents.values()]
        .filter((a) => includeArchived || !a.archived)
        .map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          url: a.url,
          latestRunId: a.latestRunId,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
    };
  }

  async createRun(
    id: string,
    prompt: string | CreateRunInput,
    mode?: ConversationMode,
  ): Promise<CursorRun> {
    const input = asRunInput(prompt, mode);
    this.lastRun = input;
    await this.delay();
    const agent = this.requireAgent(id);
    if (agent.archived) {
      throw new TransportError("http_409", `Agent ${id} is archived`, 409);
    }
    if (agent.busy || this.busyIds.has(id)) {
      throw new TransportError("agent_busy", `Agent ${id} is busy`, 409, true);
    }
    if (this.failNext) {
      this.failNext = false;
      throw new TransportError("http_500", "injected failure", 500, true);
    }
    agent.busy = true;
    agent.history.push(input.prompt);
    const run: CursorRun = {
      id: `run-${randomUUID()}`,
      agentId: id,
      status: "RUNNING",
      result: mockAnswer(id, input.prompt),
    };
    this.runs.set(run.id, run);
    agent.latestRunId = run.id;
    queueMicrotask(() => {
      if (!this.autoFinish || this.cancelled.has(run.id)) return;
      run.status = "FINISHED";
      agent.busy = false;
    });
    return run;
  }

  async listRuns(id: string): Promise<unknown> {
    await this.delay();
    this.requireAgent(id);
    return {
      items: [...this.runs.values()].filter((r) => r.agentId === id),
    };
  }

  async getRun(_id: string, runId: string): Promise<CursorRun> {
    await this.delay();
    const run = this.runs.get(runId);
    if (!run) throw new TransportError("http_404", `Unknown run ${runId}`, 404);
    return run;
  }

  async cancelRun(id: string, runId: string): Promise<unknown> {
    await this.delay();
    this.requireAgent(id);
    const run = this.runs.get(runId);
    if (!run) throw new TransportError("http_404", `Unknown run ${runId}`, 404);
    if (run.status !== "RUNNING" && run.status !== "CREATING") {
      throw new TransportError("run_not_cancellable", "run is not active", 409);
    }
    run.status = "CANCELLED";
    this.cancelled.add(runId);
    const agent = this.agents.get(id);
    if (agent) agent.busy = false;
    return { id: runId };
  }

  async createAgent(
    input: CreateAgentInput,
  ): Promise<{ agent: CursorAgent; run: CursorRun }> {
    this.lastCreate = input;
    await this.delay();
    const id = input.agentId?.trim() || `bc-mock-${randomUUID()}`;
    if (this.agents.has(id)) {
      throw new TransportError("agent_id_conflict", `Agent ${id} already exists`, 409);
    }
    const agent: MockAgent = {
      id,
      name: input.name,
      status: "ACTIVE",
      url: `https://cursor.com/agents/${id}`,
      busy: false,
      archived: false,
      history: [],
      artifacts: input.images?.length
        ? [
            {
              path: "artifacts/upload.txt",
              sizeBytes: 12,
              updatedAt: new Date().toISOString(),
            },
          ]
        : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.agents.set(id, agent);
    const run = await this.createRun(id, {
      prompt: input.prompt,
      images: input.images,
      mode: input.conversationMode,
    });
    return { agent, run };
  }

  async createAgentRaw(body: Record<string, unknown>): Promise<unknown> {
    const prompt = (body.prompt as { text?: string; images?: unknown } | undefined) ?? {};
    return this.createAgent({
      name: String(body.name ?? "mock").slice(0, 100),
      prompt: String(prompt.text ?? "ready"),
      images: Array.isArray(prompt.images)
        ? (prompt.images as PromptImage[])
        : undefined,
      conversationMode:
        body.mode === "plan" ? "plan" : body.mode === "agent" ? "agent" : undefined,
      mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : undefined,
      skipReviewerRequest: body.skipReviewerRequest === true,
      customSubagents: Array.isArray(body.customSubagents)
        ? body.customSubagents
        : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
    });
  }

  async archiveAgent(id: string): Promise<void> {
    await this.delay();
    const agent = this.requireAgent(id);
    agent.archived = true;
    agent.status = "ARCHIVED";
  }

  async unarchiveAgent(id: string): Promise<void> {
    await this.delay();
    const agent = this.requireAgent(id);
    agent.archived = false;
    agent.status = "ACTIVE";
  }

  async deleteAgent(id: string): Promise<unknown> {
    await this.delay();
    this.requireAgent(id);
    this.agents.delete(id);
    return { id };
  }

  async waitForRun(id: string, runId: string): Promise<CursorRun> {
    for (let i = 0; i < 20; i += 1) {
      const run = await this.getRun(id, runId);
      if (
        run.status === "FINISHED" ||
        run.status === "ERROR" ||
        run.status === "CANCELLED"
      ) {
        return run;
      }
      await this.delay();
    }
    throw new TransportError("run_timeout", "mock timeout", 504, true);
  }

  async *streamRun(
    _id: string,
    runId: string,
    options?: { signal?: AbortSignal; lastEventId?: string },
  ): AsyncIterable<CursorStreamEvent> {
    const run = this.runs.get(runId);
    if (!run) throw new TransportError("http_404", `Unknown run ${runId}`, 404);
    if (this.streamUnavailableOnce) {
      this.streamUnavailableOnce = false;
      yield {
        event: "error",
        data: { code: "stream_unavailable", message: "Run stream is no longer available" },
      };
      return;
    }
    yield {
      event: "status",
      data: { runId, status: run.status },
    };
    if (this.holdStream) {
      await waitUntil(
        () =>
          Boolean(options?.signal?.aborted) || this.cancelled.has(runId),
      );
      if (this.cancelled.has(runId)) {
        yield {
          event: "result",
          data: { runId, status: "CANCELLED", text: "" },
        };
        yield { event: "done", data: {} };
        return;
      }
      if (options?.signal?.aborted) return;
    }
    if (this.streamToolCall) {
      yield {
        event: "tool_call",
        data: {
          callId: "call-1",
          name: "read_file",
          status: "completed",
          args: { path: "README.md" },
        },
        id: "1",
      };
    }
    const text = run.result ?? "";
    const skip = Number(options?.lastEventId ?? 0);
    let seq = 1;
    for (let i = 0; i < text.length; i += 16) {
      if (options?.signal?.aborted) return;
      seq += 1;
      if (seq <= skip) continue;
      yield {
        event: "assistant",
        data: { text: text.slice(i, i + 16) },
        id: String(seq),
      };
      if (this.latencyMs > 0) await this.delay();
    }
    run.status = "FINISHED";
    const agent = this.agents.get(run.agentId);
    if (agent) agent.busy = false;
    yield { event: "result", data: { runId, status: "FINISHED", text }, id: String(seq + 1) };
    yield { event: "done", data: {}, id: String(seq + 2) };
  }

  async getUsage(id: string, runId?: string): Promise<unknown> {
    await this.delay();
    this.requireAgent(id);
    const runs = [...this.runs.values()].filter(
      (r) => r.agentId === id && (!runId || r.id === runId),
    );
    const usage = {
      inputTokens: 10 * runs.length,
      outputTokens: 5 * runs.length,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 15 * runs.length,
    };
    return {
      totalUsage: usage,
      runs: runs.map((r) => ({ id: r.id, usage })),
    };
  }

  async listArtifacts(id: string): Promise<unknown> {
    await this.delay();
    return { items: this.requireAgent(id).artifacts };
  }

  async downloadArtifact(id: string, path: string): Promise<unknown> {
    await this.delay();
    this.requireAgent(id);
    return { url: `https://example.invalid/artifacts/${encodeURIComponent(path)}` };
  }

  async listModels(): Promise<unknown> {
    return {
      items: [
        {
          id: "claude-fable-5",
          displayName: "Claude Fable 5",
          variants: [{ params: [], displayName: "Max", isDefault: true }],
        },
      ],
    };
  }

  async me(): Promise<unknown> {
    return { apiKeyName: "mock", createdAt: new Date().toISOString() };
  }

  async listRepositories(): Promise<unknown> {
    return {
      items: [{ url: "https://github.com/NicGodfrey/snow-brothers-3d" }],
    };
  }

  async createSubToken(body: Record<string, unknown>): Promise<unknown> {
    return {
      accessToken: "mock-sub-token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      userId: body.forUserId ?? 1,
    };
  }

  async listWorkers(): Promise<unknown> {
    return { workers: [], totalCount: 0, nextPageToken: "" };
  }

  async workerSummary(): Promise<unknown> {
    return { teamSummary: { totalConnected: 0, inUse: 0 } };
  }

  async getWorker(id: string): Promise<unknown> {
    throw new TransportError("http_404", `Unknown worker ${id}`, 404);
  }

  async listPools(): Promise<unknown> {
    return { pools: [] };
  }

  async listPoolRequests(): Promise<unknown> {
    return { requests: [], totalCount: 0, nextPageToken: "" };
  }

  async claimPoolRequest(body: Record<string, unknown>): Promise<unknown> {
    return {
      bcId: body.bcId ?? null,
      workerId: body.workerId ?? null,
    };
  }

  async deregisterPool(body: Record<string, unknown>): Promise<unknown> {
    return { deregistered: true, poolName: body.poolName ?? null };
  }

  private requireAgent(id: string): MockAgent {
    const agent = this.agents.get(id);
    if (!agent) throw new TransportError("http_404", `Unknown agent ${id}`, 404);
    return agent;
  }

  private async delay(): Promise<void> {
    if (this.latencyMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }
}

function waitUntil(done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done()) {
      resolve();
      return;
    }
    const timer = setInterval(() => {
      if (done()) {
        clearInterval(timer);
        resolve();
      }
    }, 10);
  });
}

function mockAnswer(agentId: string, prompt: string): string {
  const q = prompt.split("QUESTION:").at(-1)?.trim() ?? prompt;
  return `[${agentId}] ${q.slice(0, 280)}`;
}
