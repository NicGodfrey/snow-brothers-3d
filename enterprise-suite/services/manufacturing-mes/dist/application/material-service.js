import { DomainError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { isUnitOfMeasure, qty, workOrderId, } from "../domain/ids.js";
import { MaterialIssue } from "../domain/material-issue.js";
import { ProductionReceipt } from "../domain/production-receipt.js";
/**
 * Coordinates the two sides of every material movement: the immutable
 * posted document and the running totals on the work order. Both are saved
 * before events are published, mirroring a single DB transaction + outbox.
 */
export class MaterialService {
    workOrders;
    issues;
    receipts;
    publisher;
    constructor(workOrders, issues, receipts, publisher) {
        this.workOrders = workOrders;
        this.issues = issues;
        this.receipts = receipts;
        this.publisher = publisher;
    }
    async issueMaterials(ctx, workOrderIdValue, cmd) {
        const workOrder = await this.getWorkOrder(ctx, workOrderIdValue);
        // Apply WO-side effects first: they validate status, planned components
        // and UoM before any document exists.
        for (const line of cmd.lines) {
            workOrder.recordMaterialIssue(line.componentSku, qty(line.qty, this.lineUom(line)), line.unplanned ?? false);
        }
        const document = MaterialIssue.post(ctx.tenantId, {
            workOrderId: workOrderId(workOrder.id),
            direction: "ISSUE",
            warehouseCode: cmd.warehouseCode,
            lines: cmd.lines,
            postedBy: ctx.userId,
            note: cmd.note,
        });
        await this.issues.save(document);
        await this.workOrders.save(workOrder);
        await this.publisher.publish([...document.pullEvents(), ...workOrder.pullEvents()]);
        return { document, workOrder };
    }
    async returnMaterials(ctx, workOrderIdValue, cmd) {
        const workOrder = await this.getWorkOrder(ctx, workOrderIdValue);
        for (const line of cmd.lines) {
            workOrder.recordMaterialReturn(line.componentSku, qty(line.qty, this.lineUom(line)));
        }
        const document = MaterialIssue.post(ctx.tenantId, {
            workOrderId: workOrderId(workOrder.id),
            direction: "RETURN",
            warehouseCode: cmd.warehouseCode,
            lines: cmd.lines,
            postedBy: ctx.userId,
            note: cmd.note,
        });
        await this.issues.save(document);
        await this.workOrders.save(workOrder);
        await this.publisher.publish([...document.pullEvents(), ...workOrder.pullEvents()]);
        return { document, workOrder };
    }
    async postReceipt(ctx, workOrderIdValue, cmd) {
        const workOrder = await this.getWorkOrder(ctx, workOrderIdValue);
        workOrder.recordReceipt(qty(cmd.qtyGood, workOrder.uom));
        const document = ProductionReceipt.post(ctx.tenantId, {
            workOrderId: workOrderId(workOrder.id),
            sku: workOrder.sku,
            qtyGood: cmd.qtyGood,
            uom: workOrder.uom,
            warehouseCode: cmd.warehouseCode,
            lotNumber: cmd.lotNumber,
            postedBy: ctx.userId,
            note: cmd.note,
        });
        await this.receipts.save(document);
        await this.workOrders.save(workOrder);
        await this.publisher.publish([...document.pullEvents(), ...workOrder.pullEvents()]);
        return { document, workOrder };
    }
    async listIssuesForWorkOrder(ctx, workOrderIdValue) {
        return this.issues.listByWorkOrder(ctx.tenantId, workOrderIdValue);
    }
    async listReceiptsForWorkOrder(ctx, workOrderIdValue) {
        return this.receipts.listByWorkOrder(ctx.tenantId, workOrderIdValue);
    }
    async getWorkOrder(ctx, id) {
        const workOrder = await this.workOrders.findById(ctx.tenantId, workOrderId(id));
        if (!workOrder)
            throw new NotFoundError("WorkOrder", id);
        return workOrder;
    }
    lineUom(line) {
        if (!isUnitOfMeasure(line.uom)) {
            throw new DomainError(`Line ${line.componentSku}: unknown UoM '${line.uom}'`, "MATERIAL_INVALID_UOM", 422);
        }
        return line.uom;
    }
}
//# sourceMappingURL=material-service.js.map