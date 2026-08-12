import {
  ConflictError,
  moneyToJSON,
  type Money,
  type TenantContext,
  type Ulid,
} from "../kernel/index.js";
import { ReturnAuthorization, type RmaStatus } from "../domain/returns/rma.js";
import type { OrderLine } from "../domain/orders/order-line.js";
import { DocumentNumberGenerator } from "../domain/numbering.js";
import type { OutboxPort, ReturnRepository, SalesOrderRepository } from "./ports.js";
import { parse } from "./validation/validator.js";
import { rejectReturnSchema, requestReturnSchema } from "./validation/returns-schemas.js";

/** RMA statuses that still count against the returnable quantity. */
const ACTIVE_RMA_STATUSES: readonly RmaStatus[] = ["requested", "approved", "received", "refunded"];

export class ReturnsService {
  constructor(
    private readonly returns: ReturnRepository,
    private readonly orders: SalesOrderRepository,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Request a return against shipped order lines. Quantity is capped at
   * shipped-minus-already-returned per line; the refund unit price is frozen
   * from the order's effective (discounted) price.
   */
  request(ctx: TenantContext, input: unknown): ReturnAuthorization {
    const cmd = parse(requestReturnSchema, input);
    const order = this.orders.getById(ctx.tenantId, cmd.orderId as Ulid);
    const hasShippedGoods = order.lines.some((l) => l.qtyShipped > 0);
    if (!hasShippedGoods) {
      throw new ConflictError(
        `Order ${order.orderNumber} has no shipped goods; nothing can be returned`,
      );
    }
    const alreadyReturned = this.returnedQtyByOrderLine(ctx, order.id);
    const lines = cmd.lines.map((lineCmd) => {
      const orderLine = order.lineById(lineCmd.orderLineId as Ulid);
      const returnable = orderLine.qtyShipped - (alreadyReturned.get(lineCmd.orderLineId) ?? 0);
      if (lineCmd.qty > returnable) {
        throw new ConflictError(
          `Cannot return ${lineCmd.qty} of ${orderLine.sku}: only ${returnable} shipped units remain returnable`,
        );
      }
      return {
        orderLineId: orderLine.lineId,
        sku: orderLine.sku,
        qty: lineCmd.qty,
        reason: lineCmd.reason,
        unitRefundMinor: effectiveUnitPriceMinor(orderLine),
      };
    });
    const rma = ReturnAuthorization.request(ctx.tenantId, {
      rmaNumber: this.numbers.nextNumber(ctx.tenantId, "rma"),
      orderId: order.id,
      orderNumber: order.orderNumber,
      accountId: order.accountId,
      currency: order.currencyCode as unknown as string,
      lines,
      notes: cmd.notes,
    });
    this.returns.save(rma);
    this.outbox.append(rma.pullEvents());
    return rma;
  }

  get(ctx: TenantContext, id: Ulid): ReturnAuthorization {
    return this.returns.getById(ctx.tenantId, id);
  }

  listByOrder(ctx: TenantContext, orderId: Ulid): ReturnAuthorization[] {
    this.orders.getById(ctx.tenantId, orderId);
    return this.returns.listByOrder(ctx.tenantId, orderId);
  }

  approve(ctx: TenantContext, id: Ulid): ReturnAuthorization {
    const rma = this.returns.getById(ctx.tenantId, id);
    rma.approve();
    this.returns.save(rma);
    this.outbox.append(rma.pullEvents());
    return rma;
  }

  reject(ctx: TenantContext, id: Ulid, input: unknown): ReturnAuthorization {
    const cmd = parse(rejectReturnSchema, input);
    const rma = this.returns.getById(ctx.tenantId, id);
    rma.reject(cmd.reason);
    this.returns.save(rma);
    this.outbox.append(rma.pullEvents());
    return rma;
  }

  markReceived(ctx: TenantContext, id: Ulid): ReturnAuthorization {
    const rma = this.returns.getById(ctx.tenantId, id);
    rma.markReceived();
    this.returns.save(rma);
    this.outbox.append(rma.pullEvents());
    return rma;
  }

  refund(ctx: TenantContext, id: Ulid): { rma: ReturnAuthorization; refund: ReturnType<typeof moneyToJSON> } {
    const rma = this.returns.getById(ctx.tenantId, id);
    const refund: Money = rma.refund();
    this.returns.save(rma);
    this.outbox.append(rma.pullEvents());
    return { rma, refund: moneyToJSON(refund) };
  }

  cancel(ctx: TenantContext, id: Ulid): ReturnAuthorization {
    const rma = this.returns.getById(ctx.tenantId, id);
    rma.cancel();
    this.returns.save(rma);
    this.outbox.append(rma.pullEvents());
    return rma;
  }

  private returnedQtyByOrderLine(ctx: TenantContext, orderId: Ulid): Map<string, number> {
    const result = new Map<string, number>();
    for (const rma of this.returns.listByOrder(ctx.tenantId, orderId)) {
      if (!ACTIVE_RMA_STATUSES.includes(rma.status)) continue;
      for (const line of rma.lines) {
        const key = line.orderLineId as unknown as string;
        result.set(key, (result.get(key) ?? 0) + line.qty);
      }
    }
    return result;
  }
}

/** Unit price net of the line discount, rounded to minor units. */
export function effectiveUnitPriceMinor(line: OrderLine): number {
  const gross = line.unitPrice.amountMinor as unknown as number;
  return Math.round(gross * (1 - line.discountPercent / 100));
}
