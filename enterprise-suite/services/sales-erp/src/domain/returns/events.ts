import { envelope, type EventEnvelope, type TenantId, type Ulid } from "../../kernel/index.js";

export const RMA_AGGREGATE = "ReturnAuthorization";

export const RmaEventTypes = {
  RmaRequested: "sales.rma.requested",
  RmaApproved: "sales.rma.approved",
  RmaRejected: "sales.rma.rejected",
  RmaReceived: "sales.rma.received",
  RmaRefunded: "sales.rma.refunded",
  RmaCancelled: "sales.rma.cancelled",
} as const;

export interface RmaLifecyclePayload {
  readonly rmaNumber: string;
  readonly orderId: string;
  readonly orderNumber: string;
}

export interface RmaRefundedPayload extends RmaLifecyclePayload {
  readonly refundMinor: number;
  readonly currency: string;
}

export function rmaEvent<TPayload>(
  eventType: string,
  aggregateId: Ulid,
  tenantId: TenantId,
  payload: TPayload,
): EventEnvelope<TPayload> {
  return envelope({ eventType, aggregateType: RMA_AGGREGATE, aggregateId, tenantId, payload });
}
