import {
  AggregateRoot,
  envelope,
  err,
  ok,
  type CurrencyCode,
  type Result,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { isIsoDate, newFxRateId, type FxRateId, type IsoDate } from "./ids.js";
import { FinanceEventTypes } from "./events.js";

/** Rates are stored to 6 decimal places as integers: 1_084_500 = 1.0845. */
export const FX_RATE_SCALE = 1_000_000;

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
export class FxRate extends AggregateRoot<FxRateProps> {
  private constructor(tenantId: TenantId, props: FxRateProps, id?: FxRateId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static store(tenantId: TenantId, input: {
    baseCurrency: CurrencyCode;
    quoteCurrency: CurrencyCode;
    rateMicros: number;
    asOfDate: string;
    source?: FxRateSource;
  }): Result<FxRate> {
    if (input.baseCurrency === input.quoteCurrency) {
      return err("baseCurrency and quoteCurrency must differ");
    }
    if (!Number.isInteger(input.rateMicros) || input.rateMicros <= 0) {
      return err("rateMicros must be a positive integer (1_000_000 = 1.0)");
    }
    if (!isIsoDate(input.asOfDate)) return err("asOfDate must be an ISO date");
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

  get baseCurrency(): CurrencyCode { return this.props.baseCurrency; }
  get quoteCurrency(): CurrencyCode { return this.props.quoteCurrency; }
  get rateMicros(): number { return this.props.rateMicros; }
  get asOfDate(): IsoDate { return this.props.asOfDate; }
  get source(): FxRateSource { return this.props.source; }
}
