/**
 * Event catalog for the manufacturing-mes bounded context.
 *
 * Every event is published as a shared-kernel EventEnvelope with
 * `aggregateType` set to one of the aggregate names below and `eventType`
 * set to one of these constants. Downstream consumers (inventory-wms,
 * finance-erp costing, reporting-bi) subscribe by eventType prefix `mes.`.
 */
export declare const MesEvents: {
    readonly WorkCenterCreated: "mes.work-center.created";
    readonly WorkCenterUpdated: "mes.work-center.updated";
    readonly WorkCenterStatusChanged: "mes.work-center.status-changed";
    readonly ShiftTemplateCreated: "mes.shift-template.created";
    readonly CapacityCalendarCreated: "mes.capacity-calendar.created";
    readonly CapacityExceptionAdded: "mes.capacity-calendar.exception-added";
    readonly CapacityExceptionRemoved: "mes.capacity-calendar.exception-removed";
    readonly RoutingCreated: "mes.routing.created";
    readonly RoutingOperationAdded: "mes.routing.operation-added";
    readonly RoutingOperationUpdated: "mes.routing.operation-updated";
    readonly RoutingOperationRemoved: "mes.routing.operation-removed";
    readonly RoutingReleased: "mes.routing.released";
    readonly RoutingObsoleted: "mes.routing.obsoleted";
    readonly WorkOrderCreated: "mes.work-order.created";
    readonly WorkOrderPlanned: "mes.work-order.planned";
    readonly WorkOrderReleased: "mes.work-order.released";
    readonly WorkOrderStarted: "mes.work-order.started";
    readonly WorkOrderOperationReported: "mes.work-order.operation-reported";
    readonly WorkOrderHeld: "mes.work-order.held";
    readonly WorkOrderResumed: "mes.work-order.resumed";
    readonly WorkOrderCompleted: "mes.work-order.completed";
    readonly WorkOrderClosed: "mes.work-order.closed";
    readonly WorkOrderCancelled: "mes.work-order.cancelled";
    readonly MaterialIssued: "mes.material.issued";
    readonly MaterialReturned: "mes.material.returned";
    readonly ProductionReceiptPosted: "mes.production-receipt.posted";
    readonly ScrapRecorded: "mes.scrap.recorded";
    readonly ReworkOrderCreated: "mes.rework-order.created";
};
export type MesEventType = (typeof MesEvents)[keyof typeof MesEvents];
export interface WorkOrderReleasedPayload {
    workOrderId: string;
    orderNumber: string;
    sku: string;
    quantityOrdered: number;
    uom: string;
    dueDate: string;
    /** Exploded component demand, consumed by inventory-wms for reservation. */
    requirements: Array<{
        componentSku: string;
        requiredQty: number;
        uom: string;
        operationSeq: number | null;
    }>;
}
export interface WorkOrderOperationReportedPayload {
    workOrderId: string;
    operationSeq: number;
    workCenterId: string;
    qtyGood: number;
    qtyScrapped: number;
    operationStatus: string;
    laborMinutes: number;
    machineMinutes: number;
}
export interface MaterialIssuedPayload {
    materialIssueId: string;
    workOrderId: string;
    direction: "ISSUE" | "RETURN";
    warehouseCode: string;
    lines: Array<{
        componentSku: string;
        qty: number;
        uom: string;
        lotNumber: string | null;
        unplanned: boolean;
    }>;
}
export interface ProductionReceiptPostedPayload {
    productionReceiptId: string;
    workOrderId: string;
    sku: string;
    qtyGood: number;
    uom: string;
    warehouseCode: string;
    lotNumber: string | null;
}
export interface ScrapRecordedPayload {
    scrapRecordId: string;
    workOrderId: string;
    operationSeq: number;
    sku: string;
    qty: number;
    uom: string;
    reasonCode: string;
    disposition: string;
}
//# sourceMappingURL=events.d.ts.map