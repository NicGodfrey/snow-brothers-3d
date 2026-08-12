import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  nowIso,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import {
  MesEvents,
  type WorkOrderOperationReportedPayload,
  type WorkOrderReleasedPayload,
} from "./events.js";
import {
  asUlid,
  qty,
  type Quantity,
  type RoutingId,
  type UnitOfMeasure,
  type WorkCenterId,
} from "./ids.js";
import type { RoutingOperation } from "./routing.js";

/* ------------------------------------------------------------------ */
/* Status machine                                                      */
/* ------------------------------------------------------------------ */

export const WORK_ORDER_STATUSES = [
  "DRAFT",
  "PLANNED",
  "RELEASED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/**
 * Explicit transition table. ON_HOLD resume is handled separately because
 * it returns to the status the order was held from.
 */
export const WORK_ORDER_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> =
  {
    DRAFT: ["PLANNED", "RELEASED", "CANCELLED"],
    PLANNED: ["RELEASED", "ON_HOLD", "CANCELLED"],
    RELEASED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
    IN_PROGRESS: ["ON_HOLD", "COMPLETED"],
    ON_HOLD: ["PLANNED", "RELEASED", "IN_PROGRESS", "CANCELLED"],
    COMPLETED: ["CLOSED"],
    CLOSED: [],
    CANCELLED: [],
  };

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WORK_ORDER_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ */
/* Sub-documents                                                       */
/* ------------------------------------------------------------------ */

export const DEMAND_SOURCE_TYPES = [
  "SALES_ORDER",
  "FORECAST",
  "SAFETY_STOCK",
  "REWORK",
  "MANUAL",
] as const;
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

/* ------------------------------------------------------------------ */
/* Aggregate                                                           */
/* ------------------------------------------------------------------ */

export class WorkOrder extends AggregateRoot<WorkOrderProps> {
  private constructor(tenantId: TenantId, props: WorkOrderProps) {
    super(tenantId, props);
  }

  static create(tenantId: TenantId, input: CreateWorkOrderInput): WorkOrder {
    if (input.quantityOrdered <= 0) {
      throw new DomainError("quantityOrdered must be positive", "WO_INVALID_QTY");
    }
    if (input.routingOperations.length === 0) {
      throw new DomainError(
        "Work order requires a routing with at least one operation",
        "WO_NO_OPERATIONS",
        422,
      );
    }
    if (Number.isNaN(Date.parse(`${input.dueDate}T00:00:00Z`))) {
      throw new DomainError(`Invalid due date '${input.dueDate}'`, "WO_INVALID_DUE_DATE");
    }
    const priority = input.priority ?? 5;
    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
      throw new DomainError("priority must be an integer 1..10", "WO_INVALID_PRIORITY");
    }
    const opSeqs = new Set(input.routingOperations.map((op) => op.seq));
    const operations: WorkOrderOperation[] = [...input.routingOperations]
      .sort((a, b) => a.seq - b.seq)
      .map((op) => ({
        ...op,
        status: "PENDING",
        qtyCompleted: 0,
        qtyScrapped: 0,
        laborMinutesActual: 0,
        machineMinutesActual: 0,
        scheduledStart: null,
        scheduledEnd: null,
        startedAt: null,
        finishedAt: null,
      }));

    const requirements = input.bomLines.map((line) =>
      WorkOrder.explodeLine(line, input.quantityOrdered, opSeqs),
    );
    const duplicate = findDuplicateComponent(requirements);
    if (duplicate) {
      throw new DomainError(
        `Component ${duplicate} appears more than once in the BOM`,
        "WO_DUPLICATE_COMPONENT",
        422,
      );
    }

    const wo = new WorkOrder(tenantId, {
      orderNumber: input.orderNumber,
      sku: input.sku.trim().toUpperCase(),
      routingId: input.routingId,
      routingRevision: input.routingRevision,
      status: "DRAFT",
      heldFromStatus: null,
      holdReason: null,
      quantityOrdered: input.quantityOrdered,
      uom: input.uom,
      quantityCompleted: 0,
      quantityScrapped: 0,
      quantityReceived: 0,
      priority,
      dueDate: input.dueDate,
      demandSource: input.demandSource,
      operations,
      requirements,
      scheduledStart: null,
      scheduledEnd: null,
      actualStart: null,
      actualEnd: null,
      closedAt: null,
      cancelReason: null,
    });
    wo.raise(
      envelope({
        eventType: MesEvents.WorkOrderCreated,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(wo.id),
        tenantId,
        payload: {
          orderNumber: wo.props.orderNumber,
          sku: wo.props.sku,
          quantityOrdered: wo.props.quantityOrdered,
          demandSource: wo.props.demandSource,
        },
      }),
    );
    return wo;
  }

  private static explodeLine(
    line: BomLineInput,
    orderQty: number,
    validOpSeqs: ReadonlySet<number>,
  ): MaterialRequirement {
    if (!line.componentSku.trim()) {
      throw new DomainError("BOM line requires componentSku", "WO_INVALID_BOM_LINE");
    }
    if (line.qtyPerUnit <= 0) {
      throw new DomainError(
        `BOM line ${line.componentSku}: qtyPerUnit must be positive`,
        "WO_INVALID_BOM_LINE",
      );
    }
    const scrapFactorPct = line.scrapFactorPct ?? 0;
    if (scrapFactorPct < 0 || scrapFactorPct > 100) {
      throw new DomainError(
        `BOM line ${line.componentSku}: scrapFactorPct must be 0..100`,
        "WO_INVALID_BOM_LINE",
      );
    }
    if (line.operationSeq !== undefined && !validOpSeqs.has(line.operationSeq)) {
      throw new DomainError(
        `BOM line ${line.componentSku}: operationSeq ${line.operationSeq} not in routing`,
        "WO_INVALID_BOM_LINE",
        422,
      );
    }
    const required = orderQty * line.qtyPerUnit * (1 + scrapFactorPct / 100);
    return {
      componentSku: line.componentSku.trim().toUpperCase(),
      qtyPerUnit: line.qtyPerUnit,
      scrapFactorPct,
      uom: line.uom,
      operationSeq: line.operationSeq ?? null,
      unplanned: false,
      requiredQty: Math.round(required * 1e6) / 1e6,
      issuedQty: 0,
    };
  }

  /* -------------------------- accessors --------------------------- */

  get orderNumber(): string {
    return this.props.orderNumber;
  }

  get sku(): string {
    return this.props.sku;
  }

  get status(): WorkOrderStatus {
    return this.props.status;
  }

  get uom(): UnitOfMeasure {
    return this.props.uom;
  }

  get quantityOrdered(): number {
    return this.props.quantityOrdered;
  }

  get quantityCompleted(): number {
    return this.props.quantityCompleted;
  }

  get quantityScrapped(): number {
    return this.props.quantityScrapped;
  }

  get quantityReceived(): number {
    return this.props.quantityReceived;
  }

  get dueDate(): string {
    return this.props.dueDate;
  }

  get priority(): number {
    return this.props.priority;
  }

  get demandSource(): DemandSource {
    return this.props.demandSource;
  }

  get operations(): readonly WorkOrderOperation[] {
    return this.props.operations;
  }

  get requirements(): readonly MaterialRequirement[] {
    return this.props.requirements;
  }

  get scheduledStart(): IsoDateTime | null {
    return this.props.scheduledStart;
  }

  get scheduledEnd(): IsoDateTime | null {
    return this.props.scheduledEnd;
  }

  remainingToReceive(): Quantity {
    return qty(this.props.quantityCompleted - this.props.quantityReceived, this.props.uom);
  }

  private operation(seq: number): WorkOrderOperation {
    const op = this.props.operations.find((o) => o.seq === seq);
    if (!op) {
      throw new DomainError(
        `Work order ${this.props.orderNumber} has no operation ${seq}`,
        "WO_OP_NOT_FOUND",
        404,
      );
    }
    return op;
  }

  private transitionTo(next: WorkOrderStatus): void {
    if (!canTransition(this.props.status, next)) {
      throw new ConflictError(
        `Work order ${this.props.orderNumber}: illegal transition ${this.props.status} -> ${next}`,
      );
    }
    this.props.status = next;
  }

  /* -------------------------- lifecycle --------------------------- */

  /**
   * Attach a schedule (computed by the scheduling module) and move to
   * PLANNED. Replanning while still PLANNED is allowed.
   */
  applySchedule(schedule: {
    scheduledStart: IsoDateTime;
    scheduledEnd: IsoDateTime;
    operations: ReadonlyArray<{ seq: number; start: IsoDateTime; end: IsoDateTime }>;
  }): void {
    if (this.props.status !== "DRAFT" && this.props.status !== "PLANNED") {
      throw new ConflictError(
        `Cannot (re)plan work order in status ${this.props.status}`,
      );
    }
    for (const opSchedule of schedule.operations) {
      const op = this.operation(opSchedule.seq);
      op.scheduledStart = opSchedule.start;
      op.scheduledEnd = opSchedule.end;
    }
    this.props.scheduledStart = schedule.scheduledStart;
    this.props.scheduledEnd = schedule.scheduledEnd;
    if (this.props.status === "DRAFT") this.transitionTo("PLANNED");
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderPlanned,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: {
          orderNumber: this.props.orderNumber,
          scheduledStart: schedule.scheduledStart,
          scheduledEnd: schedule.scheduledEnd,
        },
      }),
    );
  }

  release(): void {
    this.transitionTo("RELEASED");
    const first = this.props.operations[0]!;
    first.status = "READY";
    const payload: WorkOrderReleasedPayload = {
      workOrderId: this.id,
      orderNumber: this.props.orderNumber,
      sku: this.props.sku,
      quantityOrdered: this.props.quantityOrdered,
      uom: this.props.uom,
      dueDate: this.props.dueDate,
      requirements: this.props.requirements.map((r) => ({
        componentSku: r.componentSku,
        requiredQty: r.requiredQty,
        uom: r.uom,
        operationSeq: r.operationSeq,
      })),
    };
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderReleased,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload,
      }),
    );
  }

  start(): void {
    this.transitionTo("IN_PROGRESS");
    this.props.actualStart = this.props.actualStart ?? nowIso();
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderStarted,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { orderNumber: this.props.orderNumber },
      }),
    );
  }

  /**
   * Confirm production at one operation. Enforces flow: quantity can only
   * move through an operation after the previous one produced it, and the
   * first operation is capped by the ordered quantity.
   */
  reportOperation(input: OperationReportInput): void {
    if (this.props.status !== "IN_PROGRESS") {
      throw new ConflictError(
        `Cannot report production: work order is ${this.props.status}`,
      );
    }
    const qtyGood = input.qtyGood;
    const qtyScrap = input.qtyScrap ?? 0;
    if (qtyGood < 0 || qtyScrap < 0 || qtyGood + qtyScrap <= 0) {
      throw new DomainError(
        "Report requires non-negative quantities with a positive total",
        "WO_INVALID_REPORT",
      );
    }
    const op = this.operation(input.seq);
    if (op.status === "PENDING") {
      throw new ConflictError(
        `Operation ${input.seq} is not ready — previous operation has produced nothing`,
      );
    }
    if (op.status === "DONE") {
      throw new ConflictError(`Operation ${input.seq} is already complete`);
    }

    const idx = this.props.operations.findIndex((o) => o.seq === input.seq);
    const available = this.availableAtOperation(idx);
    const alreadyProcessed = op.qtyCompleted + op.qtyScrapped;
    if (alreadyProcessed + qtyGood + qtyScrap > available + 1e-9) {
      throw new DomainError(
        `Operation ${input.seq}: reporting ${qtyGood + qtyScrap} exceeds available ${
          available - alreadyProcessed
        }`,
        "WO_REPORT_EXCEEDS_AVAILABLE",
        422,
      );
    }

    op.status = "RUNNING";
    op.startedAt = op.startedAt ?? nowIso();
    op.qtyCompleted = round6(op.qtyCompleted + qtyGood);
    op.qtyScrapped = round6(op.qtyScrapped + qtyScrap);
    op.laborMinutesActual = round6(op.laborMinutesActual + (input.laborMinutes ?? 0));
    op.machineMinutesActual = round6(op.machineMinutesActual + (input.machineMinutes ?? 0));

    if (qtyScrap > 0) {
      this.props.quantityScrapped = round6(this.props.quantityScrapped + qtyScrap);
    }

    // Auto-complete the operation once everything that can arrive has been
    // processed: predecessor is finished (or this is the first op) and the
    // full available quantity is accounted for.
    const predecessorDone = idx === 0 || this.props.operations[idx - 1]!.status === "DONE";
    if (predecessorDone && op.qtyCompleted + op.qtyScrapped >= available - 1e-9) {
      op.status = "DONE";
      op.finishedAt = nowIso();
      const next = this.props.operations[idx + 1];
      if (next && next.status === "PENDING") next.status = "READY";
    } else {
      // Partial flow: downstream may begin working on what has been produced.
      const next = this.props.operations[idx + 1];
      if (next && next.status === "PENDING" && op.qtyCompleted > 0) next.status = "READY";
    }

    const isLast = idx === this.props.operations.length - 1;
    if (isLast) {
      this.props.quantityCompleted = op.qtyCompleted;
    }

    const payload: WorkOrderOperationReportedPayload = {
      workOrderId: this.id,
      operationSeq: op.seq,
      workCenterId: op.workCenterId,
      qtyGood,
      qtyScrapped: qtyScrap,
      operationStatus: op.status,
      laborMinutes: input.laborMinutes ?? 0,
      machineMinutes: input.machineMinutes ?? 0,
    };
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderOperationReported,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload,
      }),
    );
  }

  /** Quantity that can flow into the operation at position idx. */
  private availableAtOperation(idx: number): number {
    if (idx === 0) return this.props.quantityOrdered;
    return this.props.operations[idx - 1]!.qtyCompleted;
  }

  hold(reason: string): void {
    if (!reason.trim()) {
      throw new DomainError("Hold requires a reason", "WO_HOLD_REASON_REQUIRED");
    }
    const from = this.props.status;
    this.transitionTo("ON_HOLD");
    this.props.heldFromStatus = from;
    this.props.holdReason = reason.trim();
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderHeld,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { orderNumber: this.props.orderNumber, reason: reason.trim(), heldFrom: from },
      }),
    );
  }

  resume(): void {
    if (this.props.status !== "ON_HOLD" || !this.props.heldFromStatus) {
      throw new ConflictError(`Work order ${this.props.orderNumber} is not on hold`);
    }
    const target = this.props.heldFromStatus;
    this.transitionTo(target);
    this.props.heldFromStatus = null;
    this.props.holdReason = null;
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderResumed,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { orderNumber: this.props.orderNumber, resumedTo: target },
      }),
    );
  }

  complete(): void {
    const unfinished = this.props.operations.filter((op) => op.status !== "DONE");
    if (unfinished.length > 0) {
      throw new ConflictError(
        `Cannot complete: operations [${unfinished.map((o) => o.seq).join(", ")}] not done`,
      );
    }
    this.transitionTo("COMPLETED");
    this.props.actualEnd = nowIso();
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderCompleted,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: {
          orderNumber: this.props.orderNumber,
          quantityCompleted: this.props.quantityCompleted,
          quantityScrapped: this.props.quantityScrapped,
        },
      }),
    );
  }

  close(): void {
    if (this.props.quantityReceived < this.props.quantityCompleted) {
      throw new ConflictError(
        `Cannot close: ${round6(
          this.props.quantityCompleted - this.props.quantityReceived,
        )} ${this.props.uom} completed but not yet received to stock`,
      );
    }
    this.transitionTo("CLOSED");
    this.props.closedAt = nowIso();
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderClosed,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { orderNumber: this.props.orderNumber },
      }),
    );
  }

  cancel(reason: string): void {
    if (!reason.trim()) {
      throw new DomainError("Cancel requires a reason", "WO_CANCEL_REASON_REQUIRED");
    }
    const reported = this.props.operations.some((op) => op.qtyCompleted + op.qtyScrapped > 0);
    if (reported) {
      throw new ConflictError(
        "Cannot cancel a work order with reported production; complete or close it instead",
      );
    }
    const netIssued = this.props.requirements.some((r) => r.issuedQty > 1e-9);
    if (netIssued) {
      throw new ConflictError("Cannot cancel: issued materials must be returned first");
    }
    this.transitionTo("CANCELLED");
    this.props.cancelReason = reason.trim();
    this.raise(
      envelope({
        eventType: MesEvents.WorkOrderCancelled,
        aggregateType: "WorkOrder",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { orderNumber: this.props.orderNumber, reason: reason.trim() },
      }),
    );
  }

  /* --------------------- material bookkeeping --------------------- */

  /**
   * Record the WO-side effect of a posted material issue. Called by the
   * material service inside the same logical transaction as the issue doc.
   */
  recordMaterialIssue(componentSku: string, quantity: Quantity, allowUnplanned: boolean): void {
    if (this.props.status !== "RELEASED" && this.props.status !== "IN_PROGRESS") {
      throw new ConflictError(
        `Cannot issue material: work order is ${this.props.status}`,
      );
    }
    const sku = componentSku.trim().toUpperCase();
    let requirement = this.props.requirements.find((r) => r.componentSku === sku);
    if (!requirement) {
      if (!allowUnplanned) {
        throw new DomainError(
          `Component ${sku} is not on the work order BOM (pass unplanned=true to force)`,
          "WO_COMPONENT_NOT_PLANNED",
          422,
        );
      }
      requirement = {
        componentSku: sku,
        qtyPerUnit: 0,
        scrapFactorPct: 0,
        uom: quantity.uom,
        operationSeq: null,
        unplanned: true,
        requiredQty: 0,
        issuedQty: 0,
      };
      this.props.requirements.push(requirement);
    }
    if (requirement.uom !== quantity.uom) {
      throw new DomainError(
        `Component ${sku}: issue UoM ${quantity.uom} does not match requirement UoM ${requirement.uom}`,
        "WO_UOM_MISMATCH",
        422,
      );
    }
    requirement.issuedQty = round6(requirement.issuedQty + quantity.value);
    this.touch();
  }

  recordMaterialReturn(componentSku: string, quantity: Quantity): void {
    const sku = componentSku.trim().toUpperCase();
    const requirement = this.props.requirements.find((r) => r.componentSku === sku);
    if (!requirement) {
      throw new DomainError(`Component ${sku} was never issued`, "WO_COMPONENT_NOT_FOUND", 422);
    }
    if (requirement.uom !== quantity.uom) {
      throw new DomainError(
        `Component ${sku}: return UoM ${quantity.uom} does not match requirement UoM ${requirement.uom}`,
        "WO_UOM_MISMATCH",
        422,
      );
    }
    if (quantity.value > requirement.issuedQty + 1e-9) {
      throw new DomainError(
        `Cannot return ${quantity.value} ${sku}: only ${requirement.issuedQty} issued`,
        "WO_RETURN_EXCEEDS_ISSUED",
        422,
      );
    }
    requirement.issuedQty = round6(requirement.issuedQty - quantity.value);
    this.touch();
  }

  /** Record the WO-side effect of a posted production receipt. */
  recordReceipt(quantity: Quantity): void {
    if (this.props.status !== "IN_PROGRESS" && this.props.status !== "COMPLETED") {
      throw new ConflictError(
        `Cannot post receipt: work order is ${this.props.status}`,
      );
    }
    if (quantity.uom !== this.props.uom) {
      throw new DomainError(
        `Receipt UoM ${quantity.uom} does not match order UoM ${this.props.uom}`,
        "WO_UOM_MISMATCH",
        422,
      );
    }
    const receivable = this.props.quantityCompleted - this.props.quantityReceived;
    if (quantity.value > receivable + 1e-9) {
      throw new DomainError(
        `Cannot receive ${quantity.value}: only ${round6(receivable)} completed and unreceived`,
        "WO_RECEIPT_EXCEEDS_COMPLETED",
        422,
      );
    }
    this.props.quantityReceived = round6(this.props.quantityReceived + quantity.value);
    this.touch();
  }

  /** Shortages: requirements where issued < required (planned lines only). */
  materialShortages(): Array<{ componentSku: string; shortQty: number; uom: UnitOfMeasure }> {
    return this.props.requirements
      .filter((r) => !r.unplanned && r.issuedQty < r.requiredQty - 1e-9)
      .map((r) => ({
        componentSku: r.componentSku,
        shortQty: round6(r.requiredQty - r.issuedQty),
        uom: r.uom,
      }));
  }
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function findDuplicateComponent(requirements: readonly MaterialRequirement[]): string | null {
  const seen = new Set<string>();
  for (const r of requirements) {
    if (seen.has(r.componentSku)) return r.componentSku;
    seen.add(r.componentSku);
  }
  return null;
}
