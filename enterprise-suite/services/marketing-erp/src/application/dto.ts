import type { AttributionModel } from "../domain/attribution.js";
import type { LeadGrade, LeadSource, LeadStage } from "../domain/lead.js";

/**
 * Cross-context data transfer objects for the Marketing → Sales handoff.
 *
 * These are deliberately free of shared-kernel branded types and aggregate
 * references: they are serialized onto the bus / HTTP boundary and consumed
 * by the Sales context, which must not import Marketing domain classes.
 */

export interface MoneyDto {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface HandoffContactDto {
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly fullName: string;
  readonly phone?: string;
  readonly country?: string;
}

export interface HandoffCompanyDto {
  readonly name: string;
  readonly industry?: string;
  readonly size?: number;
}

export interface HandoffQualificationDto {
  readonly score: number;
  readonly grade: LeadGrade;
  readonly stageAtHandoff: LeadStage;
  readonly source: LeadSource;
  readonly tags: readonly string[];
}

/** Per-campaign share of the handoff's estimated value under the chosen model. */
export interface HandoffAttributionSliceDto {
  readonly campaignId?: string;
  readonly campaignCode?: string;
  readonly channelId?: string;
  readonly weight: number;
  readonly credited: MoneyDto;
}

export interface HandoffAttributionDto {
  readonly model: AttributionModel;
  readonly touchpointCount: number;
  readonly firstTouchAt?: string;
  readonly lastTouchAt?: string;
  readonly slices: readonly HandoffAttributionSliceDto[];
}

/**
 * The contract handed to Sales when marketing qualifies a lead into an
 * opportunity. Sales creates an Opportunity draft from this DTO alone.
 */
export interface LeadOpportunityHandoffDto {
  readonly kind: "marketing.lead-opportunity-handoff";
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly leadId: string;
  readonly contact: HandoffContactDto;
  readonly company?: HandoffCompanyDto;
  readonly qualification: HandoffQualificationDto;
  readonly estimatedValue: MoneyDto;
  readonly attribution: HandoffAttributionDto;
  readonly sourceCampaign?: { readonly campaignId: string; readonly code: string; readonly name: string };
  readonly suggestedOwnerUserId?: string;
  readonly notes?: string;
  readonly handedOffAt: string;
}

/** What Sales reports back once the opportunity exists (or was refused). */
export interface HandoffAcknowledgementDto {
  readonly kind: "sales.handoff-acknowledgement";
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly leadId: string;
  readonly accepted: boolean;
  readonly opportunityId?: string;
  readonly rejectionReason?: string;
  readonly acknowledgedAt: string;
}

// ---------------------------------------------------------------------------
// Read-model DTOs served over HTTP.
// ---------------------------------------------------------------------------

export interface CampaignRoiDto {
  readonly campaignId: string;
  readonly campaignCode: string;
  readonly model: AttributionModel;
  readonly currency: string;
  readonly budgetTotalMinor: number;
  readonly spendMinor: number;
  readonly remainingMinor: number;
  readonly utilization: number;
  readonly attributedRevenueMinor: number;
  readonly leads: number;
  readonly conversions: number;
  readonly roi: number | null;
  readonly roas: number | null;
  readonly costPerLeadMinor: number | null;
  readonly costPerAcquisitionMinor: number | null;
  readonly conversionRate: number | null;
}

export interface PortfolioRoiDto {
  readonly model: AttributionModel;
  readonly currency: string;
  readonly campaigns: readonly CampaignRoiDto[];
  readonly totals: {
    readonly spendMinor: number;
    readonly attributedRevenueMinor: number;
    readonly roi: number | null;
    readonly roas: number | null;
  };
}

export interface FunnelSnapshotDto {
  readonly countsByStage: Readonly<Record<LeadStage, number>>;
  readonly totalActive: number;
  readonly mqlRate: number | null;
  readonly sqlRate: number | null;
  readonly winRate: number | null;
}
