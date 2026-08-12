import { AggregateRoot, type CurrencyCode, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "./ids.js";
/** Rates are stored to 6 decimal places as integers: 1_084_500 = 1.0845. */
export declare const FX_RATE_SCALE = 1000000;
export type FxRateSource = "MANUAL" | "ECB" | "FED" | "PROVIDER";
export interface FxRateProps {
    baseCurrency: CurrencyCode;
    quoteCurrency: CurrencyCode;
    /** How many quote units one base unit buys, scaled by FX_RATE_SCALE. */
    rateMicros: number;
    asOfDate: IsoDate;
    source: FxRateSource;
}
/**
 * FX rates are reference data in this service: stored and queryable, but journals
 * remain single-currency and no automatic translation is performed.
 */
export declare class FxRate extends AggregateRoot<FxRateProps> {
    private constructor();
    static store(tenantId: TenantId, input: {
        baseCurrency: CurrencyCode;
        quoteCurrency: CurrencyCode;
        rateMicros: number;
        asOfDate: string;
        source?: FxRateSource;
    }): Result<FxRate>;
    get baseCurrency(): CurrencyCode;
    get quoteCurrency(): CurrencyCode;
    get rateMicros(): number;
    get asOfDate(): IsoDate;
    get source(): FxRateSource;
}
//# sourceMappingURL=fx-rate.d.ts.map