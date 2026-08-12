import {
  ConflictError,
  NotFoundError,
  envelope,
  newId,
  type Money,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { moneyFromMinor, requireCurrency, type RoundingMode } from "../domain/currency.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import { MdmEventTypes } from "../domain/events.js";
import {
  FX_RATE_TYPES,
  FxRateTable,
  convertMoney,
  expressInAll,
  validateFxRateInput,
  type FxConversion,
  type FxRate,
  type FxRateInput,
  type FxRateType,
  type FxResolution,
  type TriangulatedAmounts,
} from "../domain/fx.js";
import type { CurrencyService } from "./currency-service.js";
import type { Clock, FxRateFilter, FxRateRepository, OutboxPort } from "./ports.js";

export interface ConvertRequest {
  readonly amountMinor: number;
  readonly from: string;
  readonly to: string;
  readonly asOf?: string;
  readonly rateType?: FxRateType;
  readonly rounding?: RoundingMode;
}

/**
 * FX rate maintenance and conversion.
 *
 * Rates are append-only in normal operation: a new quote for a later date is
 * added, never edited over the top of yesterday's. `correct` exists for the
 * genuine case of a bad feed value and emits its own event carrying the
 * previous number, so anything posted at the old rate can be found and
 * re-translated.
 */
export class FxService {
  constructor(
    private readonly rates: FxRateRepository,
    private readonly currencies: CurrencyService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async quote(ctx: TenantContext, input: FxRateInput): Promise<FxRate> {
    validateFxRateInput(input);
    const base = requireCurrency(input.base).code;
    const quote = requireCurrency(input.quote).code;
    const rateType = input.rateType ?? "spot";

    const existing = await this.rates.list(ctx.tenantId, {
      base: String(base),
      quote: String(quote),
      rateType,
    });
    const clash = existing.find((rate) => rate.validFrom === input.validFrom);
    if (clash) {
      throw new ConflictError(
        `A ${rateType} ${base}/${quote} rate already starts at ${input.validFrom}; correct it instead`,
      );
    }

    const rate: FxRate = {
      id: newId("fx"),
      tenantId: ctx.tenantId,
      base,
      quote,
      rate: input.rate,
      unit: input.unit ?? 1,
      rateType,
      validFrom: input.validFrom as FxRate["validFrom"],
      validTo: input.validTo as FxRate["validTo"] | undefined,
      source: input.source ?? "manual",
      createdAt: this.clock.now(),
    };
    await this.rates.save(rate);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.FxRateQuoted,
        aggregateType: "FxRate",
        aggregateId: rate.id,
        tenantId: ctx.tenantId,
        payload: {
          base: String(rate.base),
          quote: String(rate.quote),
          rate: rate.rate,
          rateType: rate.rateType,
          validFrom: rate.validFrom,
          source: rate.source,
        },
      }),
    ]);
    return rate;
  }

  /** Bulk load from a provider feed; reports per-row failures instead of aborting. */
  async quoteMany(
    ctx: TenantContext,
    inputs: readonly FxRateInput[],
  ): Promise<{ readonly accepted: readonly FxRate[]; readonly rejected: readonly { input: FxRateInput; reason: string }[] }> {
    const accepted: FxRate[] = [];
    const rejected: { input: FxRateInput; reason: string }[] = [];
    for (const input of inputs) {
      try {
        accepted.push(await this.quote(ctx, input));
      } catch (error) {
        rejected.push({ input, reason: (error as Error).message });
      }
    }
    return { accepted, rejected };
  }

  async correct(
    ctx: TenantContext,
    rateId: Ulid,
    newRate: number,
    reason: string,
  ): Promise<FxRate> {
    if (!Number.isFinite(newRate) || newRate <= 0) {
      throw ValidationError.single("rate", "must be a positive finite number");
    }
    if (reason.trim().length === 0) {
      throw ValidationError.single("reason", "a correction needs a reason");
    }
    const existing = await this.rates.byId(ctx.tenantId, rateId);
    if (!existing) throw new NotFoundError("FxRate", rateId);
    if (existing.rate === newRate) {
      throw new InvalidStateError(`Rate ${rateId} is already ${newRate}`);
    }
    const corrected: FxRate = { ...existing, rate: newRate };
    await this.rates.replace(corrected);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.FxRateCorrected,
        aggregateType: "FxRate",
        aggregateId: corrected.id,
        tenantId: ctx.tenantId,
        payload: {
          base: String(corrected.base),
          quote: String(corrected.quote),
          rate: corrected.rate,
          previousRate: existing.rate,
          rateType: corrected.rateType,
          validFrom: corrected.validFrom,
          source: corrected.source,
          correctedBy: ctx.userId,
          reason: reason.trim(),
        },
      }),
    ]);
    return corrected;
  }

  async list(ctx: TenantContext, filter: FxRateFilter = {}): Promise<readonly FxRate[]> {
    if (filter.rateType && !FX_RATE_TYPES.includes(filter.rateType)) {
      throw ValidationError.single("rateType", `unknown rate type "${filter.rateType}"`);
    }
    return this.rates.list(ctx.tenantId, filter);
  }

  async history(
    ctx: TenantContext,
    base: string,
    quote: string,
    rateType: FxRateType = "spot",
  ): Promise<readonly FxRate[]> {
    const table = await this.table(ctx);
    return table.history(String(requireCurrency(base).code), String(requireCurrency(quote).code), rateType);
  }

  async table(ctx: TenantContext): Promise<FxRateTable> {
    return new FxRateTable(await this.rates.all(ctx.tenantId));
  }

  /** Pivots preferred for triangulation: functional currency first, then majors. */
  private async pivots(ctx: TenantContext): Promise<readonly string[]> {
    try {
      const functional = await this.currencies.functionalCurrency(ctx);
      return [functional, "USD", "EUR"].filter(
        (code, index, all) => all.indexOf(code) === index,
      );
    } catch {
      return ["USD", "EUR"];
    }
  }

  async resolve(
    ctx: TenantContext,
    base: string,
    quote: string,
    options: { readonly asOf?: string; readonly rateType?: FxRateType; readonly directOnly?: boolean } = {},
  ): Promise<FxResolution> {
    const table = await this.table(ctx);
    return table.resolve(base, quote, {
      ...options,
      asOf: options.asOf ?? this.clock.now(),
      pivots: await this.pivots(ctx),
    });
  }

  async convert(ctx: TenantContext, request: ConvertRequest): Promise<FxConversion> {
    if (!Number.isInteger(request.amountMinor)) {
      throw ValidationError.single("amountMinor", "must be an integer number of minor units");
    }
    const table = await this.table(ctx);
    return convertMoney(
      table,
      moneyFromMinor(request.amountMinor, request.from),
      request.to,
      {
        asOf: request.asOf ?? this.clock.now(),
        rateType: request.rateType ?? "spot",
        rounding: request.rounding ?? "half-even",
        pivots: await this.pivots(ctx),
      },
    );
  }

  /**
   * Transaction, functional and reporting views of one amount — the triplet a
   * revaluation or consolidation run needs.
   */
  async expressInAll(
    ctx: TenantContext,
    value: Money,
    reportingCurrency: string,
    options: { readonly asOf?: string; readonly rateType?: FxRateType } = {},
  ): Promise<TriangulatedAmounts> {
    const table = await this.table(ctx);
    const functional = await this.currencies.functionalCurrency(ctx);
    return expressInAll(table, value, functional, reportingCurrency, {
      asOf: options.asOf ?? this.clock.now(),
      rateType: options.rateType ?? "spot",
      pivots: await this.pivots(ctx),
    });
  }
}
