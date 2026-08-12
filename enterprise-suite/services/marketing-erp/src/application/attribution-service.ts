import type { TenantContext, Ulid } from "@enterprise-suite/shared-kernel";
import {
  assertAttributionModel,
  ATTRIBUTION_MODELS,
  computeAttributionReport,
  type AttributionModel,
  type AttributionReport,
  type ConversionInput,
} from "../domain/attribution.js";
import type { LeadRepository, TouchpointRepository } from "./ports.js";

export interface CampaignPerformance {
  readonly campaignId: Ulid;
  readonly model: AttributionModel;
  readonly currency: string;
  readonly attributedRevenueMinor: number;
  /** Distinct leads with at least one touchpoint in the campaign. */
  readonly touchedLeads: number;
  /** Of those, leads that converted (opportunity or customer). */
  readonly convertedLeads: number;
}

export class AttributionService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly touchpoints: TouchpointRepository,
  ) {}

  /** Conversion inputs: every converted lead paired with its ordered journey. */
  private conversions(ctx: TenantContext): ConversionInput[] {
    return this.leads
      .list(ctx.tenantId)
      .filter((lead) => lead.isConverted && lead.conversionValue !== undefined)
      .map((lead) => ({
        leadId: lead.id,
        value: lead.conversionValue!,
        touchpoints: this.touchpoints.listByLead(ctx.tenantId, lead.id),
      }));
  }

  report(ctx: TenantContext, model: string): AttributionReport {
    return computeAttributionReport(assertAttributionModel(model), this.conversions(ctx));
  }

  /** Side-by-side sample computation across every supported model. */
  compareModels(ctx: TenantContext): Record<AttributionModel, AttributionReport> {
    const conversions = this.conversions(ctx);
    const entries = ATTRIBUTION_MODELS.map(
      (model) => [model, computeAttributionReport(model, conversions)] as const,
    );
    return Object.fromEntries(entries) as Record<AttributionModel, AttributionReport>;
  }

  /** Metrics for one campaign, used by budget/ROI rollups. */
  campaignPerformance(ctx: TenantContext, campaignId: Ulid, model: string): CampaignPerformance {
    const parsedModel = assertAttributionModel(model);
    const report = computeAttributionReport(parsedModel, this.conversions(ctx));
    const bucket = report.byCampaign.find((b) => b.key === campaignId);

    const campaignTouches = this.touchpoints.listByCampaign(ctx.tenantId, campaignId);
    const touchedLeadIds = new Set(campaignTouches.map((tp) => tp.leadId));
    let convertedLeads = 0;
    for (const leadId of touchedLeadIds) {
      const lead = this.leads.findById(ctx.tenantId, leadId);
      if (lead?.isConverted) convertedLeads += 1;
    }

    return {
      campaignId,
      model: parsedModel,
      currency: report.currency,
      attributedRevenueMinor: bucket?.creditedMinor ?? 0,
      touchedLeads: touchedLeadIds.size,
      convertedLeads,
    };
  }
}
