import {
  ConflictError,
  DomainError,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import {
  capacityCalendarId,
  isUnitOfMeasure,
  routingId,
  workOrderId,
  type WorkCenterId,
  type WorkOrderId,
} from "../domain/ids.js";
import type { Routing } from "../domain/routing.js";
import { backwardSchedule, forwardSchedule, windowsFromCalendar } from "../domain/scheduling.js";
import {
  isScrapReasonCode,
  ScrapRecord,
  type ScrapDisposition,
  type ScrapReasonCode,
} from "../domain/scrap-record.js";
import {
  WorkOrder,
  type BomLineInput,
  type DemandSource,
  type WorkOrderStatus,
} from "../domain/work-order.js";
import type {
  CapacityCalendarRepository,
  Clock,
  EventPublisher,
  RoutingRepository,
  ScrapRecordRepository,
  ShiftTemplateRepository,
  WorkCenterRepository,
  WorkOrderRepository,
} from "./ports.js";

export interface CreateWorkOrderCommand {
  sku: string;
  quantity: number;
  uom: string;
  dueDate: string;
  demandSource?: { type: DemandSource["type"]; refId?: string };
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

export class WorkOrderService {
  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly routings: RoutingRepository,
    private readonly workCenters: WorkCenterRepository,
    private readonly calendars: CapacityCalendarRepository,
    private readonly templates: ShiftTemplateRepository,
    private readonly scrapRecords: ScrapRecordRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /* --------------------------- creation --------------------------- */

  async create(ctx: TenantContext, cmd: CreateWorkOrderCommand): Promise<WorkOrder> {
    if (!isUnitOfMeasure(cmd.uom)) {
      throw new DomainError(`Unknown unit of measure '${cmd.uom}'`, "WO_INVALID_UOM", 422);
    }
    const routing = await this.resolveRouting(ctx, cmd);
    if (routing.status !== "RELEASED") {
      throw new ConflictError(
        `Routing ${routing.sku}/${routing.revision} is ${routing.status}; only RELEASED routings can back a work order`,
      );
    }
    const bomLines: BomLineInput[] = (cmd.bomLines ?? []).map((line) => {
      if (!isUnitOfMeasure(line.uom)) {
        throw new DomainError(
          `BOM line ${line.componentSku}: unknown UoM '${line.uom}'`,
          "WO_INVALID_UOM",
          422,
        );
      }
      return { ...line, uom: line.uom };
    });
    const orderNumber = await this.workOrders.nextOrderNumber(ctx.tenantId);
    const workOrder = WorkOrder.create(ctx.tenantId, {
      orderNumber,
      sku: cmd.sku,
      routingId: routingId(routing.id),
      routingRevision: routing.revision,
      routingOperations: routing.operations,
      quantityOrdered: cmd.quantity,
      uom: cmd.uom,
      dueDate: cmd.dueDate,
      demandSource: {
        type: cmd.demandSource?.type ?? "MANUAL",
        refId: cmd.demandSource?.refId ?? null,
      },
      bomLines,
      priority: cmd.priority,
    });
    await this.workOrders.save(workOrder);
    await this.publisher.publish(workOrder.pullEvents());
    return workOrder;
  }

  private async resolveRouting(ctx: TenantContext, cmd: CreateWorkOrderCommand): Promise<Routing> {
    if (cmd.routingId) {
      const routing = await this.routings.findById(ctx.tenantId, routingId(cmd.routingId));
      if (!routing) throw new NotFoundError("Routing", cmd.routingId);
      return routing;
    }
    const routing = await this.routings.findReleasedForSku(ctx.tenantId, cmd.sku.toUpperCase());
    if (!routing) {
      throw new DomainError(
        `No released routing found for SKU ${cmd.sku.toUpperCase()}`,
        "WO_NO_ROUTING",
        422,
      );
    }
    return routing;
  }

  /* -------------------------- scheduling -------------------------- */

  /**
   * Backward-schedule the order against a capacity calendar so it finishes
   * by its due date. Falls back to forward scheduling from today when the
   * due date is too close (backward pass would start in the past).
   */
  async plan(ctx: TenantContext, id: string, options?: { calendarId?: string }): Promise<WorkOrder> {
    const workOrder = await this.get(ctx, id);
    const windows = await this.resolveWindows(ctx, workOrder, options?.calendarId);

    let schedule = backwardSchedule({
      operations: workOrder.operations,
      quantity: workOrder.quantityOrdered,
      dueDate: workOrder.dueDate,
      windows,
    });
    const today = this.clock.today();
    if (schedule.scheduledStart.slice(0, 10) < today) {
      schedule = forwardSchedule({
        operations: workOrder.operations,
        quantity: workOrder.quantityOrdered,
        earliestStart: today,
        windows,
      });
    }
    workOrder.applySchedule({
      scheduledStart: schedule.scheduledStart,
      scheduledEnd: schedule.scheduledEnd,
      operations: schedule.operations.map((op) => ({ seq: op.seq, start: op.start, end: op.end })),
    });
    await this.workOrders.save(workOrder);
    await this.publisher.publish(workOrder.pullEvents());
    return workOrder;
  }

  private async resolveWindows(
    ctx: TenantContext,
    workOrder: WorkOrder,
    explicitCalendarId?: string,
  ) {
    let calendarIdValue = explicitCalendarId;
    if (!calendarIdValue) {
      const firstOp = workOrder.operations[0]!;
      const workCenter = await this.workCenters.findById(ctx.tenantId, firstOp.workCenterId);
      if (!workCenter) throw new NotFoundError("WorkCenter", firstOp.workCenterId);
      if (!workCenter.calendarId) {
        throw new DomainError(
          `Work center ${workCenter.code} has no capacity calendar; pass calendarId explicitly`,
          "WO_NO_CALENDAR",
          422,
        );
      }
      calendarIdValue = workCenter.calendarId;
    }
    const calendar = await this.calendars.findById(
      ctx.tenantId,
      capacityCalendarId(calendarIdValue),
    );
    if (!calendar) throw new NotFoundError("CapacityCalendar", calendarIdValue);
    const template = await this.templates.findById(ctx.tenantId, calendar.shiftTemplateId);
    if (!template) throw new NotFoundError("ShiftTemplate", calendar.shiftTemplateId);
    return windowsFromCalendar(template, calendar);
  }

  /* -------------------------- lifecycle --------------------------- */

  async release(ctx: TenantContext, id: string): Promise<WorkOrder> {
    return this.mutate(ctx, id, (wo) => wo.release());
  }

  async start(ctx: TenantContext, id: string): Promise<WorkOrder> {
    return this.mutate(ctx, id, (wo) => wo.start());
  }

  async hold(ctx: TenantContext, id: string, reason: string): Promise<WorkOrder> {
    return this.mutate(ctx, id, (wo) => wo.hold(reason));
  }

  async resume(ctx: TenantContext, id: string): Promise<WorkOrder> {
    return this.mutate(ctx, id, (wo) => wo.resume());
  }

  async complete(ctx: TenantContext, id: string): Promise<WorkOrder> {
    return this.mutate(ctx, id, (wo) => wo.complete());
  }

  async close(ctx: TenantContext, id: string): Promise<WorkOrder> {
    return this.mutate(ctx, id, (wo) => wo.close());
  }

  async cancel(ctx: TenantContext, id: string, reason: string): Promise<WorkOrder> {
    return this.mutate(ctx, id, (wo) => wo.cancel(reason));
  }

  /**
   * Confirm production at an operation. Auto-starts a RELEASED order on the
   * first report. Scrap quantities require a reason code and produce a
   * ScrapRecord in the same logical transaction.
   */
  async reportOperation(
    ctx: TenantContext,
    id: string,
    cmd: ReportOperationCommand,
  ): Promise<{ workOrder: WorkOrder; scrapRecord: ScrapRecord | null }> {
    const workOrder = await this.get(ctx, id);
    if (workOrder.status === "RELEASED") {
      workOrder.start();
    }
    const qtyScrap = cmd.qtyScrap ?? 0;
    let scrapRecord: ScrapRecord | null = null;
    let scrapReason: ScrapReasonCode | null = null;
    if (qtyScrap > 0) {
      if (!cmd.scrapReasonCode || !isScrapReasonCode(cmd.scrapReasonCode)) {
        throw new DomainError(
          `Scrap requires a valid reasonCode (got '${cmd.scrapReasonCode ?? ""}')`,
          "WO_SCRAP_REASON_REQUIRED",
          422,
        );
      }
      scrapReason = cmd.scrapReasonCode;
    }
    workOrder.reportOperation({
      seq: cmd.seq,
      qtyGood: cmd.qtyGood,
      qtyScrap,
      laborMinutes: cmd.laborMinutes,
      machineMinutes: cmd.machineMinutes,
    });
    if (qtyScrap > 0) {
      scrapRecord = ScrapRecord.record(ctx.tenantId, {
        workOrderId: workOrderId(workOrder.id),
        operationSeq: cmd.seq,
        sku: workOrder.sku,
        quantity: qtyScrap,
        uom: workOrder.uom,
        reasonCode: scrapReason!,
        disposition: cmd.scrapDisposition ?? "SCRAP",
        notes: cmd.scrapNotes,
        reportedBy: ctx.userId,
      });
      await this.scrapRecords.save(scrapRecord);
    }
    await this.workOrders.save(workOrder);
    const events = [...workOrder.pullEvents(), ...(scrapRecord?.pullEvents() ?? [])];
    await this.publisher.publish(events);
    return { workOrder, scrapRecord };
  }

  /* --------------------------- queries ---------------------------- */

  async get(ctx: TenantContext, id: string): Promise<WorkOrder> {
    const workOrder = await this.workOrders.findById(ctx.tenantId, workOrderId(id));
    if (!workOrder) throw new NotFoundError("WorkOrder", id);
    return workOrder;
  }

  async list(
    ctx: TenantContext,
    filter?: { status?: WorkOrderStatus; sku?: string; dueBefore?: string },
  ): Promise<WorkOrder[]> {
    const all = await this.workOrders.list(ctx.tenantId, filter);
    return all.sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.orderNumber.localeCompare(b.orderNumber),
    );
  }

  async shortages(
    ctx: TenantContext,
    id: string,
  ): Promise<ReturnType<WorkOrder["materialShortages"]>> {
    const workOrder = await this.get(ctx, id);
    return workOrder.materialShortages();
  }

  /**
   * Shop-floor dispatch list: READY/RUNNING operations at a work center,
   * ordered by priority (desc) then scheduled start.
   */
  async dispatchList(ctx: TenantContext, workCenterIdValue: string): Promise<DispatchListEntry[]> {
    const target = workCenterIdValue as WorkCenterId;
    const entries: DispatchListEntry[] = [];
    for (const status of ["RELEASED", "IN_PROGRESS"] as const) {
      const orders = await this.workOrders.list(ctx.tenantId, { status });
      for (const order of orders) {
        for (const op of order.operations) {
          if (op.workCenterId !== target) continue;
          if (op.status !== "READY" && op.status !== "RUNNING") continue;
          entries.push({
            workOrderId: order.id,
            orderNumber: order.orderNumber,
            sku: order.sku,
            priority: order.priority,
            dueDate: order.dueDate,
            operationSeq: op.seq,
            operationDescription: op.description,
            operationStatus: op.status,
            quantityOrdered: order.quantityOrdered,
            qtyCompleted: op.qtyCompleted,
            qtyScrapped: op.qtyScrapped,
            scheduledStart: op.scheduledStart,
            scheduledEnd: op.scheduledEnd,
          });
        }
      }
    }
    return entries.sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.scheduledStart ?? "9999").localeCompare(b.scheduledStart ?? "9999") ||
        a.dueDate.localeCompare(b.dueDate),
    );
  }

  private async mutate(
    ctx: TenantContext,
    id: string,
    action: (wo: WorkOrder) => void,
  ): Promise<WorkOrder> {
    const workOrder = await this.get(ctx, id);
    action(workOrder);
    await this.workOrders.save(workOrder);
    await this.publisher.publish(workOrder.pullEvents());
    return workOrder;
  }
}
