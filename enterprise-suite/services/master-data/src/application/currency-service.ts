import {
  ConflictError,
  NotFoundError,
  envelope,
  newId,
  type Money,
  type TenantContext,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import {
  ISO_CURRENCIES,
  ROUNDING_MODES,
  allocate,
  formatMoney,
  fromMinorUnits,
  makeMoney,
  moneyFromMinor,
  requireCurrency,
  roundToCash,
  split,
  toMinorUnits,
  type CurrencyDefinition,
  type RoundingMode,
  type TenantCurrency,
} from "../domain/currency.js";
import { CurrencyError, InvalidStateError, ValidationError } from "../domain/errors.js";
import { MdmEventTypes } from "../domain/events.js";
import type { Clock, CurrencyRepository, OutboxPort } from "./ports.js";

export interface EnableCurrencyInput {
  readonly code: string;
  readonly roundingMode?: RoundingMode;
  readonly displaySymbol?: string;
  readonly functional?: boolean;
}

export interface CurrencyView extends CurrencyDefinition {
  readonly enabled: boolean;
  readonly isFunctional: boolean;
  readonly roundingMode: RoundingMode;
  readonly displaySymbol?: string;
}

/**
 * Tenant currency configuration.
 *
 * ISO 4217 is reference data; what a tenant configures is which of those
 * currencies it transacts in, how each one rounds, and which single currency
 * is functional (the one the books are kept in). The functional currency is
 * the default pivot for FX triangulation and cannot be disabled while it holds
 * that role.
 */
export class CurrencyService {
  constructor(
    private readonly currencies: CurrencyRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  listIsoCurrencies(): readonly CurrencyDefinition[] {
    return ISO_CURRENCIES;
  }

  async list(ctx: TenantContext): Promise<readonly CurrencyView[]> {
    const settings = new Map(
      (await this.currencies.settings(ctx.tenantId)).map((setting) => [String(setting.code), setting]),
    );
    return ISO_CURRENCIES.map((definition) => {
      const setting = settings.get(String(definition.code));
      return {
        ...definition,
        enabled: setting?.enabled ?? false,
        isFunctional: setting?.isFunctional ?? false,
        roundingMode: setting?.roundingMode ?? "half-up",
        displaySymbol: setting?.displaySymbol,
      };
    });
  }

  async listEnabled(ctx: TenantContext): Promise<readonly CurrencyView[]> {
    return (await this.list(ctx)).filter((currency) => currency.enabled);
  }

  async enable(ctx: TenantContext, input: EnableCurrencyInput): Promise<TenantCurrency> {
    const definition = requireCurrency(input.code);
    const roundingMode = input.roundingMode ?? "half-up";
    if (!ROUNDING_MODES.includes(roundingMode)) {
      throw ValidationError.single("roundingMode", `unknown rounding mode "${roundingMode}"`);
    }
    const existing = await this.currencies.byCode(ctx.tenantId, String(definition.code));
    if (existing?.enabled && !input.functional) {
      throw new ConflictError(`Currency ${definition.code} is already enabled`);
    }
    if (input.functional) {
      await this.clearFunctional(ctx.tenantId);
    }
    const setting: TenantCurrency = {
      code: definition.code,
      enabled: true,
      isFunctional: input.functional ?? existing?.isFunctional ?? false,
      roundingMode,
      displaySymbol: input.displaySymbol ?? existing?.displaySymbol,
    };
    await this.currencies.save(ctx.tenantId, setting);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.CurrencyEnabled,
        aggregateType: "Currency",
        aggregateId: newId("cur"),
        tenantId: ctx.tenantId,
        payload: {
          code: String(setting.code),
          isFunctional: setting.isFunctional,
          roundingMode: setting.roundingMode,
          at: this.clock.now(),
        },
      }),
    ]);
    return setting;
  }

  async disable(ctx: TenantContext, code: string): Promise<TenantCurrency> {
    const definition = requireCurrency(code);
    const setting = await this.currencies.byCode(ctx.tenantId, String(definition.code));
    if (!setting?.enabled) throw new NotFoundError("Currency", String(definition.code));
    if (setting.isFunctional) {
      throw new InvalidStateError(
        `${definition.code} is the functional currency; designate another one before disabling it`,
      );
    }
    const disabled: TenantCurrency = { ...setting, enabled: false };
    await this.currencies.save(ctx.tenantId, disabled);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.CurrencyDisabled,
        aggregateType: "Currency",
        aggregateId: newId("cur"),
        tenantId: ctx.tenantId,
        payload: { code: String(definition.code), at: this.clock.now() },
      }),
    ]);
    return disabled;
  }

  /** Designates the functional currency, enabling it if necessary. */
  async setFunctional(ctx: TenantContext, code: string): Promise<TenantCurrency> {
    return this.enable(ctx, { code, functional: true });
  }

  async functionalCurrency(ctx: TenantContext): Promise<string> {
    const settings = await this.currencies.settings(ctx.tenantId);
    const functional = settings.find((setting) => setting.isFunctional && setting.enabled);
    if (!functional) {
      throw new InvalidStateError(
        "No functional currency is configured for this tenant; set one before posting amounts",
      );
    }
    return String(functional.code);
  }

  /** Throws unless the currency is enabled for the tenant. */
  async assertEnabled(ctx: TenantContext, code: string): Promise<CurrencyDefinition> {
    const definition = requireCurrency(code);
    const setting = await this.currencies.byCode(ctx.tenantId, String(definition.code));
    if (!setting?.enabled) {
      throw new CurrencyError(`Currency ${definition.code} is not enabled for this tenant`);
    }
    return definition;
  }

  async roundingFor(ctx: TenantContext, code: string): Promise<RoundingMode> {
    const setting = await this.currencies.byCode(ctx.tenantId, String(requireCurrency(code).code));
    return setting?.roundingMode ?? "half-up";
  }

  /** Decimal amount to Money using the tenant's configured rounding. */
  async amount(ctx: TenantContext, value: number, code: string): Promise<Money> {
    return makeMoney(value, code, await this.roundingFor(ctx, code));
  }

  toMinor(value: number, code: string, mode: RoundingMode = "half-up"): number {
    return toMinorUnits(value, code, mode);
  }

  toDecimal(amountMinor: number, code: string): number {
    return fromMinorUnits(amountMinor, code);
  }

  fromMinor(amountMinor: number, code: string): Money {
    return moneyFromMinor(amountMinor, code);
  }

  format(value: Money, options: { readonly withSymbol?: boolean } = {}): string {
    return formatMoney(value, options);
  }

  cashRound(value: Money, mode?: RoundingMode): Money {
    return roundToCash(value, mode);
  }

  allocate(value: Money, weights: readonly number[]): readonly Money[] {
    return allocate(value, weights);
  }

  split(value: Money, parts: number): readonly Money[] {
    return split(value, parts);
  }

  private async clearFunctional(tenantId: TenantId): Promise<void> {
    for (const setting of await this.currencies.settings(tenantId)) {
      if (setting.isFunctional) {
        await this.currencies.save(tenantId, { ...setting, isFunctional: false });
      }
    }
  }
}
