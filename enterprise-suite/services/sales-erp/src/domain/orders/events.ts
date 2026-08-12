import { envelope, type EventEnvelope, type TenantId, type Ulid } from "../../kernel/index.js";

export const ORDER_AGGREGATE = "SalesOrder";

export const OrderEventTypes = {
  OrderCreated: "sales.order.created",
  OrderConfirmed: "sales.order.confirmed",
  OrderAllocated: "sales.order.allocated",
  OrderShipped: "sales.order.shipped",
  OrderInvoiced: "sales.order.invoiced",
  OrderClosed: "sales.order.closed",
  OrderCancelled: "sales.order.cancelled",
} as const;

export interface OrderLifecyclePayload {
  readonly orderNumber: string;
  readonly accountId: string;
}

export interface OrderConfirmedPayload extends OrderLifecyclePayload {
  readonly grandTotalMinor: number;
  readonly currency: string;
  readonly creditDecision: string;
  readonly quoteId?: string;
}

export interface OrderCancelledPayload extends OrderLifecyclePayload {
  readonly reason: string;
  readonly previousStatus: string;
}

export interface OrderShippedPayload extends OrderLifecyclePayload {
  readonly shipments: readonly { lineId: string; sku: string; qty: number }[];
  readonly fullyShipped: boolean;
}

export function orderEvent<TPayload>(
  eventType: string,
  aggregateId: Ulid,
  tenantId: TenantId,
  payload: TPayload,
): EventEnvelope<TPayload> {
  return envelope({ eventType, aggregateType: ORDER_AGGREGATE, aggregateId, tenantId, payload });
}
