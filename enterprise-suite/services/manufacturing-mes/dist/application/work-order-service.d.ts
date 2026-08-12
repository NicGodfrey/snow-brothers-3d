import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { ScrapRecord, type ScrapDisposition } from "../domain/scrap-record.js";
import { WorkOrder, type DemandSource, type WorkOrderStatus } from "../domain/work-order.js";
import type { CapacityCalendarRepository, Clock, EventPublisher, RoutingRepository, ScrapRecordRepository, ShiftTemplateRepository, WorkCenterRepository, WorkOrderRepository } from "./ports.js";
export interface CreateWorkOrderCommand {
    sku: string;
    quantity: number;
    uom: string;
    dueDate: string;
    demandSource?: {
        type: DemandSource["type"];
        refId?: string;
    };
    /** Explicit routing; when omitted the latest released routing for the SKU is used. */
    routingId?: string;
    bomLines?: Array<{
        componentSku: string;
        qtyPerUnit: number;
        uom: string;
        scrapFactorPct?: number;
        operationSeq?: number;
    }>;
    priority?: number;
}
export interface ReportOperationCommand {
    seq: number;
    qtyGood: number;
    qtyScrap?: number;
    laborMinutes?: number;
    machineMinutes?: number;
    /** Required when qtyScrap > 0. */
    scrapReasonCode?: string;
    scrapDisposition?: ScrapDisposition;
    scrapNotes?: string;
}
export interface DispatchListEntry {
    workOrderId: string;
    orderNumber: string;
    sku: string;
    priority: number;
    dueDate: string;
    operationSeq: number;
    operationDescription: string;
    operationStatus: string;
    quantityOrdered: number;
    qtyCompleted: number;
    qtyScrapped: number;
    scheduledStart: string | null;
    scheduledEnd: string | null;
}
export declare class WorkOrderService {
    private readonly workOrders;
    private readonly routings;
    private readonly workCenters;
    private readonly calendars;
    private readonly templates;
    private readonly scrapRecords;
    private readonly publisher;
    private readonly clock;
    constructor(workOrders: WorkOrderRepository, routings: RoutingRepository, workCenters: WorkCenterRepository, calendars: CapacityCalendarRepository, templates: ShiftTemplateRepository, scrapRecords: ScrapRecordRepository, publisher: EventPublisher, clock: Clock);
    create(ctx: TenantContext, cmd: CreateWorkOrderCommand): Promise<WorkOrder>;
    private resolveRouting;
    /**
     * Backward-schedule the order against a capacity calendar so it finishes
     * by its due date. Falls back to forward scheduling from today when the
     * due date is too close (backward pass would start in the past).
     */
    plan(ctx: TenantContext, id: string, options?: {
        calendarId?: string;
    }): Promise<WorkOrder>;
    private resolveWindows;
    release(ctx: TenantContext, id: string): Promise<WorkOrder>;
    start(ctx: TenantContext, id: string): Promise<WorkOrder>;
    hold(ctx: TenantContext, id: string, reason: string): Promise<WorkOrder>;
    resume(ctx: TenantContext, id: string): Promise<WorkOrder>;
    complete(ctx: TenantContext, id: string): Promise<WorkOrder>;
    close(ctx: TenantContext, id: string): Promise<WorkOrder>;
    cancel(ctx: TenantContext, id: string, reason: string): Promise<WorkOrder>;
    /**
     * Confirm production at an operation. Auto-starts a RELEASED order on the
     * first report. Scrap quantities require a reason code and produce a
     * ScrapRecord in the same logical transaction.
     */
    reportOperation(ctx: TenantContext, id: string, cmd: ReportOperationCommand): Promise<{
        workOrder: WorkOrder;
        scrapRecord: ScrapRecord | null;
    }>;
    get(ctx: TenantContext, id: string): Promise<WorkOrder>;
    list(ctx: TenantContext, filter?: {
        status?: WorkOrderStatus;
        sku?: string;
        dueBefore?: string;
    }): Promise<WorkOrder[]>;
    shortages(ctx: TenantContext, id: string): Promise<ReturnType<WorkOrder["materialShortages"]>>;
    /**
     * Shop-floor dispatch list: READY/RUNNING operations at a work center,
     * ordered by priority (desc) then scheduled start.
     */
    dispatchList(ctx: TenantContext, workCenterIdValue: string): Promise<DispatchListEntry[]>;
    private mutate;
}
//# sourceMappingURL=work-order-service.d.ts.map