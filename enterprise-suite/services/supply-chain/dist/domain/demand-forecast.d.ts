import { AggregateRoot, type IsoDateTime, type TenantId } from "@enterprise-suite/shared-kernel";
import { type IsoDate, type LocationCode } from "./types.js";
export type ForecastSource = "STATISTICAL" | "SALES_INPUT" | "OVERRIDE";
export type ForecastStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export interface ForecastEntry {
    /** Monday of the forecast week. */
    readonly weekStart: IsoDate;
    readonly qty: number;
}
interface DemandForecastProps {
    sku: string;
    location: LocationCode;
    source: ForecastSource;
    status: ForecastStatus;
    entries: readonly ForecastEntry[];
    notes: string | null;
    publishedAt: IsoDateTime | null;
}
/**
 * Weekly demand forecast for one SKU at one location. Only DRAFT forecasts
 * are editable; publishing freezes the series and makes it visible to MRP.
 * The application layer guarantees at most one PUBLISHED forecast per
 * (sku, location) by archiving the previous one on publish.
 */
export declare class DemandForecast extends AggregateRoot<DemandForecastProps> {
    static create(tenantId: TenantId, input: {
        sku: string;
        location: LocationCode;
        source?: ForecastSource;
        entries?: readonly {
            weekStart: string;
            qty: number;
        }[];
        notes?: string;
    }): DemandForecast;
    get sku(): string;
    get location(): LocationCode;
    get status(): ForecastStatus;
    get entries(): readonly ForecastEntry[];
    get totalQty(): number;
    /** Merge-upsert entries by week; a qty of 0 removes the week. */
    upsertEntries(raw: readonly {
        weekStart: string;
        qty: number;
    }[]): void;
    publish(): void;
    archive(): void;
    private assertDraft;
}
/**
 * Same-bucket forecast consumption: actual (committed) demand consumes the
 * forecast of its own week, so the requirement passed to MRP per week is
 * `max(forecast, actuals)` split as actuals + residual forecast. This
 * prevents double counting demand that has already materialized as orders.
 */
export declare function residualForecast(forecastByBucket: readonly number[], actualsByBucket: readonly number[]): number[];
export {};
//# sourceMappingURL=demand-forecast.d.ts.map