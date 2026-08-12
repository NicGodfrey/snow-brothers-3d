import type { EventEnvelope, TenantId } from "@enterprise-suite/shared-kernel";
import type { CapacityCalendar } from "../domain/capacity-calendar.js";
import type { CapacityCalendarId, MaterialIssueId, ProductionReceiptId, RoutingId, ScrapRecordId, ShiftTemplateId, WorkCenterId, WorkOrderId } from "../domain/ids.js";
import type { MaterialIssue } from "../domain/material-issue.js";
import type { ProductionReceipt } from "../domain/production-receipt.js";
import type { Routing, RoutingStatus } from "../domain/routing.js";
import type { ScrapRecord } from "../domain/scrap-record.js";
import type { ShiftTemplate } from "../domain/shift-template.js";
import type { WorkCenter } from "../domain/work-center.js";
import type { WorkOrder, WorkOrderStatus } from "../domain/work-order.js";
/**
 * Ports (hexagonal architecture): interfaces the application layer depends
 * on, satisfied today by in-memory adapters and later by Postgres.
 * Every method is tenant-scoped — repositories must never leak rows across
 * tenants.
 */
export interface WorkCenterRepository {
    save(workCenter: WorkCenter): Promise<void>;
    findById(tenantId: TenantId, id: WorkCenterId): Promise<WorkCenter | null>;
    findByCode(tenantId: TenantId, code: string): Promise<WorkCenter | null>;
    list(tenantId: TenantId): Promise<WorkCenter[]>;
}
export interface ShiftTemplateRepository {
    save(template: ShiftTemplate): Promise<void>;
    findById(tenantId: TenantId, id: ShiftTemplateId): Promise<ShiftTemplate | null>;
    findByCode(tenantId: TenantId, code: string): Promise<ShiftTemplate | null>;
    list(tenantId: TenantId): Promise<ShiftTemplate[]>;
}
export interface CapacityCalendarRepository {
    save(calendar: CapacityCalendar): Promise<void>;
    findById(tenantId: TenantId, id: CapacityCalendarId): Promise<CapacityCalendar | null>;
    findByCode(tenantId: TenantId, code: string): Promise<CapacityCalendar | null>;
    list(tenantId: TenantId): Promise<CapacityCalendar[]>;
}
export interface RoutingRepository {
    save(routing: Routing): Promise<void>;
    findById(tenantId: TenantId, id: RoutingId): Promise<Routing | null>;
    findBySkuRevision(tenantId: TenantId, sku: string, revision: string): Promise<Routing | null>;
    /** Latest RELEASED routing for a SKU (by releasedAt), for WO creation. */
    findReleasedForSku(tenantId: TenantId, sku: string): Promise<Routing | null>;
    list(tenantId: TenantId, filter?: {
        sku?: string;
        status?: RoutingStatus;
    }): Promise<Routing[]>;
}
export interface WorkOrderRepository {
    save(workOrder: WorkOrder): Promise<void>;
    findById(tenantId: TenantId, id: WorkOrderId): Promise<WorkOrder | null>;
    findByOrderNumber(tenantId: TenantId, orderNumber: string): Promise<WorkOrder | null>;
    list(tenantId: TenantId, filter?: {
        status?: WorkOrderStatus;
        sku?: string;
        dueBefore?: string;
    }): Promise<WorkOrder[]>;
    /** Monotonic per-tenant sequence for order numbers. */
    nextOrderNumber(tenantId: TenantId): Promise<string>;
}
export interface MaterialIssueRepository {
    save(doc: MaterialIssue): Promise<void>;
    findById(tenantId: TenantId, id: MaterialIssueId): Promise<MaterialIssue | null>;
    listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<MaterialIssue[]>;
}
export interface ProductionReceiptRepository {
    save(doc: ProductionReceipt): Promise<void>;
    findById(tenantId: TenantId, id: ProductionReceiptId): Promise<ProductionReceipt | null>;
    listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<ProductionReceipt[]>;
}
export interface ScrapRecordRepository {
    save(record: ScrapRecord): Promise<void>;
    findById(tenantId: TenantId, id: ScrapRecordId): Promise<ScrapRecord | null>;
    listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<ScrapRecord[]>;
    list(tenantId: TenantId, filter?: {
        reasonCode?: string;
    }): Promise<ScrapRecord[]>;
}
/**
 * Outbox-style publisher. Aggregates raise events; services pull and hand
 * them here after the aggregate is persisted (in Postgres this becomes an
 * insert into the outbox table inside the same transaction).
 */
export interface EventPublisher {
    publish(events: readonly EventEnvelope[]): Promise<void>;
}
export interface Clock {
    today(): string;
    now(): Date;
}
//# sourceMappingURL=ports.d.ts.map