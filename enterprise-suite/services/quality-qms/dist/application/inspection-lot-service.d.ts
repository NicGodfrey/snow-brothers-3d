/**
 * Inspection lot use-cases.
 *
 * Orchestration on usage decision (the cross-aggregate policy lives here,
 * not in the aggregates):
 *  - reject / partial with a rejected quantity  -> auto-create an NCR
 *    referencing the lot (unless the caller opts out)
 *  - rejected goods-receipt lots with a supplier -> record a supplier
 *    quality event ("incoming-inspection-failure") for SRM scorecards
 */
import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { InspectionLot, type LotStatus, type UsageDecisionType } from "../domain/inspection-lot.js";
import type { LotOrigin } from "../domain/inspection-plan.js";
import type { NonConformanceReport } from "../domain/ncr.js";
import type { InspectionLotRepository, InspectionPlanRepository } from "../domain/repositories.js";
import type { SupplierQualityEvent } from "../domain/supplier-quality.js";
import type { NcrService } from "./ncr-service.js";
import { type Clock, type NumberSeries, type Outbox } from "./ports.js";
import type { SupplierQualityService } from "./supplier-quality-service.js";
export interface CreateLotCommand {
    planId: Ulid;
    origin: LotOrigin;
    quantity: number;
    uom: string;
    /** Defaults to the plan's materialCode; required for process plans. */
    materialCode?: string;
    supplierId?: string;
    purchaseOrderRef?: string;
    workOrderRef?: string;
    customerRef?: string;
    batchNumber?: string;
}
export interface DecideUsageCommand {
    decision: UsageDecisionType;
    note?: string;
    acceptedQuantity?: number;
    /** Default true: rejected material automatically opens an NCR. */
    autoCreateNcr?: boolean;
}
export interface UsageDecisionOutcome {
    lot: InspectionLot;
    ncr?: NonConformanceReport;
    supplierEvent?: SupplierQualityEvent;
}
export declare class InspectionLotService {
    private readonly lots;
    private readonly plans;
    private readonly outbox;
    private readonly numbers;
    private readonly clock;
    private readonly ncrService;
    private readonly supplierQuality;
    constructor(lots: InspectionLotRepository, plans: InspectionPlanRepository, outbox: Outbox, numbers: NumberSeries, clock: Clock, ncrService: NcrService, supplierQuality: SupplierQualityService);
    private flush;
    createLot(ctx: TenantContext, cmd: CreateLotCommand): Promise<InspectionLot>;
    startInspection(ctx: TenantContext, lotId: Ulid): Promise<InspectionLot>;
    recordQuantitativeResult(ctx: TenantContext, lotId: Ulid, characteristicCode: string, readings: number[], note?: string): Promise<InspectionLot>;
    recordAttributeResult(ctx: TenantContext, lotId: Ulid, characteristicCode: string, counts: {
        inspected: number;
        defective: number;
    }, note?: string): Promise<InspectionLot>;
    completeInspection(ctx: TenantContext, lotId: Ulid): Promise<InspectionLot>;
    decideUsage(ctx: TenantContext, lotId: Ulid, cmd: DecideUsageCommand): Promise<UsageDecisionOutcome>;
    cancelLot(ctx: TenantContext, lotId: Ulid, reason: string): Promise<InspectionLot>;
    getLot(ctx: TenantContext, lotId: Ulid): Promise<InspectionLot>;
    listLots(ctx: TenantContext, filter?: {
        status?: LotStatus;
        origin?: LotOrigin;
        supplierId?: string;
        materialCode?: string;
    }): Promise<InspectionLot[]>;
}
//# sourceMappingURL=inspection-lot-service.d.ts.map