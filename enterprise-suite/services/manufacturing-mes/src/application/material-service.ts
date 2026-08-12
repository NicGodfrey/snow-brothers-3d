import {
  DomainError,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import {
  isUnitOfMeasure,
  qty,
  workOrderId,
  type UnitOfMeasure,
  type WorkOrderId,
} from "../domain/ids.js";
import { MaterialIssue, type MaterialIssueLineInput } from "../domain/material-issue.js";
import { ProductionReceipt } from "../domain/production-receipt.js";
import type { WorkOrder } from "../domain/work-order.js";
import type {
  EventPublisher,
  MaterialIssueRepository,
  ProductionReceiptRepository,
  WorkOrderRepository,
} from "./ports.js";

export interface IssueMaterialsCommand {
  warehouseCode: string;
  lines: MaterialIssueLineInput[];
  note?: string;
}

export interface PostReceiptCommand {
  qtyGood: number;
  warehouseCode: string;
  lotNumber?: string;
  note?: string;
}

/**
 * Coordinates the two sides of every material movement: the immutable
 * posted document and the running totals on the work order. Both are saved
 * before events are published, mirroring a single DB transaction + outbox.
 */
export class MaterialService {
  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly issues: MaterialIssueRepository,
    private readonly receipts: ProductionReceiptRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async issueMaterials(
    ctx: TenantContext,
    workOrderIdValue: string,
    cmd: IssueMaterialsCommand,
  ): Promise<{ document: MaterialIssue; workOrder: WorkOrder }> {
    const workOrder = await this.getWorkOrder(ctx, workOrderIdValue);
    // Apply WO-side effects first: they validate status, planned components
    // and UoM before any document exists.
    for (const line of cmd.lines) {
      workOrder.recordMaterialIssue(
        line.componentSku,
        qty(line.qty, this.lineUom(line)),
        line.unplanned ?? false,
      );
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

  async returnMaterials(
    ctx: TenantContext,
    workOrderIdValue: string,
    cmd: IssueMaterialsCommand,
  ): Promise<{ document: MaterialIssue; workOrder: WorkOrder }> {
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

  async postReceipt(
    ctx: TenantContext,
    workOrderIdValue: string,
    cmd: PostReceiptCommand,
  ): Promise<{ document: ProductionReceipt; workOrder: WorkOrder }> {
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

  async listIssuesForWorkOrder(
    ctx: TenantContext,
    workOrderIdValue: string,
  ): Promise<MaterialIssue[]> {
    return this.issues.listByWorkOrder(ctx.tenantId, workOrderIdValue as WorkOrderId);
  }

  async listReceiptsForWorkOrder(
    ctx: TenantContext,
    workOrderIdValue: string,
  ): Promise<ProductionReceipt[]> {
    return this.receipts.listByWorkOrder(ctx.tenantId, workOrderIdValue as WorkOrderId);
  }

  private async getWorkOrder(ctx: TenantContext, id: string): Promise<WorkOrder> {
    const workOrder = await this.workOrders.findById(ctx.tenantId, workOrderId(id));
    if (!workOrder) throw new NotFoundError("WorkOrder", id);
    return workOrder;
  }

  private lineUom(line: MaterialIssueLineInput): UnitOfMeasure {
    if (!isUnitOfMeasure(line.uom)) {
      throw new DomainError(
        `Line ${line.componentSku}: unknown UoM '${line.uom}'`,
        "MATERIAL_INVALID_UOM",
        422,
      );
    }
    return line.uom;
  }
}
