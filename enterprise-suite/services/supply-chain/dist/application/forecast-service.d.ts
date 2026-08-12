import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { DemandForecast, type ForecastSource } from "../domain/demand-forecast.js";
import type { LocationCode } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";
export declare class ForecastService {
    private readonly deps;
    constructor(deps: SupplyChainDeps);
    createForecast(ctx: TenantContext, input: {
        sku: string;
        location: LocationCode;
        source?: ForecastSource;
        entries?: readonly {
            weekStart: string;
            qty: number;
        }[];
        notes?: string;
    }): Promise<DemandForecast>;
    getForecast(ctx: TenantContext, id: Ulid): Promise<DemandForecast>;
    listForecasts(ctx: TenantContext, filter?: {
        sku?: string;
        location?: LocationCode;
        status?: string;
    }): Promise<DemandForecast[]>;
    upsertEntries(ctx: TenantContext, id: Ulid, entries: readonly {
        weekStart: string;
        qty: number;
    }[]): Promise<DemandForecast>;
    /**
     * Publishing supersedes the currently published forecast for the same
     * (sku, location): the old one is archived in the same operation so MRP
     * only ever sees one active series per item/location.
     */
    publishForecast(ctx: TenantContext, id: Ulid): Promise<DemandForecast>;
    archiveForecast(ctx: TenantContext, id: Ulid): Promise<DemandForecast>;
}
//# sourceMappingURL=forecast-service.d.ts.map