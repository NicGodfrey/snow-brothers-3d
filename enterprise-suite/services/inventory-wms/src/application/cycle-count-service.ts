import {
  NotFoundError,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { CycleCountOrder, type CycleCountLine } from "../domain/cycle-count.js";
import type { StockBalance } from "../domain/stock-balance.js";
import type {
  BinRepository,
  CycleCountFilter,
  CycleCountRepository,
  EventOutbox,
  StockBalanceRepository,
} from "./ports.js";
import type { StockService } from "./stock-service.js";
import { invalid } from "./validation.js";

export interface CreateCycleCountCommand {
  warehouseId: Ulid;
  lines: { binId: Ulid; sku: string; lotId?: Ulid | null }[];
  scheduledFor?: IsoDateTime;
  notes?: string;
}

export class CycleCountService {
  constructor(
    private readonly orders: CycleCountRepository,
    private readonly balances: StockBalanceRepository,
    private readonly bins: BinRepository,
    private readonly stockService: StockService,
    private readonly outbox: EventOutbox,
  ) {}

  async createOrder(ctx: TenantContext, cmd: CreateCycleCountCommand): Promise<CycleCountOrder> {
    const warehouse = await this.stockService.requireWarehouse(ctx, cmd.warehouseId);
    warehouse.assertOperational();
    for (const line of cmd.lines) {
      const bin = await this.bins.findById(ctx.tenantId, line.binId);
      if (!bin || bin.warehouseId !== warehouse.id) {
        throw new NotFoundError("Bin", line.binId);
      }
    }
    const order = CycleCountOrder.create(ctx.tenantId, {
      warehouseId: warehouse.id,
      lines: cmd.lines,
      scheduledFor: cmd.scheduledFor,
      notes: cmd.notes,
    });
    await this.orders.save(order);
    await this.outbox.publish(order.pullEvents());
    return order;
  }

  /**
   * Convenience: build a DRAFT order covering every non-empty balance in the
   * given bins (a "count these locations" work order).
   */
  async createOrderForBins(
    ctx: TenantContext,
    warehouseId: Ulid,
    binIds: readonly Ulid[],
    scheduledFor?: IsoDateTime,
  ): Promise<CycleCountOrder> {
    if (binIds.length === 0) invalid("binIds must not be empty");
    const lines: CreateCycleCountCommand["lines"] = [];
    for (const binId of binIds) {
      const balances = await this.balances.list(ctx.tenantId, {
        warehouseId,
        binId,
        nonEmptyOnly: true,
      });
      for (const balance of balances) {
        lines.push({ binId, sku: balance.sku, lotId: balance.lotId });
      }
    }
    if (lines.length === 0) {
      invalid("No non-empty stock balances found in the requested bins");
    }
    return this.createOrder(ctx, { warehouseId, lines, scheduledFor });
  }

  /** Snapshot expected quantities from current balances, then open for counting. */
  async startOrder(ctx: TenantContext, orderId: Ulid): Promise<CycleCountOrder> {
    const order = await this.requireOrder(ctx, orderId);
    const expected = new Map<string, number>();
    for (const line of order.lines) {
      const balance = await this.balances.findByKey(ctx.tenantId, {
        warehouseId: order.warehouseId,
        binId: line.binId,
        sku: line.sku,
        lotId: line.lotId,
      });
      expected.set(String(line.lineId), balance?.onHand ?? 0);
    }
    order.start((line) => expected.get(String(line.lineId)) ?? 0);
    await this.orders.save(order);
    await this.outbox.publish(order.pullEvents());
    return order;
  }

  async recordCount(
    ctx: TenantContext,
    orderId: Ulid,
    lineId: Ulid,
    countedQty: number,
  ): Promise<CycleCountOrder> {
    const order = await this.requireOrder(ctx, orderId);
    order.recordCount(lineId, countedQty, ctx.userId);
    await this.orders.save(order);
    return order;
  }

  async requestRecount(
    ctx: TenantContext,
    orderId: Ulid,
    lineIds: readonly Ulid[],
  ): Promise<CycleCountOrder> {
    const order = await this.requireOrder(ctx, orderId);
    order.requestRecount(lineIds);
    await this.orders.save(order);
    return order;
  }

  /**
   * Complete the order and post one COUNT_ADJUSTMENT per variance line.
   * The variance (counted - expected) is applied as a delta so movements that
   * happened after the snapshot are not clobbered.
   */
  async completeOrder(
    ctx: TenantContext,
    orderId: Ulid,
  ): Promise<{ order: CycleCountOrder; adjustedLines: readonly CycleCountLine[] }> {
    const order = await this.requireOrder(ctx, orderId);
    const variances = order.complete();

    for (const line of variances) {
      await this.stockService.adjustStock(ctx, {
        warehouseId: order.warehouseId,
        binId: line.binId,
        sku: line.sku,
        lotId: line.lotId,
        deltaQty: line.varianceQty ?? 0,
        reasonCode: "CYCLE_COUNT",
        ref: { type: "CYCLE_COUNT", id: String(order.id) },
        note: `Cycle count variance: expected ${line.expectedQty}, counted ${line.countedQty}`,
        allowBlockedBin: true,
      });
    }

    await this.orders.save(order);
    await this.outbox.publish(order.pullEvents());
    return { order, adjustedLines: variances };
  }

  async cancelOrder(ctx: TenantContext, orderId: Ulid, reason?: string): Promise<CycleCountOrder> {
    const order = await this.requireOrder(ctx, orderId);
    order.cancel(reason);
    await this.orders.save(order);
    await this.outbox.publish(order.pullEvents());
    return order;
  }

  async getOrder(ctx: TenantContext, orderId: Ulid): Promise<CycleCountOrder> {
    return this.requireOrder(ctx, orderId);
  }

  async listOrders(ctx: TenantContext, filter?: CycleCountFilter): Promise<CycleCountOrder[]> {
    return this.orders.list(ctx.tenantId, filter);
  }

  private async requireOrder(ctx: TenantContext, id: Ulid): Promise<CycleCountOrder> {
    const order = await this.orders.findById(ctx.tenantId, id);
    if (!order) throw new NotFoundError("CycleCountOrder", id);
    return order;
  }

  /** Expose expected balance resolution for diagnostics/tests. */
  async currentOnHand(ctx: TenantContext, order: CycleCountOrder, line: CycleCountLine): Promise<StockBalance | null> {
    return this.balances.findByKey(ctx.tenantId, {
      warehouseId: order.warehouseId,
      binId: line.binId,
      sku: line.sku,
      lotId: line.lotId,
    });
  }
}
