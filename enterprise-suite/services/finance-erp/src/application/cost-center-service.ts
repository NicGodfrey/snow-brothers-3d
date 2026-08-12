import {
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { CostCenter } from "../domain/cost-center.js";
import type { CostCenterId } from "../domain/ids.js";
import type { CostCenterRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";

export class CostCenterService {
  constructor(
    private readonly costCenters: CostCenterRepository,
    private readonly outbox: EventOutbox,
  ) {}

  async createCostCenter(ctx: TenantContext, command: {
    code: string;
    name: string;
    parentCode?: string;
    managerUserId?: string;
  }): Promise<CostCenter> {
    const code = command.code.trim().toUpperCase();
    const existing = await this.costCenters.findByCode(ctx.tenantId, code);
    if (existing) throw new ConflictError(`cost center ${code} already exists`);
    if (command.parentCode) {
      const parent = await this.costCenters.findByCode(
        ctx.tenantId,
        command.parentCode.trim().toUpperCase(),
      );
      if (!parent) throw new NotFoundError("CostCenter (parent)", command.parentCode);
    }
    const costCenter = expectOk(CostCenter.create(ctx.tenantId, command));
    await this.costCenters.save(costCenter);
    this.outbox.publishAll(costCenter.pullEvents());
    return costCenter;
  }

  async getCostCenter(ctx: TenantContext, id: CostCenterId): Promise<CostCenter> {
    const costCenter = await this.costCenters.findById(ctx.tenantId, id);
    if (!costCenter) throw new NotFoundError("CostCenter", id);
    return costCenter;
  }

  async listCostCenters(ctx: TenantContext): Promise<CostCenter[]> {
    return this.costCenters.list(ctx.tenantId);
  }

  async deactivateCostCenter(ctx: TenantContext, id: CostCenterId): Promise<CostCenter> {
    const costCenter = await this.getCostCenter(ctx, id);
    expectOk(costCenter.deactivate());
    await this.costCenters.save(costCenter);
    return costCenter;
  }
}
