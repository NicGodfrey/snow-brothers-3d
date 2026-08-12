import { ConflictError, DomainError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { capacityCalendarId, isUnitOfMeasure, routingId, workOrderId, } from "../domain/ids.js";
import { backwardSchedule, forwardSchedule, windowsFromCalendar } from "../domain/scheduling.js";
import { isScrapReasonCode, ScrapRecord, } from "../domain/scrap-record.js";
import { WorkOrder, } from "../domain/work-order.js";
export class WorkOrderService {
    workOrders;
    routings;
    workCenters;
    calendars;
    templates;
    scrapRecords;
    publisher;
    clock;
    constructor(workOrders, routings, workCenters, calendars, templates, scrapRecords, publisher, clock) {
        this.workOrders = workOrders;
        this.routings = routings;
        this.workCenters = workCenters;
        this.calendars = calendars;
        this.templates = templates;
        this.scrapRecords = scrapRecords;
        this.publisher = publisher;
        this.clock = clock;
    }
    /* --------------------------- creation --------------------------- */
    async create(ctx, cmd) {
        if (!isUnitOfMeasure(cmd.uom)) {
            throw new DomainError(`Unknown unit of measure '${cmd.uom}'`, "WO_INVALID_UOM", 422);
        }
        const routing = await this.resolveRouting(ctx, cmd);
        if (routing.status !== "RELEASED") {
            throw new ConflictError(`Routing ${routing.sku}/${routing.revision} is ${routing.status}; only RELEASED routings can back a work order`);
        }
        const bomLines = (cmd.bomLines ?? []).map((line) => {
            if (!isUnitOfMeasure(line.uom)) {
                throw new DomainError(`BOM line ${line.componentSku}: unknown UoM '${line.uom}'`, "WO_INVALID_UOM", 422);
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
    async resolveRouting(ctx, cmd) {
        if (cmd.routingId) {
            const routing = await this.routings.findById(ctx.tenantId, routingId(cmd.routingId));
            if (!routing)
                throw new NotFoundError("Routing", cmd.routingId);
            return routing;
        }
        const routing = await this.routings.findReleasedForSku(ctx.tenantId, cmd.sku.toUpperCase());
        if (!routing) {
            throw new DomainError(`No released routing found for SKU ${cmd.sku.toUpperCase()}`, "WO_NO_ROUTING", 422);
        }
        return routing;
    }
    /* -------------------------- scheduling -------------------------- */
    /**
     * Backward-schedule the order against a capacity calendar so it finishes
     * by its due date. Falls back to forward scheduling from today when the
     * due date is too close (backward pass would start in the past).
     */
    async plan(ctx, id, options) {
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
    async resolveWindows(ctx, workOrder, explicitCalendarId) {
        let calendarIdValue = explicitCalendarId;
        if (!calendarIdValue) {
            const firstOp = workOrder.operations[0];
            const workCenter = await this.workCenters.findById(ctx.tenantId, firstOp.workCenterId);
            if (!workCenter)
                throw new NotFoundError("WorkCenter", firstOp.workCenterId);
            if (!workCenter.calendarId) {
                throw new DomainError(`Work center ${workCenter.code} has no capacity calendar; pass calendarId explicitly`, "WO_NO_CALENDAR", 422);
            }
            calendarIdValue = workCenter.calendarId;
        }
        const calendar = await this.calendars.findById(ctx.tenantId, capacityCalendarId(calendarIdValue));
        if (!calendar)
            throw new NotFoundError("CapacityCalendar", calendarIdValue);
        const template = await this.templates.findById(ctx.tenantId, calendar.shiftTemplateId);
        if (!template)
            throw new NotFoundError("ShiftTemplate", calendar.shiftTemplateId);
        return windowsFromCalendar(template, calendar);
    }
    /* -------------------------- lifecycle --------------------------- */
    async release(ctx, id) {
        return this.mutate(ctx, id, (wo) => wo.release());
    }
    async start(ctx, id) {
        return this.mutate(ctx, id, (wo) => wo.start());
    }
    async hold(ctx, id, reason) {
        return this.mutate(ctx, id, (wo) => wo.hold(reason));
    }
    async resume(ctx, id) {
        return this.mutate(ctx, id, (wo) => wo.resume());
    }
    async complete(ctx, id) {
        return this.mutate(ctx, id, (wo) => wo.complete());
    }
    async close(ctx, id) {
        return this.mutate(ctx, id, (wo) => wo.close());
    }
    async cancel(ctx, id, reason) {
        return this.mutate(ctx, id, (wo) => wo.cancel(reason));
    }
    /**
     * Confirm production at an operation. Auto-starts a RELEASED order on the
     * first report. Scrap quantities require a reason code and produce a
     * ScrapRecord in the same logical transaction.
     */
    async reportOperation(ctx, id, cmd) {
        const workOrder = await this.get(ctx, id);
        if (workOrder.status === "RELEASED") {
            workOrder.start();
        }
        const qtyScrap = cmd.qtyScrap ?? 0;
        let scrapRecord = null;
        let scrapReason = null;
        if (qtyScrap > 0) {
            if (!cmd.scrapReasonCode || !isScrapReasonCode(cmd.scrapReasonCode)) {
                throw new DomainError(`Scrap requires a valid reasonCode (got '${cmd.scrapReasonCode ?? ""}')`, "WO_SCRAP_REASON_REQUIRED", 422);
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
                reasonCode: scrapReason,
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
    async get(ctx, id) {
        const workOrder = await this.workOrders.findById(ctx.tenantId, workOrderId(id));
        if (!workOrder)
            throw new NotFoundError("WorkOrder", id);
        return workOrder;
    }
    async list(ctx, filter) {
        const all = await this.workOrders.list(ctx.tenantId, filter);
        return all.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.orderNumber.localeCompare(b.orderNumber));
    }
    async shortages(ctx, id) {
        const workOrder = await this.get(ctx, id);
        return workOrder.materialShortages();
    }
    /**
     * Shop-floor dispatch list: READY/RUNNING operations at a work center,
     * ordered by priority (desc) then scheduled start.
     */
    async dispatchList(ctx, workCenterIdValue) {
        const target = workCenterIdValue;
        const entries = [];
        for (const status of ["RELEASED", "IN_PROGRESS"]) {
            const orders = await this.workOrders.list(ctx.tenantId, { status });
            for (const order of orders) {
                for (const op of order.operations) {
                    if (op.workCenterId !== target)
                        continue;
                    if (op.status !== "READY" && op.status !== "RUNNING")
                        continue;
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
        return entries.sort((a, b) => b.priority - a.priority ||
            (a.scheduledStart ?? "9999").localeCompare(b.scheduledStart ?? "9999") ||
            a.dueDate.localeCompare(b.dueDate));
    }
    async mutate(ctx, id, action) {
        const workOrder = await this.get(ctx, id);
        action(workOrder);
        await this.workOrders.save(workOrder);
        await this.publisher.publish(workOrder.pullEvents());
        return workOrder;
    }
}
//# sourceMappingURL=work-order-service.js.map