import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { CostCenter } from "../domain/cost-center.js";
import { expectOk } from "./service-support.js";
export class CostCenterService {
    costCenters;
    outbox;
    constructor(costCenters, outbox) {
        this.costCenters = costCenters;
        this.outbox = outbox;
    }
    async createCostCenter(ctx, command) {
        const code = command.code.trim().toUpperCase();
        const existing = await this.costCenters.findByCode(ctx.tenantId, code);
        if (existing)
            throw new ConflictError(`cost center ${code} already exists`);
        if (command.parentCode) {
            const parent = await this.costCenters.findByCode(ctx.tenantId, command.parentCode.trim().toUpperCase());
            if (!parent)
                throw new NotFoundError("CostCenter (parent)", command.parentCode);
        }
        const costCenter = expectOk(CostCenter.create(ctx.tenantId, command));
        await this.costCenters.save(costCenter);
        this.outbox.publishAll(costCenter.pullEvents());
        return costCenter;
    }
    async getCostCenter(ctx, id) {
        const costCenter = await this.costCenters.findById(ctx.tenantId, id);
        if (!costCenter)
            throw new NotFoundError("CostCenter", id);
        return costCenter;
    }
    async listCostCenters(ctx) {
        return this.costCenters.list(ctx.tenantId);
    }
    async deactivateCostCenter(ctx, id) {
        const costCenter = await this.getCostCenter(ctx, id);
        expectOk(costCenter.deactivate());
        await this.costCenters.save(costCenter);
        return costCenter;
    }
}
//# sourceMappingURL=cost-center-service.js.map