import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { MaterialIssue, type MaterialIssueLineInput } from "../domain/material-issue.js";
import { ProductionReceipt } from "../domain/production-receipt.js";
import type { WorkOrder } from "../domain/work-order.js";
import type { EventPublisher, MaterialIssueRepository, ProductionReceiptRepository, WorkOrderRepository } from "./ports.js";
export interface IssueMaterialsCommand {
    warehouseCode: string;
    lines: MaterialIssueLineInput[];
    note?: string;
}
export interface PostReceiptCommand {
    qtyGood: number;
    warehouseCode: string;
    lotNumber?: string;
    note?: string;
}
/**
 * Coordinates the two sides of every material movement: the immutable
 * posted document and the running totals on the work order. Both are saved
 * before events are published, mirroring a single DB transaction + outbox.
 */
export declare class MaterialService {
    private readonly workOrders;
    private readonly issues;
    private readonly receipts;
    private readonly publisher;
    constructor(workOrders: WorkOrderRepository, issues: MaterialIssueRepository, receipts: ProductionReceiptRepository, publisher: EventPublisher);
    issueMaterials(ctx: TenantContext, workOrderIdValue: string, cmd: IssueMaterialsCommand): Promise<{
        document: MaterialIssue;
        workOrder: WorkOrder;
    }>;
    returnMaterials(ctx: TenantContext, workOrderIdValue: string, cmd: IssueMaterialsCommand): Promise<{
        document: MaterialIssue;
        workOrder: WorkOrder;
    }>;
    postReceipt(ctx: TenantContext, workOrderIdValue: string, cmd: PostReceiptCommand): Promise<{
        document: ProductionReceipt;
        workOrder: WorkOrder;
    }>;
    listIssuesForWorkOrder(ctx: TenantContext, workOrderIdValue: string): Promise<MaterialIssue[]>;
    listReceiptsForWorkOrder(ctx: TenantContext, workOrderIdValue: string): Promise<ProductionReceipt[]>;
    private getWorkOrder;
    private lineUom;
}
//# sourceMappingURL=material-service.d.ts.map