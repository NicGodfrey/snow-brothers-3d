import {
  ConflictError,
  DomainError,
  NotFoundError,
  type CurrencyCode,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import type { LedgerSettings } from "../domain/ledger-settings.js";
import type {
  AccountRepository,
  LedgerSettingsRepository,
} from "../infrastructure/repositories.js";

export interface ConfigureLedgerCommand {
  baseCurrency: string;
  arControlAccountCode: string;
  apControlAccountCode: string;
  cashAccountCode: string;
  salesTaxPayableAccountCode: string;
  purchaseTaxReceivableAccountCode: string;
}

/**
 * Resolves control-account codes to ids and persists the per-tenant ledger
 * configuration the AR/AP services depend on.
 */
export class LedgerSettingsService {
  constructor(
    private readonly settings: LedgerSettingsRepository,
    private readonly accounts: AccountRepository,
  ) {}

  async configure(ctx: TenantContext, command: ConfigureLedgerCommand): Promise<LedgerSettings> {
    const resolve = async (code: string, expectedTypes: string[]) => {
      const account = await this.accounts.findByCode(ctx.tenantId, code);
      if (!account) throw new NotFoundError("Account", code);
      if (!expectedTypes.includes(account.type)) {
        throw new ConflictError(
          `account ${code} is ${account.type}; expected one of ${expectedTypes.join("/")}`,
        );
      }
      if (!account.acceptsPostings()) {
        throw new ConflictError(`control account ${code} must be active and postable`);
      }
      return account.id;
    };

    const configured: LedgerSettings = {
      tenantId: ctx.tenantId,
      baseCurrency: command.baseCurrency.toUpperCase() as CurrencyCode,
      arControlAccountId: await resolve(command.arControlAccountCode, ["ASSET"]),
      apControlAccountId: await resolve(command.apControlAccountCode, ["LIABILITY"]),
      cashAccountId: await resolve(command.cashAccountCode, ["ASSET"]),
      salesTaxPayableAccountId: await resolve(command.salesTaxPayableAccountCode, ["LIABILITY"]),
      purchaseTaxReceivableAccountId: await resolve(
        command.purchaseTaxReceivableAccountCode,
        ["ASSET"],
      ),
    };
    await this.settings.save(configured);
    return configured;
  }

  async get(ctx: TenantContext): Promise<LedgerSettings> {
    const settings = await this.settings.find(ctx.tenantId);
    if (!settings) {
      throw new DomainError(
        "ledger settings are not configured for this tenant; POST /settings/ledger first",
        "LEDGER_NOT_CONFIGURED",
        409,
      );
    }
    return settings;
  }

  async isConfigured(ctx: TenantContext): Promise<boolean> {
    return (await this.settings.find(ctx.tenantId)) !== undefined;
  }
}
