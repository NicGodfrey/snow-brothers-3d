import { envelope, type EventEnvelope, type TenantId, type Ulid } from "../../kernel/index.js";

export const OPPORTUNITY_AGGREGATE = "Opportunity";

export const OpportunityEventTypes = {
  OpportunityCreated: "sales.opportunity.created",
  OpportunityStageChanged: "sales.opportunity.stage-changed",
  OpportunityAmountRevised: "sales.opportunity.amount-revised",
  OpportunityWon: "sales.opportunity.won",
  OpportunityLost: "sales.opportunity.lost",
} as const;

export interface OpportunityStageChangedPayload {
  readonly fromStage: string;
  readonly toStage: string;
  readonly probability: number;
}

export interface OpportunityClosedPayload {
  readonly stage: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly lostReason?: string;
}

export function opportunityEvent<TPayload>(
  eventType: string,
  aggregateId: Ulid,
  tenantId: TenantId,
  payload: TPayload,
): EventEnvelope<TPayload> {
  return envelope({
    eventType,
    aggregateType: OPPORTUNITY_AGGREGATE,
    aggregateId,
    tenantId,
    payload,
  });
}
