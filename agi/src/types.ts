export type AgentSlotStatus =
  | "idle"
  | "busy"
  | "error"
  | "unprovisioned"
  | "retired";

export type SlotRole = "coordinator" | "worker";
export type QaMode =
  | "ask"
  | "fanout"
  | "debate"
  | "vote"
  | "broadcast"
  | "specialist";
export type Intent = "code" | "game" | "policy" | "meta" | "general";
export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "partial";
export type AssignmentStatus = "pending" | "running" | "succeeded" | "failed";
export type TransportName = "official" | "mock";
export type ConversationMode = "agent" | "plan";
export type SessionMode = "fresh" | "continue";
export type SlotSource = "official" | "legacy" | "unprovisioned";

export interface ModelParam {
  id: string;
  value: string;
}

export const FABLE5_MAX_MODEL_ID = "claude-fable-5";
export const FABLE5_MAX_PARAMS: ModelParam[] = [
  { id: "thinking", value: "true" },
  { id: "context", value: "1m" },
  { id: "effort", value: "max" },
];

export interface FleetSlot {
  name: string;
  role: SlotRole;
  agentId: string | null;
  status: AgentSlotStatus;
  url: string | null;
  source: SlotSource;
  notes?: string;
}

export interface Assignment {
  slotName: string;
  agentId: string;
  runId?: string;
  status: AssignmentStatus;
  answer?: string;
  error?: string;
  durationMs?: number;
}

export interface Job {
  id: string;
  mode: QaMode;
  intent: Intent;
  question: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  assignments: Assignment[];
  synthesis?: string;
  error?: string;
}

export interface AskRequest {
  question: string;
  mode?: QaMode;
  intent?: Intent;
  target?: string;
  n?: number;
  conversationMode?: ConversationMode;
  sessionMode?: SessionMode;
}

export interface FleetSnapshot {
  size: number;
  dispatchable: number;
  unprovisioned: number;
  error: number;
  busy: number;
  maxInFlight: number;
  inFlight: number;
  transport: TransportName;
  slots: FleetSlot[];
}

export interface Metrics {
  jobsTotal: number;
  jobsSucceeded: number;
  jobsFailed: number;
  jobsPartial: number;
  inFlight: number;
  maxInFlight: number;
  peakInFlight: number;
  dispatchable: number;
}

export const FLEET_SIZE = 101;
export const DEFAULT_MAX_IN_FLIGHT = 100;
export const COORDINATOR_NAME = "lucy";
