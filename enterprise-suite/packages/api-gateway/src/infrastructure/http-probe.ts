import type {
  Clock,
  ProbeKind,
  ProbeResult,
  ProbeStatus,
  UpstreamProbe,
} from "../application/ports.js";
import type { UpstreamService } from "../domain/service-catalog.js";

/**
 * Probes an upstream over HTTP. `degraded` is reported for a slow-but-alive
 * upstream so readiness can distinguish "struggling" from "gone" instead of
 * flapping the whole gateway out of rotation.
 */
export class HttpUpstreamProbe implements UpstreamProbe {
  constructor(
    private readonly clock: Clock,
    private readonly degradedAboveMs = 750,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async probe(service: UpstreamService, kind: ProbeKind, timeoutMs: number): Promise<ProbeResult> {
    const path = kind === "ready" ? service.readyPath : service.healthPath;
    const url = `${service.baseUrl.replace(/\/$/, "")}${path}`;
    const startedMs = this.clock.nowMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      const latencyMs = this.clock.nowMs() - startedMs;
      let status: ProbeStatus = response.ok ? "up" : "down";
      if (status === "up" && latencyMs > this.degradedAboveMs) status = "degraded";
      return {
        serviceId: service.id,
        status,
        latencyMs,
        checkedAt: this.clock.now(),
        detail: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        serviceId: service.id,
        status: "down",
        latencyMs: this.clock.nowMs() - startedMs,
        checkedAt: this.clock.now(),
        detail: aborted ? `timed out after ${timeoutMs}ms` : describeError(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Scripted probe for tests and local demos. */
export class StaticUpstreamProbe implements UpstreamProbe {
  constructor(
    private readonly statuses: Readonly<Record<string, ProbeStatus>>,
    private readonly clock: Clock,
    private readonly latencyMs = 3,
  ) {}

  async probe(service: UpstreamService): Promise<ProbeResult> {
    const status = this.statuses[service.id] ?? "up";
    return {
      serviceId: service.id,
      status,
      latencyMs: this.latencyMs,
      checkedAt: this.clock.now(),
      detail: status === "up" ? undefined : `scripted status ${status}`,
    };
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}
