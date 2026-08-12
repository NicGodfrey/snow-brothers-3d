import type { CallRecord } from "../api/client.js";

/**
 * Bounded ring buffer of outbound service calls. Feeds `/api/diagnostics`,
 * which is how you tell "the portal is slow" from "sales-erp is slow".
 */
export class CallLog {
  private readonly records: CallRecord[] = [];

  constructor(private readonly capacity = 200) {}

  record(record: CallRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
  }

  recent(limit = 50): readonly CallRecord[] {
    return this.records.slice(-limit).reverse();
  }

  summary(): ReadonlyArray<{
    service: string;
    calls: number;
    errors: number;
    p50Ms: number;
    maxMs: number;
  }> {
    const byService = new Map<string, CallRecord[]>();
    for (const record of this.records) {
      const bucket = byService.get(record.service);
      if (bucket) bucket.push(record);
      else byService.set(record.service, [record]);
    }
    return [...byService.entries()].map(([service, records]) => {
      const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
      return {
        service,
        calls: records.length,
        errors: records.filter((r) => r.error !== undefined).length,
        p50Ms: durations[Math.floor(durations.length / 2)] ?? 0,
        maxMs: durations[durations.length - 1] ?? 0,
      };
    });
  }

  clear(): void {
    this.records.length = 0;
  }
}
