import {
  NotFoundError,
  type CurrencyCode,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { FxRate, type FxRateSource } from "../domain/fx-rate.js";
import type { FxRateRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";

/**
 * FX rates are stored reference data only: journals stay single-currency
 * and nothing in this service performs automatic translation.
 */
export class FxService {
  constructor(
    private readonly rates: FxRateRepository,
    private readonly outbox: EventOutbox,
  ) {}

  async storeRate(ctx: TenantContext, command: {
    baseCurrency: string;
    quoteCurrency: string;
    rateMicros: number;
    asOfDate: string;
    source?: FxRateSource;
  }): Promise<FxRate> {
    const rate = expectOk(FxRate.store(ctx.tenantId, {
      baseCurrency: command.baseCurrency.toUpperCase() as CurrencyCode,
      quoteCurrency: command.quoteCurrency.toUpperCase() as CurrencyCode,
      rateMicros: command.rateMicros,
      asOfDate: command.asOfDate,
      source: command.source,
    }));
    await this.rates.save(rate);
    this.outbox.publishAll(rate.pullEvents());
    return rate;
  }

  async listRates(ctx: TenantContext, filter?: { base?: string; quote?: string }): Promise<FxRate[]> {
    return this.rates.list(ctx.tenantId, {
      base: filter?.base?.toUpperCase(),
      quote: filter?.quote?.toUpperCase(),
    });
  }

  /** Latest stored rate for the pair effective on or before the given date. */
  async getRate(ctx: TenantContext, base: string, quote: string, date: string): Promise<FxRate> {
    const rate = await this.rates.findRate(
      ctx.tenantId,
      base.toUpperCase(),
      quote.toUpperCase(),
      date,
    );
    if (!rate) {
      throw new NotFoundError("FxRate", `${base.toUpperCase()}/${quote.toUpperCase()} @ ${date}`);
    }
    return rate;
  }
}
