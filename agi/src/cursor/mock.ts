import { randomUUID } from "node:crypto";
import { TransportError } from "../errors.ts";
import type { ConversationMode } from "../types.ts";
import type {
  CreateAgentInput,
  CursorAgent,
  CursorRun,
  CursorTransport,
} from "./types.ts";

interface MockAgent extends CursorAgent {
  busy: boolean;
  archived: boolean;
  history: string[];
}

export class MockCursorClient implements CursorTransport {
  readonly agents = new Map<string, MockAgent>();
  readonly runs = new Map<string, CursorRun>();
  latencyMs = 5;
  failNext = false;
  lastCreate?: CreateAgentInput;

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
      });
    }
  }

  async getAgent(id: string): Promise<CursorAgent> {
    await this.delay();
    const agent = this.agents.get(id);
    if (!agent) {
      throw new TransportError("http_404", `Unknown agent ${id}`, 404);
    }
    return agent;
  }

  async createRun(
    id: string,
    prompt: string,
    _mode?: ConversationMode,
  ): Promise<CursorRun> {
    await this.delay();
    const agent = this.agents.get(id);
    if (!agent) {
      throw new TransportError("http_404", `Unknown agent ${id}`, 404);
    }
    if (agent.archived) {
      throw new TransportError("http_409", `Agent ${id} is archived`, 409);
    }
    if (agent.busy) {
      throw new TransportError("agent_busy", `Agent ${id} is busy`, 409, true);
    }
    if (this.failNext) {
      this.failNext = false;
      throw new TransportError("http_500", "injected failure", 500, true);
    }
    agent.busy = true;
    agent.history.push(prompt);
    const run: CursorRun = {
      id: `run-${randomUUID()}`,
      agentId: id,
      status: "RUNNING",
      result: mockAnswer(id, prompt),
    };
    this.runs.set(run.id, run);
    queueMicrotask(() => {
      run.status = "FINISHED";
      agent.busy = false;
    });
    return run;
  }

  async getRun(_id: string, runId: string): Promise<CursorRun> {
    await this.delay();
    const run = this.runs.get(runId);
    if (!run) throw new TransportError("http_404", `Unknown run ${runId}`, 404);
    return run;
  }

  async createAgent(
    input: CreateAgentInput,
  ): Promise<{ agent: CursorAgent; run: CursorRun }> {
    this.lastCreate = input;
    await this.delay();
    const id = `bc-mock-${randomUUID()}`;
    const agent: MockAgent = {
      id,
      name: input.name,
      status: "ACTIVE",
      url: `https://cursor.com/agents/${id}`,
      busy: false,
      archived: false,
      history: [],
    };
    this.agents.set(id, agent);
    const run = await this.createRun(id, input.prompt);
    return { agent, run };
  }

  async archiveAgent(id: string): Promise<void> {
    await this.delay();
    const agent = this.agents.get(id);
    if (!agent) throw new TransportError("http_404", `Unknown agent ${id}`, 404);
    agent.archived = true;
    agent.status = "ARCHIVED";
  }

  async waitForRun(id: string, runId: string): Promise<CursorRun> {
    for (let i = 0; i < 20; i += 1) {
      const run = await this.getRun(id, runId);
      if (run.status === "FINISHED" || run.status === "ERROR") return run;
      await this.delay();
    }
    throw new TransportError("run_timeout", "mock timeout", 504, true);
  }

  private async delay(): Promise<void> {
    if (this.latencyMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }
}

function mockAnswer(agentId: string, prompt: string): string {
  const q = prompt.split("QUESTION:").at(-1)?.trim() ?? prompt;
  return `[${agentId}] ${q.slice(0, 280)}`;
}
