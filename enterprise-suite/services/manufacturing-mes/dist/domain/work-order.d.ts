import { AggregateRoot, type IsoDateTime, type TenantId } from "@enterprise-suite/shared-kernel";
import { type Quantity, type RoutingId, type UnitOfMeasure, type WorkCenterId } from "./ids.js";
import type { RoutingOperation } from "./routing.js";
export declare const WORK_ORDER_STATUSES: readonly ["DRAFT", "PLANNED", "RELEASED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"];
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
/**
 * Explicit transition table. ON_HOLD resume is handled separately because
 * it returns to the status the order was held from.
 */
export declare const WORK_ORDER_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>>;
export declare function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean;
export declare const DEMAND_SOURCE_TYPES: readonly ["SALES_ORDER", "FORECAST", "SAFETY_STOCK", "REWORK", "MANUAL"];
export type DemandSourceType = (typeof DEMAND_SOURCE_TYPES)[number];
export interface DemandSource {
    readonly type: DemandSourceType;
    /** e.g. sales order id, forecast bucket id, or originating work order id. */
    readonly refId: string | null;
}
export type WorkOrderOperationStatus = "PENDING" | "READY" | "RUNNING" | "DONE";
/** Routing operation snapshot enriched with execution state. */
export interface WorkOrderOperation {
    readonly seq: number;
    readonly description: string;
    readonly workCenterId: WorkCenterId;
    readonly setupMinutes: number;
    readonly runMinutesPerUnit: number;
    readonly teardownMinutes: number;
    readonly queueMinutes: number;
    readonly moveMinutes: number;
    readonly inspectionRequired: boolean;
    readonly crewSize: number;
    status: WorkOrderOperationStatus;
    qtyCompleted: number;
    qtyScrapped: number;
    laborMinutesActual: number;
    machineMinutesActual: number;
    scheduledStart: IsoDateTime | null;
    scheduledEnd: IsoDateTime | null;
    startedAt: IsoDateTime | null;
    finishedAt: IsoDateTime | null;
}
/** BOM component demand exploded at order creation time. */
export interface MaterialRequirement {
    readonly componentSku: string;
    readonly qtyPerUnit: number;
    readonly scrapFactorPct: number;
    readonly uom: UnitOfMeasure;
    /** Operation at which the component is consumed; null = order start. */
    readonly operationSeq: number | null;
    /** True when added ad-hoc during execution rather than from the BOM. */
    readonly unplanned: boolean;
    requiredQty: number;
    issuedQty: number;
}
export interface BomLineInput {
    componentSku: string;
    qtyPerUnit: number;
    uom: UnitOfMeasure;
    scrapFactorPct?: number;
    operationSeq?: number;
}
export interface WorkOrderProps {
    orderNumber: string;
    sku: string;
    routingId: RoutingId;
    routingRevision: string;
    status: WorkOrderStatus;
    /** Status the order was in when put ON_HOLD, for resume. */
    heldFromStatus: WorkOrderStatus | null;
    holdReason: string | null;
    quantityOrdered: number;
    uom: UnitOfMeasure;
    /** Good units confirmed at the final operation. */
    quantityCompleted: number;
    /** Units lost to scrap across all operations. */
    quantityScrapped: number;
    /** Good units received into inventory via production receipts. */
    quantityReceived: number;
    priority: number;
    dueDate: string;
    demandSource: DemandSource;
    operations: WorkOrderOperation[];
    requirements: MaterialRequirement[];
    scheduledStart: IsoDateTime | null;
    scheduledEnd: IsoDateTime | null;
    actualStart: IsoDateTime | null;
    actualEnd: IsoDateTime | null;
    closedAt: IsoDateTime | null;
    cancelReason: string | null;
}
export interface CreateWorkOrderInput {
    orderNumber: string;
    sku: string;
    routingId: RoutingId;
    routingRevision: string;
    routingOperations: readonly RoutingOperation[];
    quantityOrdered: number;
    uom: UnitOfMeasure;
    dueDate: string;
    demandSource: DemandSource;
    bomLines: BomLineInput[];
    priority?: number;
}
export interface OperationReportInput {
    seq: number;
    qtyGood: number;
    qtyScrap?: number;
    laborMinutes?: number;
    machineMinutes?: number;
}
export declare class WorkOrder extends AggregateRoot<WorkOrderProps> {
    private constructor();
    static create(tenantId: TenantId, input: CreateWorkOrderInput): WorkOrder;
    private static explodeLine;
    get orderNumber(): string;
    get sku(): string;
    get status(): WorkOrderStatus;
    get uom(): UnitOfMeasure;
    get quantityOrdered(): number;
    get quantityCompleted(): number;
    get quantityScrapped(): number;
    get quantityReceived(): number;
    get dueDate(): string;
    get priority(): number;
    get demandSource(): DemandSource;
    get operations(): readonly WorkOrderOperation[];
    get requirements(): readonly MaterialRequirement[];
    get scheduledStart(): IsoDateTime | null;
    get scheduledEnd(): IsoDateTime | null;
    remainingToReceive(): Quantity;
    private operation;
    private transitionTo;
    /**
     * Attach a schedule (computed by the scheduling module) and move to
     * PLANNED. Replanning while still PLANNED is allowed.
     */
    applySchedule(schedule: {
        scheduledStart: IsoDateTime;
        scheduledEnd: IsoDateTime;
        operations: ReadonlyArray<{
            seq: number;
            start: IsoDateTime;
            end: IsoDateTime;
        }>;
    }): void;
    release(): void;
    start(): void;
    /**
     * Confirm production at one operation. Enforces flow: quantity can only
     * move through an operation after the previous one produced it, and the
     * first operation is capped by the ordered quantity.
     */
    reportOperation(input: OperationReportInput): void;
    /** Quantity that can flow into the operation at position idx. */
    private availableAtOperation;
    hold(reason: string): void;
    resume(): void;
    complete(): void;
    close(): void;
    cancel(reason: string): void;
    /**
     * Record the WO-side effect of a posted material issue. Called by the
     * material service inside the same logical transaction as the issue doc.
     */
    recordMaterialIssue(componentSku: string, quantity: Quantity, allowUnplanned: boolean): void;
    recordMaterialReturn(componentSku: string, quantity: Quantity): void;
    /** Record the WO-side effect of a posted production receipt. */
    recordReceipt(quantity: Quantity): void;
    /** Shortages: requirements where issued < required (planned lines only). */
    materialShortages(): Array<{
        componentSku: string;
        shortQty: number;
        uom: UnitOfMeasure;
    }>;
}
//# sourceMappingURL=work-order.d.ts.map