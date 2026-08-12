import type { IsoDateTime, Money, Ulid } from "@enterprise-suite/shared-kernel";
import type { UtmParams } from "./utm.js";

/**
 * Canonical event type names for the Marketing bounded context.
 * Versioned suffixes allow additive schema evolution without breaking consumers.
 */
export const MarketingEvents = {
  ChannelCreated: "marketing.channel.created.v1",
  ChannelCostModelChanged: "marketing.channel.cost-model-changed.v1",
  ChannelDeactivated: "marketing.channel.deactivated.v1",
  ChannelReactivated: "marketing.channel.reactivated.v1",

  CampaignCreated: "marketing.campaign.created.v1",
  CampaignScheduled: "marketing.campaign.scheduled.v1",
  CampaignActivated: "marketing.campaign.activated.v1",
  CampaignPaused: "marketing.campaign.paused.v1",
  CampaignResumed: "marketing.campaign.resumed.v1",
  CampaignCompleted: "marketing.campaign.completed.v1",
  CampaignArchived: "marketing.campaign.archived.v1",
  CampaignChannelAttached: "marketing.campaign.channel-attached.v1",
  CampaignChannelDetached: "marketing.campaign.channel-detached.v1",

  SegmentCreated: "marketing.segment.created.v1",
  SegmentRulesUpdated: "marketing.segment.rules-updated.v1",
  SegmentArchived: "marketing.segment.archived.v1",

  AudienceBuilt: "marketing.audience.built.v1",

  LeadCaptured: "marketing.lead.captured.v1",
  LeadActivityRecorded: "marketing.lead.activity-recorded.v1",
  LeadStageChanged: "marketing.lead.stage-changed.v1",
  LeadScored: "marketing.lead.scored.v1",
  LeadDisqualified: "marketing.lead.disqualified.v1",
  LeadConsentChanged: "marketing.lead.consent-changed.v1",
  LeadHandedOff: "marketing.lead.handed-off.v1",
  LeadConverted: "marketing.lead.converted.v1",

  ContentAssetCreated: "marketing.content.created.v1",
  ContentAssetSubmitted: "marketing.content.submitted.v1",
  ContentAssetApproved: "marketing.content.approved.v1",
  ContentAssetRejected: "marketing.content.rejected.v1",
  ContentAssetRetired: "marketing.content.retired.v1",
  ContentAssetRevised: "marketing.content.revised.v1",

  SendJobCreated: "marketing.send-job.created.v1",
  SendJobScheduled: "marketing.send-job.scheduled.v1",
  SendJobStarted: "marketing.send-job.started.v1",
  SendJobCompleted: "marketing.send-job.completed.v1",
  SendJobCancelled: "marketing.send-job.cancelled.v1",
  SendJobFailed: "marketing.send-job.failed.v1",

  TouchpointRecorded: "marketing.touchpoint.recorded.v1",

  TrackedLinkCreated: "marketing.tracked-link.created.v1",
  TrackedLinkClicked: "marketing.tracked-link.clicked.v1",

  BudgetCreated: "marketing.budget.created.v1",
  BudgetAdjusted: "marketing.budget.adjusted.v1",
  SpendRecorded: "marketing.budget.spend-recorded.v1",
  BudgetThresholdBreached: "marketing.budget.threshold-breached.v1",
} as const;

export type MarketingEventType = (typeof MarketingEvents)[keyof typeof MarketingEvents];

// ---------------------------------------------------------------------------
// Event payloads. Only fields that downstream contexts genuinely need are
// included; consumers must treat unknown fields as forward-compatible.
// ---------------------------------------------------------------------------

export interface CampaignCreatedPayload {
  readonly campaignId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly objective: string;
}

export interface CampaignStatusPayload {
  readonly campaignId: Ulid;
  readonly previousStatus: string;
  readonly status: string;
}

export interface CampaignChannelPayload {
  readonly campaignId: Ulid;
  readonly channelId: Ulid;
}

export interface SegmentRulesUpdatedPayload {
  readonly segmentId: Ulid;
  readonly ruleSummary: string;
}

export interface AudienceBuiltPayload {
  readonly audienceId: Ulid;
  readonly segmentId: Ulid;
  readonly campaignId?: Ulid;
  readonly size: number;
  readonly suppressedCount: number;
}

export interface LeadCapturedPayload {
  readonly leadId: Ulid;
  readonly email: string;
  readonly source: string;
  readonly utm?: UtmParams;
}

export interface LeadActivityRecordedPayload {
  readonly leadId: Ulid;
  readonly activityType: string;
  readonly occurredAt: IsoDateTime;
  readonly campaignId?: Ulid;
  readonly channelId?: Ulid;
}

export interface LeadStageChangedPayload {
  readonly leadId: Ulid;
  readonly previousStage: string;
  readonly stage: string;
  readonly reason?: string;
}

export interface LeadScoredPayload {
  readonly leadId: Ulid;
  readonly previousScore: number;
  readonly score: number;
  readonly grade: string;
  readonly modelId: Ulid;
}

export interface LeadConsentChangedPayload {
  readonly leadId: Ulid;
  readonly channel: "email" | "sms";
  readonly granted: boolean;
}

/**
 * Emitted when marketing hands a qualified lead to the Sales context.
 * The payload IS the integration contract — Sales builds an Opportunity
 * draft from it without calling back into Marketing.
 */
export interface LeadHandedOffPayload {
  readonly leadId: Ulid;
  readonly email: string;
  readonly fullName: string;
  readonly company?: string;
  readonly estimatedValue: Money;
  readonly sourceCampaignId?: Ulid;
  readonly attributionModel: string;
  readonly notes?: string;
}

export interface SendJobCompletedPayload {
  readonly sendJobId: Ulid;
  readonly campaignId: Ulid;
  readonly channelKind: "email" | "sms";
  readonly sent: number;
  readonly delivered: number;
  readonly bounced: number;
  readonly opened: number;
  readonly clicked: number;
  readonly unsubscribed: number;
}

export interface TouchpointRecordedPayload {
  readonly touchpointId: Ulid;
  readonly leadId: Ulid;
  readonly campaignId?: Ulid;
  readonly channelId?: Ulid;
  readonly touchType: string;
  readonly occurredAt: IsoDateTime;
}

export interface TrackedLinkClickedPayload {
  readonly linkId: Ulid;
  readonly shortCode: string;
  readonly leadId?: Ulid;
  readonly campaignId?: Ulid;
  readonly clickCount: number;
}

export interface SpendRecordedPayload {
  readonly budgetId: Ulid;
  readonly campaignId: Ulid;
  readonly channelId?: Ulid;
  readonly category: string;
  readonly amount: Money;
  readonly totalSpend: Money;
}

export interface BudgetThresholdBreachedPayload {
  readonly budgetId: Ulid;
  readonly campaignId: Ulid;
  readonly utilization: number;
  readonly threshold: number;
}
