import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { CostCenter } from "../domain/cost-center.js";
import type { CostCenterId } from "../domain/ids.js";
import type { CostCenterRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
export declare class CostCenterService {
    private readonly costCenters;
    private readonly outbox;
    constructor(costCenters: CostCenterRepository, outbox: EventOutbox);
    createCostCenter(ctx: TenantContext, command: {
        code: string;
        name: string;
        parentCode?: string;
        managerUserId?: string;
    }): Promise<CostCenter>;
    getCostCenter(ctx: TenantContext, id: CostCenterId): Promise<CostCenter>;
    listCostCenters(ctx: TenantContext): Promise<CostCenter[]>;
    deactivateCostCenter(ctx: TenantContext, id: CostCenterId): Promise<CostCenter>;
}
//# sourceMappingURL=cost-center-service.d.ts.map