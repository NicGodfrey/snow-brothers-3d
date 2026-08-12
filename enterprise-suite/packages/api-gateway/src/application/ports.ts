import type { OpenApiDocument } from "../domain/openapi.js";
import type { RateLimitDecision } from "../domain/policy.js";
import type { UpstreamService } from "../domain/service-catalog.js";

export interface Clock {
  now(): string;
  nowMs(): number;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export type ProbeStatus = "up" | "degraded" | "down" | "unknown";

export interface ProbeResult {
  readonly serviceId: string;
  readonly status: ProbeStatus;
  readonly latencyMs: number;
  readonly checkedAt: string;
  readonly detail?: string;
}

export type ProbeKind = "health" | "ready";

export interface UpstreamProbe {
  probe(service: UpstreamService, kind: ProbeKind, timeoutMs: number): Promise<ProbeResult>;
}

export interface SpecSource {
  /** Resolves the upstream OpenAPI document, or undefined when unavailable. */
  fetchSpec(service: UpstreamService, timeoutMs: number): Promise<OpenApiDocument | undefined>;
}

export interface RateLimitStore {
  /** Records a hit and reports whether it is allowed inside the window. */
  hit(key: string, limit: number, windowMs: number, nowMs: number): RateLimitDecision;
  reset(key?: string): void;
}

export interface RequestMetric {
  readonly method: string;
  readonly path: string;
  readonly routeId?: string;
  readonly status: number;
  readonly durationMs: number;
  readonly tenantId?: string;
  readonly upstream?: string;
}

export interface MetricsSink {
  record(metric: RequestMetric): void;
}
