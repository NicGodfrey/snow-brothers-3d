import type { ConversationMode } from "../types.ts";

export type CursorRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export interface CursorAgent {
  id: string;
  name: string;
  status: string;
  url?: string;
  latestRunId?: string;
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
  repoUrl: string;
  startingRef: string;
  conversationMode?: ConversationMode;
}

export interface CursorTransport {
  getAgent(id: string): Promise<CursorAgent>;
  createRun(
    id: string,
    prompt: string,
    mode?: ConversationMode,
  ): Promise<CursorRun>;
  getRun(id: string, runId: string): Promise<CursorRun>;
  createAgent(
    input: CreateAgentInput,
  ): Promise<{ agent: CursorAgent; run: CursorRun }>;
  waitForRun(id: string, runId: string): Promise<CursorRun>;
}

export function isTerminal(status: CursorRunStatus): boolean {
  return (
    status === "FINISHED" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}
