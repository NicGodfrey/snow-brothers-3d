import type { LogLevel, Logger, MetricsSink, RequestMetric } from "../application/ports.js";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Line-delimited JSON to stdout/stderr; nothing to configure in a container. */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel = "info",
    private readonly service = "api-gateway",
  ) {}

  log(level: LogLevel, message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...fields,
    });
    // eslint-disable-next-line no-console
    if (level === "error") console.error(line);
    else console.log(line);
  }
}

export interface CapturedLog {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Collects log lines so tests can assert on observability behaviour. */
export class MemoryLogger implements Logger {
  readonly entries: CapturedLog[] = [];

  log(level: LogLevel, message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.entries.push({ level, message, fields });
  }

  withLevel(level: LogLevel): CapturedLog[] {
    return this.entries.filter((entry) => entry.level === level);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/** Rolling in-process counters; a real deployment swaps in Prometheus. */
export class InMemoryMetrics implements MetricsSink {
  readonly samples: RequestMetric[] = [];

  constructor(private readonly capacity = 1_000) {}

  record(metric: RequestMetric): void {
    this.samples.push(metric);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  snapshot(): {
    total: number;
    byStatusClass: Record<string, number>;
    byRoute: Record<string, { count: number; p95Ms: number; errorRate: number }>;
  } {
    const byStatusClass: Record<string, number> = {};
    const grouped = new Map<string, RequestMetric[]>();
    for (const sample of this.samples) {
      const cls = `${Math.floor(sample.status / 100)}xx`;
      byStatusClass[cls] = (byStatusClass[cls] ?? 0) + 1;
      const key = sample.routeId ?? `${sample.method} ${sample.path}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(sample);
      grouped.set(key, bucket);
    }
    const byRoute: Record<string, { count: number; p95Ms: number; errorRate: number }> = {};
    for (const [key, bucket] of grouped) {
      const durations = bucket.map((s) => s.durationMs).sort((a, b) => a - b);
      const index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
      byRoute[key] = {
        count: bucket.length,
        p95Ms: durations[index] ?? 0,
        errorRate: bucket.filter((s) => s.status >= 500).length / bucket.length,
      };
    }
    return { total: this.samples.length, byStatusClass, byRoute };
  }
}
