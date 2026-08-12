import { ConflictError, DomainError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { routingId, scrapRecordId, workOrderId } from "../domain/ids.js";
import { ScrapRecord } from "../domain/scrap-record.js";
import { WorkOrder } from "../domain/work-order.js";
export class ScrapService {
    scrapRecords;
    workOrders;
    routings;
    publisher;
    constructor(scrapRecords, workOrders, routings, publisher) {
        this.scrapRecords = scrapRecords;
        this.workOrders = workOrders;
        this.routings = routings;
        this.publisher = publisher;
    }
    async get(ctx, id) {
        const record = await this.scrapRecords.findById(ctx.tenantId, scrapRecordId(id));
        if (!record)
            throw new NotFoundError("ScrapRecord", id);
        return record;
    }
    async listForWorkOrder(ctx, workOrderIdValue) {
        return this.scrapRecords.listByWorkOrder(ctx.tenantId, workOrderIdValue);
    }
    async list(ctx, filter) {
        return this.scrapRecords.list(ctx.tenantId, filter);
    }
    /** Pareto-style aggregation used by quality dashboards. */
    async summary(ctx) {
        const records = await this.scrapRecords.list(ctx.tenantId);
        const buckets = new Map();
        for (const record of records) {
            const json = record.toJSON();
            const key = `${json.reasonCode}|${json.disposition}`;
            const row = buckets.get(key) ?? {
                reasonCode: json.reasonCode,
                disposition: json.disposition,
                recordCount: 0,
                totalQty: 0,
            };
            row.recordCount += 1;
            row.totalQty = Math.round((row.totalQty + json.quantity) * 1e6) / 1e6;
            buckets.set(key, row);
        }
        return [...buckets.values()].sort((a, b) => b.totalQty - a.totalQty);
    }
    /**
     * Record scrap found outside of operation reporting (e.g. discovered in
     * a downstream audit). Does NOT change work order quantities — use
     * operation reporting for in-process scrap.
     */
    async recordStandalone(ctx, input) {
        const workOrder = await this.getWorkOrder(ctx, input.workOrderId);
        if (!workOrder.operations.some((op) => op.seq === input.operationSeq)) {
            throw new DomainError(`Work order ${workOrder.orderNumber} has no operation ${input.operationSeq}`, "SCRAP_INVALID_OPERATION", 422);
        }
        const record = ScrapRecord.record(ctx.tenantId, {
            workOrderId: workOrderId(workOrder.id),
            operationSeq: input.operationSeq,
            sku: workOrder.sku,
            quantity: input.quantity,
            uom: workOrder.uom,
            reasonCode: input.reasonCode,
            disposition: input.disposition ?? "SCRAP",
            notes: input.notes,
            reportedBy: ctx.userId,
        });
        await this.scrapRecords.save(record);
        await this.publisher.publish(record.pullEvents());
        return record;
    }
    /**
     * Spawn a rework work order from a REWORK-disposition scrap record.
     * The rework order routes the scrapped quantity through the failed
     * operation and everything downstream of it, with no BOM lines (the
     * components were already consumed by the original order).
     */
    async createReworkOrder(ctx, scrapRecordIdValue, options) {
        const record = await this.get(ctx, scrapRecordIdValue);
        if (record.disposition !== "REWORK") {
            throw new ConflictError(`Scrap record ${record.id} has disposition ${record.disposition}; only REWORK records spawn rework orders`);
        }
        if (record.reworkWorkOrderId) {
            throw new ConflictError(`Scrap record ${record.id} already has a rework order`);
        }
        const original = await this.getWorkOrder(ctx, record.workOrderRef);
        const originalJson = original.toJSON();
        const routing = await this.routings.findById(ctx.tenantId, routingId(originalJson.routingId));
        if (!routing)
            throw new NotFoundError("Routing", originalJson.routingId);
        const recordJson = record.toJSON();
        const reworkOps = routing.operations.filter((op) => op.seq >= recordJson.operationSeq);
        if (reworkOps.length === 0) {
            throw new DomainError(`Routing has no operations at or after seq ${recordJson.operationSeq}`, "SCRAP_NO_REWORK_PATH", 422);
        }
        const orderNumber = await this.workOrders.nextOrderNumber(ctx.tenantId);
        const reworkOrder = WorkOrder.create(ctx.tenantId, {
            orderNumber,
            sku: original.sku,
            routingId: routingId(routing.id),
            routingRevision: routing.revision,
            routingOperations: reworkOps,
            quantityOrdered: record.quantity,
            uom: original.uom,
            dueDate: options?.dueDate ?? original.dueDate,
            demandSource: { type: "REWORK", refId: original.id },
            bomLines: [],
            priority: options?.priority ?? Math.min(10, original.priority + 2),
        });
        record.linkReworkOrder(workOrderId(reworkOrder.id));
        await this.workOrders.save(reworkOrder);
        await this.scrapRecords.save(record);
        await this.publisher.publish([...reworkOrder.pullEvents(), ...record.pullEvents()]);
        return { scrapRecord: record, reworkOrder };
    }
    async getWorkOrder(ctx, id) {
        const workOrder = await this.workOrders.findById(ctx.tenantId, workOrderId(id));
        if (!workOrder)
            throw new NotFoundError("WorkOrder", id);
        return workOrder;
    }
}
//# sourceMappingURL=scrap-service.js.map