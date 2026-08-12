import { ConflictError, DomainError, NotFoundError, } from "@enterprise-suite/shared-kernel";
/**
 * Resolves control-account codes to ids and persists the per-tenant ledger
 * configuration the AR/AP services depend on.
 */
export class LedgerSettingsService {
    settings;
    accounts;
    constructor(settings, accounts) {
        this.settings = settings;
        this.accounts = accounts;
    }
    async configure(ctx, command) {
        const resolve = async (code, expectedTypes) => {
            const account = await this.accounts.findByCode(ctx.tenantId, code);
            if (!account)
                throw new NotFoundError("Account", code);
            if (!expectedTypes.includes(account.type)) {
                throw new ConflictError(`account ${code} is ${account.type}; expected one of ${expectedTypes.join("/")}`);
            }
            if (!account.acceptsPostings()) {
                throw new ConflictError(`control account ${code} must be active and postable`);
            }
            return account.id;
        };
        const configured = {
            tenantId: ctx.tenantId,
            baseCurrency: command.baseCurrency.toUpperCase(),
            arControlAccountId: await resolve(command.arControlAccountCode, ["ASSET"]),
            apControlAccountId: await resolve(command.apControlAccountCode, ["LIABILITY"]),
            cashAccountId: await resolve(command.cashAccountCode, ["ASSET"]),
            salesTaxPayableAccountId: await resolve(command.salesTaxPayableAccountCode, ["LIABILITY"]),
            purchaseTaxReceivableAccountId: await resolve(command.purchaseTaxReceivableAccountCode, ["ASSET"]),
        };
        await this.settings.save(configured);
        return configured;
    }
    async get(ctx) {
        const settings = await this.settings.find(ctx.tenantId);
        if (!settings) {
            throw new DomainError("ledger settings are not configured for this tenant; POST /settings/ledger first", "LEDGER_NOT_CONFIGURED", 409);
        }
        return settings;
    }
    async isConfigured(ctx) {
        return (await this.settings.find(ctx.tenantId)) !== undefined;
    }
}
//# sourceMappingURL=settings-service.js.map