import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { FxRate, type FxRateSource } from "../domain/fx-rate.js";
import type { FxRateRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
/**
 * FX rates are stored reference data only: journals stay single-currency
 * and nothing in this service performs automatic translation.
 */
export declare class FxService {
    private readonly rates;
    private readonly outbox;
    constructor(rates: FxRateRepository, outbox: EventOutbox);
    storeRate(ctx: TenantContext, command: {
        baseCurrency: string;
        quoteCurrency: string;
        rateMicros: number;
        asOfDate: string;
        source?: FxRateSource;
    }): Promise<FxRate>;
    listRates(ctx: TenantContext, filter?: {
        base?: string;
        quote?: string;
    }): Promise<FxRate[]>;
    /** Latest stored rate for the pair effective on or before the given date. */
    getRate(ctx: TenantContext, base: string, quote: string, date: string): Promise<FxRate>;
}
//# sourceMappingURL=fx-service.d.ts.map