import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { TaxCode } from "../domain/tax-code.js";
import { expectOk } from "./service-support.js";
export class TaxService {
    taxCodes;
    outbox;
    constructor(taxCodes, outbox) {
        this.taxCodes = taxCodes;
        this.outbox = outbox;
    }
    async createTaxCode(ctx, command) {
        const code = command.code.trim().toUpperCase();
        const existing = await this.taxCodes.findByCode(ctx.tenantId, code);
        if (existing)
            throw new ConflictError(`tax code ${code} already exists`);
        const taxCode = expectOk(TaxCode.create(ctx.tenantId, command));
        await this.taxCodes.save(taxCode);
        this.outbox.publishAll(taxCode.pullEvents());
        return taxCode;
    }
    async getTaxCode(ctx, id) {
        const taxCode = await this.taxCodes.findById(ctx.tenantId, id);
        if (!taxCode)
            throw new NotFoundError("TaxCode", id);
        return taxCode;
    }
    async listTaxCodes(ctx) {
        return this.taxCodes.list(ctx.tenantId);
    }
    async deactivateTaxCode(ctx, id) {
        const taxCode = await this.getTaxCode(ctx, id);
        expectOk(taxCode.deactivate());
        await this.taxCodes.save(taxCode);
        return taxCode;
    }
}
//# sourceMappingURL=tax-service.js.map