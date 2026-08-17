import { TransportError } from "../errors.ts";
import type { AgiConfig } from "../config.ts";
import type { ConversationMode } from "../types.ts";
import {
  isTerminal,
  type CreateAgentInput,
  type CursorAgent,
  type CursorRun,
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

  async createRun(
    id: string,
    prompt: string,
    mode?: ConversationMode,
  ): Promise<CursorRun> {
    const payload: Record<string, unknown> = { prompt: { text: prompt } };
    if (mode) payload.mode = mode;
    const res = await this.request<{ run: CursorRun }>(
      `/v1/agents/${id}/runs`,
      { method: "POST", body: payload },
    );
    return res.run;
  }

  async getRun(id: string, runId: string): Promise<CursorRun> {
    return this.request<CursorRun>(`/v1/agents/${id}/runs/${runId}`);
  }

  async createAgent(
    input: CreateAgentInput,
  ): Promise<{ agent: CursorAgent; run: CursorRun }> {
    const body: Record<string, unknown> = {
      name: input.name.slice(0, 100),
      prompt: { text: input.prompt },
      mode: input.conversationMode ?? "agent",
      repos: [
        {
          url: input.repoUrl,
          startingRef: input.startingRef,
        },
      ],
      autoCreatePR: false,
    };
    if (input.modelId) {
      body.model = {
        id: input.modelId,
        ...(input.modelParams?.length ? { params: input.modelParams } : {}),
      };
    }
    return this.request<{ agent: CursorAgent; run: CursorRun }>("/v1/agents", {
      method: "POST",
      body,
    });
  }

  async archiveAgent(id: string): Promise<void> {
    await this.request(`/v1/agents/${id}/archive`, { method: "POST" });
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

  async listModels(): Promise<unknown> {
    return this.request("/v1/models");
  }

  async me(): Promise<unknown> {
    return this.request("/v1/me");
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
