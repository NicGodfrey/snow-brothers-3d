import { envelope, type EventEnvelope, type TenantId, type Ulid } from "../../kernel/index.js";

export const QUOTE_AGGREGATE = "Quote";

export const QuoteEventTypes = {
  QuoteCreated: "sales.quote.created",
  QuoteSubmitted: "sales.quote.submitted",
  QuoteApproved: "sales.quote.approved",
  QuoteRejected: "sales.quote.rejected",
  QuoteAccepted: "sales.quote.accepted",
  QuoteExpired: "sales.quote.expired",
  QuoteCancelled: "sales.quote.cancelled",
  QuoteRevised: "sales.quote.revised",
} as const;

export interface QuoteLifecyclePayload {
  readonly quoteNumber: string;
  readonly accountId: string;
  readonly revision: number;
}

export interface QuoteAcceptedPayload extends QuoteLifecyclePayload {
  readonly grandTotalMinor: number;
  readonly currency: string;
  readonly opportunityId?: string;
}

export interface QuoteRejectedPayload extends QuoteLifecyclePayload {
  readonly reason: string;
}

export function quoteEvent<TPayload>(
  eventType: string,
  aggregateId: Ulid,
  tenantId: TenantId,
  payload: TPayload,
): EventEnvelope<TPayload> {
  return envelope({ eventType, aggregateType: QUOTE_AGGREGATE, aggregateId, tenantId, payload });
}
