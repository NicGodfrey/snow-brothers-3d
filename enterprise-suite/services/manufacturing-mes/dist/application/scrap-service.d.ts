import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { ScrapRecord, type ScrapDisposition, type ScrapReasonCode } from "../domain/scrap-record.js";
import { WorkOrder } from "../domain/work-order.js";
import type { EventPublisher, RoutingRepository, ScrapRecordRepository, WorkOrderRepository } from "./ports.js";
export interface ScrapSummaryRow {
    reasonCode: string;
    disposition: string;
    recordCount: number;
    totalQty: number;
}
export declare class ScrapService {
    private readonly scrapRecords;
    private readonly workOrders;
    private readonly routings;
    private readonly publisher;
    constructor(scrapRecords: ScrapRecordRepository, workOrders: WorkOrderRepository, routings: RoutingRepository, publisher: EventPublisher);
    get(ctx: TenantContext, id: string): Promise<ScrapRecord>;
    listForWorkOrder(ctx: TenantContext, workOrderIdValue: string): Promise<ScrapRecord[]>;
    list(ctx: TenantContext, filter?: {
        reasonCode?: string;
    }): Promise<ScrapRecord[]>;
    /** Pareto-style aggregation used by quality dashboards. */
    summary(ctx: TenantContext): Promise<ScrapSummaryRow[]>;
    /**
     * Record scrap found outside of operation reporting (e.g. discovered in
     * a downstream audit). Does NOT change work order quantities — use
     * operation reporting for in-process scrap.
     */
    recordStandalone(ctx: TenantContext, input: {
        workOrderId: string;
        operationSeq: number;
        quantity: number;
        reasonCode: ScrapReasonCode;
        disposition?: ScrapDisposition;
        notes?: string;
    }): Promise<ScrapRecord>;
    /**
     * Spawn a rework work order from a REWORK-disposition scrap record.
     * The rework order routes the scrapped quantity through the failed
     * operation and everything downstream of it, with no BOM lines (the
     * components were already consumed by the original order).
     */
    createReworkOrder(ctx: TenantContext, scrapRecordIdValue: string, options?: {
        dueDate?: string;
        priority?: number;
    }): Promise<{
        scrapRecord: ScrapRecord;
        reworkOrder: WorkOrder;
    }>;
    private getWorkOrder;
}
//# sourceMappingURL=scrap-service.d.ts.map