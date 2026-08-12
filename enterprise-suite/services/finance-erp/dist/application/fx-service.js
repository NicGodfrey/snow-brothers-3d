import { NotFoundError, } from "@enterprise-suite/shared-kernel";
import { FxRate } from "../domain/fx-rate.js";
import { expectOk } from "./service-support.js";
/**
 * FX rates are stored reference data only: journals stay single-currency
 * and nothing in this service performs automatic translation.
 */
export class FxService {
    rates;
    outbox;
    constructor(rates, outbox) {
        this.rates = rates;
        this.outbox = outbox;
    }
    async storeRate(ctx, command) {
        const rate = expectOk(FxRate.store(ctx.tenantId, {
            baseCurrency: command.baseCurrency.toUpperCase(),
            quoteCurrency: command.quoteCurrency.toUpperCase(),
            rateMicros: command.rateMicros,
            asOfDate: command.asOfDate,
            source: command.source,
        }));
        await this.rates.save(rate);
        this.outbox.publishAll(rate.pullEvents());
        return rate;
    }
    async listRates(ctx, filter) {
        return this.rates.list(ctx.tenantId, {
            base: filter?.base?.toUpperCase(),
            quote: filter?.quote?.toUpperCase(),
        });
    }
    /** Latest stored rate for the pair effective on or before the given date. */
    async getRate(ctx, base, quote, date) {
        const rate = await this.rates.findRate(ctx.tenantId, base.toUpperCase(), quote.toUpperCase(), date);
        if (!rate) {
            throw new NotFoundError("FxRate", `${base.toUpperCase()}/${quote.toUpperCase()} @ ${date}`);
        }
        return rate;
    }
}
//# sourceMappingURL=fx-service.js.map