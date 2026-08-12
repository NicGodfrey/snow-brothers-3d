/**
 * Tenant-scoped document numbering: <SERIES>-<YEAR>-<SEQ 6 digits>.
 * Counters are per (tenant, series, year) so sequences restart yearly,
 * matching the SQL `number_series` table in the migrations.
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
