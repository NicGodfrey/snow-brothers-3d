import type { TenantId } from "@enterprise-suite/shared-kernel";
import type { CapacityCalendar } from "../../domain/capacity-calendar.js";
import type { CapacityCalendarId, MaterialIssueId, ProductionReceiptId, RoutingId, ScrapRecordId, ShiftTemplateId, WorkCenterId, WorkOrderId } from "../../domain/ids.js";
import type { MaterialIssue } from "../../domain/material-issue.js";
import type { ProductionReceipt } from "../../domain/production-receipt.js";
import type { Routing, RoutingStatus } from "../../domain/routing.js";
import type { ScrapRecord } from "../../domain/scrap-record.js";
import type { ShiftTemplate } from "../../domain/shift-template.js";
import type { WorkCenter } from "../../domain/work-center.js";
import type { WorkOrder, WorkOrderStatus } from "../../domain/work-order.js";
import type { CapacityCalendarRepository, MaterialIssueRepository, ProductionReceiptRepository, RoutingRepository, ScrapRecordRepository, ShiftTemplateRepository, WorkCenterRepository, WorkOrderRepository } from "../../application/ports.js";
export declare class InMemoryWorkCenterRepository implements WorkCenterRepository {
    private readonly store;
    save(workCenter: WorkCenter): Promise<void>;
    findById(tenantId: TenantId, id: WorkCenterId): Promise<WorkCenter | null>;
    findByCode(tenantId: TenantId, code: string): Promise<WorkCenter | null>;
    list(tenantId: TenantId): Promise<WorkCenter[]>;
}
export declare class InMemoryShiftTemplateRepository implements ShiftTemplateRepository {
    private readonly store;
    save(template: ShiftTemplate): Promise<void>;
    findById(tenantId: TenantId, id: ShiftTemplateId): Promise<ShiftTemplate | null>;
    findByCode(tenantId: TenantId, code: string): Promise<ShiftTemplate | null>;
    list(tenantId: TenantId): Promise<ShiftTemplate[]>;
}
export declare class InMemoryCapacityCalendarRepository implements CapacityCalendarRepository {
    private readonly store;
    save(calendar: CapacityCalendar): Promise<void>;
    findById(tenantId: TenantId, id: CapacityCalendarId): Promise<CapacityCalendar | null>;
    findByCode(tenantId: TenantId, code: string): Promise<CapacityCalendar | null>;
    list(tenantId: TenantId): Promise<CapacityCalendar[]>;
}
export declare class InMemoryRoutingRepository implements RoutingRepository {
    private readonly store;
    save(routing: Routing): Promise<void>;
    findById(tenantId: TenantId, id: RoutingId): Promise<Routing | null>;
    findBySkuRevision(tenantId: TenantId, sku: string, revision: string): Promise<Routing | null>;
    findReleasedForSku(tenantId: TenantId, sku: string): Promise<Routing | null>;
    list(tenantId: TenantId, filter?: {
        sku?: string;
        status?: RoutingStatus;
    }): Promise<Routing[]>;
}
export declare class InMemoryWorkOrderRepository implements WorkOrderRepository {
    private readonly store;
    private readonly sequences;
    save(workOrder: WorkOrder): Promise<void>;
    findById(tenantId: TenantId, id: WorkOrderId): Promise<WorkOrder | null>;
    findByOrderNumber(tenantId: TenantId, orderNumber: string): Promise<WorkOrder | null>;
    list(tenantId: TenantId, filter?: {
        status?: WorkOrderStatus;
        sku?: string;
        dueBefore?: string;
    }): Promise<WorkOrder[]>;
    nextOrderNumber(tenantId: TenantId): Promise<string>;
}
export declare class InMemoryMaterialIssueRepository implements MaterialIssueRepository {
    private readonly store;
    save(doc: MaterialIssue): Promise<void>;
    findById(tenantId: TenantId, id: MaterialIssueId): Promise<MaterialIssue | null>;
    listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<MaterialIssue[]>;
}
export declare class InMemoryProductionReceiptRepository implements ProductionReceiptRepository {
    private readonly store;
    save(doc: ProductionReceipt): Promise<void>;
    findById(tenantId: TenantId, id: ProductionReceiptId): Promise<ProductionReceipt | null>;
    listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<ProductionReceipt[]>;
}
export declare class InMemoryScrapRecordRepository implements ScrapRecordRepository {
    private readonly store;
    save(record: ScrapRecord): Promise<void>;
    findById(tenantId: TenantId, id: ScrapRecordId): Promise<ScrapRecord | null>;
    listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<ScrapRecord[]>;
    list(tenantId: TenantId, filter?: {
        reasonCode?: string;
    }): Promise<ScrapRecord[]>;
}
//# sourceMappingURL=repositories.d.ts.map