/**
 * Tenant-scoped, year-partitioned document numbering: EXP-2026-000001.
 * Counters restart each year, matching the SQL `number_series` table.
 */
import type { TenantId } from "@enterprise-suite/shared-kernel";
import type { Clock, NumberSeries } from "../../application/ports.js";

export class InMemoryNumberSeries implements NumberSeries {
  private readonly counters = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  async next(tenantId: TenantId, seriesCode: string): Promise<string> {
    const year = new Date(this.clock.now()).getUTCFullYear();
    const key = `${tenantId}:${seriesCode}:${year}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return `${seriesCode}-${year}-${String(next).padStart(6, "0")}`;
  }
}
