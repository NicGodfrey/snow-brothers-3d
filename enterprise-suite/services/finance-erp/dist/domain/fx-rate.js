import { AggregateRoot, envelope, err, ok, } from "@enterprise-suite/shared-kernel";
import { isIsoDate, newFxRateId } from "./ids.js";
import { FinanceEventTypes } from "./events.js";
/** Rates are stored to 6 decimal places as integers: 1_084_500 = 1.0845. */
export const FX_RATE_SCALE = 1_000_000;
/**
 * FX rates are reference data in this service: stored and queryable, but journals
 * remain single-currency and no automatic translation is performed.
 */
export class FxRate extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static store(tenantId, input) {
        if (input.baseCurrency === input.quoteCurrency) {
            return err("baseCurrency and quoteCurrency must differ");
        }
        if (!Number.isInteger(input.rateMicros) || input.rateMicros <= 0) {
            return err("rateMicros must be a positive integer (1_000_000 = 1.0)");
        }
        if (!isIsoDate(input.asOfDate))
            return err("asOfDate must be an ISO date");
        const rate = new FxRate(tenantId, {
            baseCurrency: input.baseCurrency,
            quoteCurrency: input.quoteCurrency,
            rateMicros: input.rateMicros,
            asOfDate: input.asOfDate,
            source: input.source ?? "MANUAL",
        }, newFxRateId());
        rate.raise(envelope({
            eventType: FinanceEventTypes.FxRateStored,
            aggregateType: "FxRate",
            aggregateId: rate.id,
            tenantId,
            payload: {
                fxRateId: rate.id,
                base: input.baseCurrency,
                quote: input.quoteCurrency,
                rateMicros: input.rateMicros,
                asOfDate: input.asOfDate,
            },
        }));
        return ok(rate);
    }
    get baseCurrency() { return this.props.baseCurrency; }
    get quoteCurrency() { return this.props.quoteCurrency; }
    get rateMicros() { return this.props.rateMicros; }
    get asOfDate() { return this.props.asOfDate; }
    get source() { return this.props.source; }
}
//# sourceMappingURL=fx-rate.js.map