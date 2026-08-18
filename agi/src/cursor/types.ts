import type { ConversationMode, ModelParam } from "../types.ts";

export type CursorRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export interface PromptImage {
  data?: string;
  mimeType?: string;
  url?: string;
}

export interface CursorAgent {
  id: string;
  name: string;
  status: string;
  url?: string;
  latestRunId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CursorRun {
  id: string;
  agentId: string;
  status: CursorRunStatus;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number;
  result?: string;
}

export interface CreateAgentInput {
  name: string;
  prompt: string;
  repoUrl?: string;
  startingRef?: string;
  conversationMode?: ConversationMode;
  modelId?: string;
  modelParams?: ModelParam[];
  images?: PromptImage[];
  autoCreatePR?: boolean;
  workOnCurrentBranch?: boolean;
  prUrl?: string;
  envVars?: Record<string, string>;
  mcpServers?: unknown[];
  env?: { type: string; name?: string };
  skipReviewerRequest?: boolean;
  customSubagents?: unknown[];
  agentId?: string;
}

export interface CreateRunInput {
  prompt: string;
  images?: PromptImage[];
  mode?: ConversationMode;
  mcpServers?: unknown[];
}

export interface CursorStreamEvent {
  event: string;
  data: unknown;
  id?: string;
}

export interface CursorTransport {
  getAgent(id: string): Promise<CursorAgent>;
  listAgents(query?: Record<string, string | undefined>): Promise<unknown>;
  createRun(
    id: string,
    prompt: string | CreateRunInput,
    mode?: ConversationMode,
  ): Promise<CursorRun>;
  listRuns(id: string, query?: Record<string, string | undefined>): Promise<unknown>;
  getRun(id: string, runId: string): Promise<CursorRun>;
  cancelRun(id: string, runId: string): Promise<unknown>;
  createAgent(
    input: CreateAgentInput,
  ): Promise<{ agent: CursorAgent; run: CursorRun }>;
  createAgentRaw(body: Record<string, unknown>): Promise<unknown>;
  waitForRun(id: string, runId: string): Promise<CursorRun>;
  archiveAgent(id: string): Promise<void>;
  unarchiveAgent(id: string): Promise<void>;
  deleteAgent(id: string): Promise<unknown>;
  streamRun(
    id: string,
    runId: string,
    options?: { signal?: AbortSignal; lastEventId?: string },
  ): AsyncIterable<CursorStreamEvent>;
  getUsage(id: string, runId?: string): Promise<unknown>;
  listArtifacts(id: string): Promise<unknown>;
  downloadArtifact(id: string, path: string): Promise<unknown>;
  listModels(): Promise<unknown>;
  me(): Promise<unknown>;
  listRepositories(): Promise<unknown>;
  createSubToken(body: Record<string, unknown>): Promise<unknown>;
  listWorkers(query?: Record<string, string | undefined>): Promise<unknown>;
  workerSummary(): Promise<unknown>;
  getWorker(id: string): Promise<unknown>;
  listPools(query?: Record<string, string | undefined>): Promise<unknown>;
  listPoolRequests(query?: Record<string, string | undefined>): Promise<unknown>;
  claimPoolRequest(body: Record<string, unknown>): Promise<unknown>;
  deregisterPool(body: Record<string, unknown>): Promise<unknown>;
}

export function isTerminal(status: CursorRunStatus): boolean {
  return (
    status === "FINISHED" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}

export function asRunInput(
  prompt: string | CreateRunInput,
  mode?: ConversationMode,
): CreateRunInput {
  if (typeof prompt === "string") return { prompt, mode };
  return { ...prompt, mode: prompt.mode ?? mode };
}

export function promptBody(text: string, images?: PromptImage[]): Record<string, unknown> {
  const prompt: Record<string, unknown> = { text };
  if (images?.length) prompt.images = images.slice(0, 5);
  return prompt;
}
