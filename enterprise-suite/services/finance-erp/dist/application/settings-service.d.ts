import { type TenantContext } from "@enterprise-suite/shared-kernel";
import type { LedgerSettings } from "../domain/ledger-settings.js";
import type { AccountRepository, LedgerSettingsRepository } from "../infrastructure/repositories.js";
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
export declare class LedgerSettingsService {
    private readonly settings;
    private readonly accounts;
    constructor(settings: LedgerSettingsRepository, accounts: AccountRepository);
    configure(ctx: TenantContext, command: ConfigureLedgerCommand): Promise<LedgerSettings>;
    get(ctx: TenantContext): Promise<LedgerSettings>;
    isConfigured(ctx: TenantContext): Promise<boolean>;
}
//# sourceMappingURL=settings-service.d.ts.map