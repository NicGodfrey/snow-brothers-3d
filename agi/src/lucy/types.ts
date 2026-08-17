export type LucyKind = "copy" | "official";
export type LucyPoolName = "copies" | "official" | "auto";
export type LucyFulfillName = "mock" | "queue" | "official" | "auto";
export type LucyJobStatus = "running" | "succeeded" | "failed" | "aborted";

export interface LucySlot {
  name: string;
  agentId: string;
  kind: LucyKind;
  status: "idle" | "busy" | "error";
}

export interface PromptImageIn {
  data?: string;
  mimeType?: string;
  url?: string;
}

export interface LucyAskRequest {
  question: string;
  conversationId?: string;
  target?: string;
  pool?: LucyPoolName;
  stream?: boolean;
  conversationMode?: "agent" | "plan";
  images?: PromptImageIn[];
  failover?: boolean;
  mcpServers?: unknown[];
}

export interface LucyTurn {
  role: "user" | "assistant";
  text: string;
  jobId: string;
  lucyName: string;
  at: string;
}

export interface LucySseEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
}

export interface LucyJob {
  id: string;
  conversationId: string;
  lucyName: string;
  agentId: string;
  kind: LucyKind;
  fulfill: Exclude<LucyFulfillName, "auto">;
  question: string;
  status: LucyJobStatus;
  createdAt: string;
  updatedAt: string;
  answer: string;
  error?: string;
  errorCode?: string;
  events: LucySseEvent[];
  startedAtMs: number;
  lastModelAtMs: number;
  runId?: string;
  imageCount?: number;
  failover?: boolean;
}

export interface LucyPoolSnapshot {
  copies: { total: number; idle: number; busy: number };
  official: { total: number; idle: number; busy: number };
}

export interface LucyHealth extends LucyPoolSnapshot {
  pool: LucyPoolName;
  fulfill: LucyFulfillName;
  streamIdleTimeoutMs: number;
  streamHeartbeatMs: number;
  maxBodyBytes: number;
}
