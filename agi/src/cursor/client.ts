import { TransportError } from "../errors.ts";
import type { AgiConfig } from "../config.ts";
import type { ConversationMode } from "../types.ts";
import { parseSseStream } from "../sse.ts";
import {
  asRunInput,
  isTerminal,
  promptBody,
  type CreateAgentInput,
  type CursorAgent,
  type CursorRun,
  type CursorStreamEvent,
  type CursorTransport,
} from "./types.ts";

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export class OfficialCursorClient implements CursorTransport {
  constructor(private readonly config: AgiConfig) {
    if (!config.apiKey) {
      throw new TransportError(
        "missing_api_key",
        "CURSOR_API_KEY is required for official transport",
        401,
      );
    }
  }

  async getAgent(id: string): Promise<CursorAgent> {
    return this.request<CursorAgent>(`/v1/agents/${id}`);
  }

  async listAgents(query?: Record<string, string | undefined>): Promise<unknown> {
    return this.request("/v1/agents", { query });
  }

  async createRun(
    id: string,
    prompt: string | import("./types.ts").CreateRunInput,
    mode?: ConversationMode,
  ): Promise<CursorRun> {
    const input = asRunInput(prompt, mode);
    const payload: Record<string, unknown> = {
      prompt: promptBody(input.prompt, input.images),
    };
    if (input.mode) payload.mode = input.mode;
    if (input.mcpServers) payload.mcpServers = input.mcpServers;
    const res = await this.request<{ run: CursorRun }>(
      `/v1/agents/${id}/runs`,
      { method: "POST", body: payload },
    );
    return res.run;
  }

  async listRuns(
    id: string,
    query?: Record<string, string | undefined>,
  ): Promise<unknown> {
    return this.request(`/v1/agents/${id}/runs`, { query });
  }

  async getRun(id: string, runId: string): Promise<CursorRun> {
    return this.request<CursorRun>(`/v1/agents/${id}/runs/${runId}`);
  }

  async cancelRun(id: string, runId: string): Promise<unknown> {
    return this.request(`/v1/agents/${id}/runs/${runId}/cancel`, { method: "POST" });
  }

  async createAgent(
    input: CreateAgentInput,
  ): Promise<{ agent: CursorAgent; run: CursorRun }> {
    const body: Record<string, unknown> = {
      name: input.name.slice(0, 100),
      prompt: promptBody(input.prompt, input.images),
      mode: input.conversationMode ?? "agent",
      autoCreatePR: input.autoCreatePR ?? false,
    };
    if (input.env) body.env = input.env;
    else if (input.repoUrl) {
      body.repos = [
        {
          url: input.repoUrl,
          startingRef: input.startingRef,
          ...(input.prUrl ? { prUrl: input.prUrl } : {}),
        },
      ];
    }
    if (input.workOnCurrentBranch !== undefined) {
      body.workOnCurrentBranch = input.workOnCurrentBranch;
    }
    if (input.modelId) {
      body.model = {
        id: input.modelId,
        ...(input.modelParams?.length ? { params: input.modelParams } : {}),
      };
    }
    if (input.envVars) body.envVars = input.envVars;
    if (input.mcpServers) body.mcpServers = input.mcpServers;
    if (input.skipReviewerRequest !== undefined) {
      body.skipReviewerRequest = input.skipReviewerRequest;
    }
    if (input.customSubagents) body.customSubagents = input.customSubagents;
    if (input.agentId) body.agentId = input.agentId;
    return this.request<{ agent: CursorAgent; run: CursorRun }>("/v1/agents", {
      method: "POST",
      body,
    });
  }

  async createAgentRaw(body: Record<string, unknown>): Promise<unknown> {
    return this.request("/v1/agents", { method: "POST", body });
  }

  async archiveAgent(id: string): Promise<void> {
    await this.request(`/v1/agents/${id}/archive`, { method: "POST" });
  }

  async unarchiveAgent(id: string): Promise<void> {
    await this.request(`/v1/agents/${id}/unarchive`, { method: "POST" });
  }

  async deleteAgent(id: string): Promise<unknown> {
    return this.request(`/v1/agents/${id}`, { method: "DELETE" });
  }

  async waitForRun(id: string, runId: string): Promise<CursorRun> {
    const started = Date.now();
    let delay = this.config.pollMs;
    while (Date.now() - started < this.config.pollTimeoutMs) {
      const run = await this.getRun(id, runId);
      if (isTerminal(run.status)) return run;
      await sleep(delay);
      delay = Math.min(delay * 1.25, 8000);
    }
    throw new TransportError(
      "run_timeout",
      `Run ${runId} on ${id} exceeded ${this.config.pollTimeoutMs}ms`,
      504,
      true,
    );
  }

  async *streamRun(
    id: string,
    runId: string,
    options?: { signal?: AbortSignal; lastEventId?: string },
  ): AsyncIterable<CursorStreamEvent> {
    const url = `${this.config.apiBase}/v1/agents/${id}/runs/${runId}/stream`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "text/event-stream",
    };
    if (options?.lastEventId) headers["Last-Event-ID"] = options.lastEventId;
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: options?.signal,
    });
    if (res.status === 410) {
      const run = await this.getRun(id, runId);
      yield {
        event: "result",
        data: { runId, status: run.status, text: run.result ?? "" },
      };
      yield { event: "done", data: {} };
      return;
    }
    if (res.status === 409) {
      const body = await safeJson(res);
      const code = String(
        (body as { error?: { code?: string } })?.error?.code ?? "conflict",
      );
      const message = String(
        (body as { error?: { message?: string } })?.error?.message ??
          `Cursor API 409 on /v1/agents/${id}/runs/${runId}/stream`,
      );
      yield { event: "error", data: { code, message } };
      return;
    }
    if (!res.ok || !res.body) {
      const body = await safeText(res);
      throw new TransportError(
        `http_${res.status}`,
        `Cursor API ${res.status} on /v1/agents/${id}/runs/${runId}/stream: ${body.slice(0, 400)}`,
        res.status,
        res.status >= 500,
      );
    }
    for await (const frame of parseSseStream(iterableBody(res.body))) {
      let data: unknown = frame.data;
      try {
        data = JSON.parse(frame.data);
      } catch {
        data = frame.data;
      }
      yield { event: frame.event, data, id: frame.id };
    }
  }

  async getUsage(id: string, runId?: string): Promise<unknown> {
    return this.request(`/v1/agents/${id}/usage`, {
      query: runId ? { runId } : undefined,
    });
  }

  async listArtifacts(id: string): Promise<unknown> {
    return this.request(`/v1/agents/${id}/artifacts`);
  }

  async downloadArtifact(id: string, path: string): Promise<unknown> {
    return this.request(`/v1/agents/${id}/artifacts/download`, {
      query: { path },
    });
  }

  async listModels(): Promise<unknown> {
    return this.request("/v1/models");
  }

  async me(): Promise<unknown> {
    return this.request("/v1/me");
  }

  async listRepositories(): Promise<unknown> {
    return this.request("/v1/repositories");
  }

  async createSubToken(body: Record<string, unknown>): Promise<unknown> {
    return this.request("/v1/sub-tokens", { method: "POST", body });
  }

  async listWorkers(query?: Record<string, string | undefined>): Promise<unknown> {
    return this.request("/v0/private-workers", { query });
  }

  async workerSummary(): Promise<unknown> {
    return this.request("/v0/private-workers/summary");
  }

  async getWorker(id: string): Promise<unknown> {
    return this.request(`/v0/private-workers/${id}`);
  }

  async listPools(query?: Record<string, string | undefined>): Promise<unknown> {
    return this.request("/v0/private-workers/pools", { query });
  }

  async listPoolRequests(
    query?: Record<string, string | undefined>,
  ): Promise<unknown> {
    return this.request("/v0/private-workers/pending-requests", { query });
  }

  async claimPoolRequest(body: Record<string, unknown>): Promise<unknown> {
    return this.request("/v0/private-workers/claim", {
      method: "POST",
      body,
    });
  }

  async deregisterPool(body: Record<string, unknown>): Promise<unknown> {
    return this.request("/v0/private-workers/pools", {
      method: "DELETE",
      body,
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.config.apiBase + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value) url.searchParams.set(key, value);
    }

    let lastError: TransportError | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "application/json",
      };
      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? 1) * 1000;
        lastError = new TransportError(
          "rate_limited",
          `Cursor API rate limited on ${path}`,
          429,
          true,
        );
        await sleep(Math.max(wait, 400 * 2 ** attempt));
        continue;
      }

      if (res.status === 409) {
        const body = await safeJson(res);
        const code = String(
          (body as { error?: { code?: string } })?.error?.code ?? "conflict",
        );
        throw new TransportError(
          code,
          `Cursor API conflict on ${path}: ${code}`,
          409,
          code === "agent_busy",
        );
      }

      if (!res.ok) {
        const body = await safeText(res);
        throw new TransportError(
          `http_${res.status}`,
          `Cursor API ${res.status} on ${path}: ${body.slice(0, 400)}`,
          res.status,
          res.status >= 500,
        );
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    throw lastError ?? new TransportError("retry_exhausted", `Failed ${path}`, 502, true);
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* iterableBody(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
