import {
  ConflictError,
  DomainError,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { routingId, scrapRecordId, workOrderId, type WorkOrderId } from "../domain/ids.js";
import { ScrapRecord, type ScrapDisposition, type ScrapReasonCode } from "../domain/scrap-record.js";
import { WorkOrder } from "../domain/work-order.js";
import type {
  EventPublisher,
  RoutingRepository,
  ScrapRecordRepository,
  WorkOrderRepository,
} from "./ports.js";

export interface ScrapSummaryRow {
  reasonCode: string;
  disposition: string;
  recordCount: number;
  totalQty: number;
}

export class ScrapService {
  constructor(
    private readonly scrapRecords: ScrapRecordRepository,
    private readonly workOrders: WorkOrderRepository,
    private readonly routings: RoutingRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async get(ctx: TenantContext, id: string): Promise<ScrapRecord> {
    const record = await this.scrapRecords.findById(ctx.tenantId, scrapRecordId(id));
    if (!record) throw new NotFoundError("ScrapRecord", id);
    return record;
  }

  async listForWorkOrder(ctx: TenantContext, workOrderIdValue: string): Promise<ScrapRecord[]> {
    return this.scrapRecords.listByWorkOrder(ctx.tenantId, workOrderIdValue as WorkOrderId);
  }

  async list(ctx: TenantContext, filter?: { reasonCode?: string }): Promise<ScrapRecord[]> {
    return this.scrapRecords.list(ctx.tenantId, filter);
  }

  /** Pareto-style aggregation used by quality dashboards. */
  async summary(ctx: TenantContext): Promise<ScrapSummaryRow[]> {
    const records = await this.scrapRecords.list(ctx.tenantId);
    const buckets = new Map<string, ScrapSummaryRow>();
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
  async recordStandalone(
    ctx: TenantContext,
    input: {
      workOrderId: string;
      operationSeq: number;
      quantity: number;
      reasonCode: ScrapReasonCode;
      disposition?: ScrapDisposition;
      notes?: string;
    },
  ): Promise<ScrapRecord> {
    const workOrder = await this.getWorkOrder(ctx, input.workOrderId);
    if (!workOrder.operations.some((op) => op.seq === input.operationSeq)) {
      throw new DomainError(
        `Work order ${workOrder.orderNumber} has no operation ${input.operationSeq}`,
        "SCRAP_INVALID_OPERATION",
        422,
      );
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
  async createReworkOrder(
    ctx: TenantContext,
    scrapRecordIdValue: string,
    options?: { dueDate?: string; priority?: number },
  ): Promise<{ scrapRecord: ScrapRecord; reworkOrder: WorkOrder }> {
    const record = await this.get(ctx, scrapRecordIdValue);
    if (record.disposition !== "REWORK") {
      throw new ConflictError(
        `Scrap record ${record.id} has disposition ${record.disposition}; only REWORK records spawn rework orders`,
      );
    }
    if (record.reworkWorkOrderId) {
      throw new ConflictError(`Scrap record ${record.id} already has a rework order`);
    }
    const original = await this.getWorkOrder(ctx, record.workOrderRef);
    const originalJson = original.toJSON();
    const routing = await this.routings.findById(
      ctx.tenantId,
      routingId(originalJson.routingId),
    );
    if (!routing) throw new NotFoundError("Routing", originalJson.routingId);

    const recordJson = record.toJSON();
    const reworkOps = routing.operations.filter((op) => op.seq >= recordJson.operationSeq);
    if (reworkOps.length === 0) {
      throw new DomainError(
        `Routing has no operations at or after seq ${recordJson.operationSeq}`,
        "SCRAP_NO_REWORK_PATH",
        422,
      );
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

  private async getWorkOrder(ctx: TenantContext, id: string): Promise<WorkOrder> {
    const workOrder = await this.workOrders.findById(ctx.tenantId, workOrderId(id));
    if (!workOrder) throw new NotFoundError("WorkOrder", id);
    return workOrder;
  }
}
