import type { ServiceCatalog, UpstreamService } from "../domain/service-catalog.js";
import type { Clock, Logger, ProbeKind, ProbeResult, UpstreamProbe } from "./ports.js";

/**
 * Liveness and readiness.
 *
 * Liveness answers "is this process healthy" and must never depend on the
 * network. Readiness fans out to the upstreams: critical services take the
 * gateway out of rotation when they are down, non-critical ones only degrade
 * it. Probe results are cached for a short TTL so a burst of readiness checks
 * (a rolling deploy, say) cannot stampede the fleet.
 */

export type ReadinessStatus = "ready" | "degraded" | "unready";

export interface LivenessReport {
  readonly status: "ok";
  readonly service: string;
  readonly version: string;
  readonly uptimeMs: number;
  readonly checkedAt: string;
}

export interface ReadinessReport {
  readonly status: ReadinessStatus;
  readonly httpStatus: 200 | 503;
  readonly service: string;
  readonly version: string;
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly upstreams: readonly ProbeResult[];
  readonly summary: {
    readonly total: number;
    readonly up: number;
    readonly degraded: number;
    readonly down: number;
    readonly unknown: number;
    readonly criticalDown: readonly string[];
  };
}

export interface HealthOptions {
  readonly serviceName?: string;
  readonly version?: string;
  readonly probeTimeoutMs?: number;
  readonly cacheTtlMs?: number;
}

interface CacheEntry {
  readonly result: ProbeResult;
  readonly expiresAtMs: number;
}

export class HealthService {
  private readonly startedAtMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly serviceName: string;
  private readonly version: string;
  private readonly probeTimeoutMs: number;
  private readonly cacheTtlMs: number;

  constructor(
    private readonly catalog: ServiceCatalog,
    private readonly probe: UpstreamProbe,
    private readonly clock: Clock,
    private readonly logger?: Logger,
    options: HealthOptions = {},
  ) {
    this.startedAtMs = clock.nowMs();
    this.serviceName = options.serviceName ?? "api-gateway";
    this.version = options.version ?? "0.1.0";
    this.probeTimeoutMs = options.probeTimeoutMs ?? 2_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
  }

  live(): LivenessReport {
    return {
      status: "ok",
      service: this.serviceName,
      version: this.version,
      uptimeMs: this.clock.nowMs() - this.startedAtMs,
      checkedAt: this.clock.now(),
    };
  }

  async ready(
    options: { readonly kind?: ProbeKind; readonly force?: boolean; readonly only?: readonly string[] } = {},
  ): Promise<ReadinessReport> {
    const startedMs = this.clock.nowMs();
    const kind = options.kind ?? "ready";
    const services = this.catalog
      .list()
      .filter((s) => (options.only ? options.only.includes(s.id) : true));

    const upstreams = await Promise.all(
      services.map((service) => this.probeService(service, kind, options.force ?? false)),
    );

    const summary = {
      total: upstreams.length,
      up: upstreams.filter((u) => u.status === "up").length,
      degraded: upstreams.filter((u) => u.status === "degraded").length,
      down: upstreams.filter((u) => u.status === "down").length,
      unknown: upstreams.filter((u) => u.status === "unknown").length,
      criticalDown: upstreams
        .filter((u) => u.status === "down" && this.catalog.get(u.serviceId)?.critical)
        .map((u) => u.serviceId),
    };

    const status: ReadinessStatus =
      summary.criticalDown.length > 0
        ? "unready"
        : summary.down > 0 || summary.degraded > 0
          ? "degraded"
          : "ready";

    if (status !== "ready") {
      this.logger?.log("warn", `gateway readiness ${status}`, {
        criticalDown: summary.criticalDown,
        down: summary.down,
        degraded: summary.degraded,
      });
    }

    return {
      status,
      httpStatus: status === "unready" ? 503 : 200,
      service: this.serviceName,
      version: this.version,
      checkedAt: this.clock.now(),
      durationMs: this.clock.nowMs() - startedMs,
      upstreams: upstreams.sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
      summary,
    };
  }

  invalidate(serviceId?: string): void {
    if (serviceId) {
      this.cache.delete(`health:${serviceId}`);
      this.cache.delete(`ready:${serviceId}`);
      return;
    }
    this.cache.clear();
  }

  private async probeService(
    service: UpstreamService,
    kind: ProbeKind,
    force: boolean,
  ): Promise<ProbeResult> {
    if (service.planned) {
      return {
        serviceId: service.id,
        status: "unknown",
        latencyMs: 0,
        checkedAt: this.clock.now(),
        detail: "declared in the catalog but not deployed",
      };
    }

    const cacheKey = `${kind}:${service.id}`;
    const cached = this.cache.get(cacheKey);
    const nowMs = this.clock.nowMs();
    if (!force && cached && cached.expiresAtMs > nowMs) return cached.result;

    let result: ProbeResult;
    try {
      result = await this.probe.probe(service, kind, this.probeTimeoutMs);
    } catch (error) {
      result = {
        serviceId: service.id,
        status: "down",
        latencyMs: this.clock.nowMs() - nowMs,
        checkedAt: this.clock.now(),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    this.cache.set(cacheKey, { result, expiresAtMs: this.clock.nowMs() + this.cacheTtlMs });
    return result;
  }
}
