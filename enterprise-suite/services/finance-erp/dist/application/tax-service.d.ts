import { type TenantContext } from "@enterprise-suite/shared-kernel";
import type { TaxCodeId } from "../domain/ids.js";
import { TaxCode, type TaxScope } from "../domain/tax-code.js";
import type { TaxCodeRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
export declare class TaxService {
    private readonly taxCodes;
    private readonly outbox;
    constructor(taxCodes: TaxCodeRepository, outbox: EventOutbox);
    createTaxCode(ctx: TenantContext, command: {
        code: string;
        name: string;
        rateBps: number;
        scope?: TaxScope;
    }): Promise<TaxCode>;
    getTaxCode(ctx: TenantContext, id: TaxCodeId): Promise<TaxCode>;
    listTaxCodes(ctx: TenantContext): Promise<TaxCode[]>;
    deactivateTaxCode(ctx: TenantContext, id: TaxCodeId): Promise<TaxCode>;
}
//# sourceMappingURL=tax-service.d.ts.map