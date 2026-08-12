/**
 * Tenant-scoped document numbering: <SERIES>-<YEAR>-<SEQ 6 digits>.
 * Counters are per (tenant, series, year) so sequences restart yearly,
 * matching the SQL `number_series` table in the migrations.
 */
import type { TenantId } from "@enterprise-suite/shared-kernel";
import type { Clock, NumberSeries } from "../../application/ports.js";
export declare class InMemoryNumberSeries implements NumberSeries {
    private readonly clock;
    private readonly counters;
    constructor(clock: Clock);
    next(tenantId: TenantId, seriesCode: string): Promise<string>;
}
//# sourceMappingURL=number-series.d.ts.map