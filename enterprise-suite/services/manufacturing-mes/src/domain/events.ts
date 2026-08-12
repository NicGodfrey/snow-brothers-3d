/**
 * Event catalog for the manufacturing-mes bounded context.
 *
 * Every event is published as a shared-kernel EventEnvelope with
 * `aggregateType` set to one of the aggregate names below and `eventType`
 * set to one of these constants. Downstream consumers (inventory-wms,
 * finance-erp costing, reporting-bi) subscribe by eventType prefix `mes.`.
 */
export const MesEvents = {
  WorkCenterCreated: "mes.work-center.created",
  WorkCenterUpdated: "mes.work-center.updated",
  WorkCenterStatusChanged: "mes.work-center.status-changed",

  ShiftTemplateCreated: "mes.shift-template.created",
  CapacityCalendarCreated: "mes.capacity-calendar.created",
  CapacityExceptionAdded: "mes.capacity-calendar.exception-added",
  CapacityExceptionRemoved: "mes.capacity-calendar.exception-removed",

  RoutingCreated: "mes.routing.created",
  RoutingOperationAdded: "mes.routing.operation-added",
  RoutingOperationUpdated: "mes.routing.operation-updated",
  RoutingOperationRemoved: "mes.routing.operation-removed",
  RoutingReleased: "mes.routing.released",
  RoutingObsoleted: "mes.routing.obsoleted",

  WorkOrderCreated: "mes.work-order.created",
  WorkOrderPlanned: "mes.work-order.planned",
  WorkOrderReleased: "mes.work-order.released",
  WorkOrderStarted: "mes.work-order.started",
  WorkOrderOperationReported: "mes.work-order.operation-reported",
  WorkOrderHeld: "mes.work-order.held",
  WorkOrderResumed: "mes.work-order.resumed",
  WorkOrderCompleted: "mes.work-order.completed",
  WorkOrderClosed: "mes.work-order.closed",
  WorkOrderCancelled: "mes.work-order.cancelled",

  MaterialIssued: "mes.material.issued",
  MaterialReturned: "mes.material.returned",
  ProductionReceiptPosted: "mes.production-receipt.posted",

  ScrapRecorded: "mes.scrap.recorded",
  ReworkOrderCreated: "mes.rework-order.created",
} as const;

export type MesEventType = (typeof MesEvents)[keyof typeof MesEvents];

/* ------------------------------------------------------------------ */
/* Payload contracts for the events that cross service boundaries.     */
/* ------------------------------------------------------------------ */

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
