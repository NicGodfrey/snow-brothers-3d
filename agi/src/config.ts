import { defaultLucyCopiesPath } from "./lucy/copies.ts";
import type { LucyFulfillName, LucyPoolName } from "./lucy/types.ts";
import {
  DEFAULT_MAX_IN_FLIGHT,
  FABLE5_MAX_MODEL_ID,
  FABLE5_MAX_PARAMS,
  type ModelParam,
  type SessionMode,
  type TransportName,
} from "./types.ts";

export const DEFAULT_MAX_BODY_BYTES = 20 * 1024 * 1024;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000;

export interface AgiConfig {
  apiKey: string | undefined;
  apiBase: string;
  repoUrl: string;
  startingRef: string;
  maxInFlight: number;
  port: number;
  bind: string;
  controlToken: string | undefined;
  transport: TransportName;
  pollMs: number;
  pollTimeoutMs: number;
  fleetPath: string | undefined;
  sessionMode: SessionMode;
  modelId: string;
  modelParams: ModelParam[];
  maxBodyBytes: number;
  streamIdleTimeoutMs: number;
  streamHeartbeatMs: number;
  lucyPool: LucyPoolName;
  lucyFulfill: LucyFulfillName;
  lucyCopiesPath: string;
  lucyMockDelayMs: number;
}

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function loadConfig(overrides: Partial<AgiConfig> = {}): AgiConfig {
  const apiKey = process.env.CURSOR_API_KEY?.trim() || undefined;
  const requested = (process.env.AGI_TRANSPORT?.trim() ||
    (apiKey ? "official" : "mock")) as TransportName;
  const transport: TransportName =
    requested === "official" && !apiKey ? "mock" : requested;

  return {
    apiKey,
    apiBase: (
      process.env.CURSOR_API_BASE?.trim() || "https://api.cursor.com"
    ).replace(/\/$/, ""),
    repoUrl:
      process.env.AGI_REPO_URL?.trim() ||
      "https://github.com/NicGodfrey/snow-brothers-3d",
    startingRef:
      process.env.AGI_STARTING_REF?.trim() || "cursor/cat-mouse-game-25c6",
    maxInFlight: Math.min(
      envInt("AGI_MAX_IN_FLIGHT", DEFAULT_MAX_IN_FLIGHT),
      100,
    ),
    port: envInt("AGI_PORT", 8787),
    bind: process.env.AGI_BIND?.trim() || "127.0.0.1",
    controlToken: process.env.AGI_CONTROL_TOKEN?.trim() || undefined,
    transport,
    pollMs: envInt("AGI_POLL_MS", 2000),
    pollTimeoutMs: envInt("AGI_POLL_TIMEOUT_MS", 15 * 60 * 1000),
    fleetPath: process.env.AGI_FLEET_PATH?.trim() || undefined,
    sessionMode:
      process.env.AGI_SESSION_MODE?.trim() === "continue" ? "continue" : "fresh",
    modelId: process.env.AGI_MODEL_ID?.trim() || FABLE5_MAX_MODEL_ID,
    modelParams: parseModelParams(
      process.env.AGI_MODEL_PARAMS,
      FABLE5_MAX_PARAMS,
    ),
    maxBodyBytes: envInt("AGI_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES),
    streamIdleTimeoutMs: envInt(
      "AGI_STREAM_IDLE_TIMEOUT_MS",
      envInt("CLAUDE_STREAM_IDLE_TIMEOUT_MS", DEFAULT_STREAM_IDLE_TIMEOUT_MS),
    ),
    streamHeartbeatMs: envInt("AGI_STREAM_HEARTBEAT_MS", 15_000, 0),
    lucyPool: parseLucyPool(process.env.AGI_LUCY_POOL ?? "auto"),
    lucyFulfill: parseLucyFulfill(process.env.AGI_LUCY_FULFILL),
    lucyCopiesPath:
      process.env.AGI_LUCY_COPIES_PATH?.trim() || defaultLucyCopiesPath(),
    lucyMockDelayMs: envInt("AGI_LUCY_MOCK_DELAY_MS", 5, 0),
    ...overrides,
  };
}

export function parseLucyPool(raw: string | undefined): LucyPoolName {
  if (raw === "copies" || raw === "official" || raw === "auto") return raw;
  return "auto";
}

export function parseLucyFulfill(raw: string | undefined): LucyFulfillName {
  if (raw === "mock" || raw === "queue" || raw === "official" || raw === "auto") {
    return raw;
  }
  return "auto";
}

export function parseModelParams(
  raw: string | undefined,
  fallback: ModelParam[],
): ModelParam[] {
  if (!raw?.trim()) return fallback.map((p) => ({ ...p }));
  return raw.split(",").map((part) => {
    const [id, ...rest] = part.split("=");
    return { id: (id ?? "").trim(), value: rest.join("=").trim() };
  }).filter((p) => p.id && p.value);
}
