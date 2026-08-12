import {
  DomainError,
  envelope,
  money,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import {
  allocateCredit,
  assertAttributionModel,
  type AttributionModel,
} from "../domain/attribution.js";
import { MarketingEvents, type LeadHandedOffPayload } from "../domain/events.js";
import type { Lead } from "../domain/lead.js";
import type {
  HandoffAcknowledgementDto,
  HandoffAttributionDto,
  HandoffAttributionSliceDto,
  LeadOpportunityHandoffDto,
} from "./dto.js";
import type {
  CampaignRepository,
  Clock,
  LeadRepository,
  OutboxPort,
  TouchpointRepository,
} from "./ports.js";

export interface HandoffInput {
  estimatedValueMinor: number;
  currency: string;
  attributionModel?: string;
  notes?: string;
  suggestedOwnerUserId?: string;
}

/**
 * Orchestrates the Marketing → Sales boundary: qualifies the domain-level
 * handoff, assembles the cross-context DTO, and emits the integration event.
 */
export class HandoffService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly touchpoints: TouchpointRepository,
    private readonly campaigns: CampaignRepository,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  handOff(ctx: TenantContext, leadId: string, input: HandoffInput): LeadOpportunityHandoffDto {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    const model = assertAttributionModel(input.attributionModel ?? "linear");
    const estimatedValue = money(input.estimatedValueMinor, input.currency);
    const handedOffAt = this.clock.nowIso();
    const stageAtHandoff = lead.stage;

    // Domain guard: only SQL leads convert, value must be positive.
    lead.handOff(estimatedValue, handedOffAt);

    const journey = this.touchpoints
      .listByLead(ctx.tenantId, lead.id)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));

    const attribution = this.buildAttribution(ctx, model, lead, journey);
    const sourceCampaign = this.resolveSourceCampaign(ctx, lead, journey);

    const dto: LeadOpportunityHandoffDto = {
      kind: "marketing.lead-opportunity-handoff",
      schemaVersion: 1,
      tenantId: ctx.tenantId,
      leadId: lead.id,
      contact: {
        email: lead.email,
        firstName: lead.view().firstName,
        lastName: lead.view().lastName,
        fullName: lead.fullName,
        phone: lead.view().phone,
        country: lead.view().country,
      },
      company: lead.company
        ? {
            name: lead.company,
            industry: lead.view().industry,
            size: lead.view().companySize,
          }
        : undefined,
      qualification: {
        score: lead.score,
        grade: lead.grade,
        stageAtHandoff,
        source: lead.source,
        tags: [...lead.tags],
      },
      estimatedValue: { amountMinor: estimatedValue.amountMinor, currency: estimatedValue.currency },
      attribution,
      sourceCampaign,
      suggestedOwnerUserId: input.suggestedOwnerUserId,
      notes: input.notes,
      handedOffAt,
    };

    this.leads.save(lead);
    this.outbox.publish(lead.pullEvents());
    this.outbox.publish([
      envelope<LeadHandedOffPayload>({
        eventType: MarketingEvents.LeadHandedOff,
        aggregateType: "Lead",
        aggregateId: lead.id,
        tenantId: ctx.tenantId,
        payload: {
          leadId: lead.id,
          email: lead.email,
          fullName: lead.fullName,
          company: lead.company,
          estimatedValue,
          sourceCampaignId: sourceCampaign
            ? (sourceCampaign.campaignId as LeadHandedOffPayload["sourceCampaignId"])
            : undefined,
          attributionModel: model,
          notes: input.notes,
        },
      }),
    ]);
    return dto;
  }

  /** Sales reports the outcome of the handoff; marketing keeps the audit trail. */
  acknowledge(ctx: TenantContext, ack: HandoffAcknowledgementDto): Lead {
    if (ack.kind !== "sales.handoff-acknowledgement") {
      throw new DomainError("Not a handoff acknowledgement payload", "HANDOFF_INVALID_ACK");
    }
    const lead = this.leads.getOrThrow(ctx.tenantId, ack.leadId);
    if (!lead.isConverted) {
      throw new DomainError(
        `Lead ${ack.leadId} has no outstanding handoff (stage: ${lead.stage})`,
        "HANDOFF_NOT_PENDING",
        409,
      );
    }
    lead.addTag(ack.accepted ? "handoff-accepted" : "handoff-rejected");
    this.leads.save(lead);
    this.outbox.publish(lead.pullEvents());
    return lead;
  }

  /** Close the loop when Sales wins the deal; actual value replaces the estimate. */
  recordDealWon(ctx: TenantContext, leadId: string, actualValueMinor: number, currency: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.markCustomer(money(actualValueMinor, currency), this.clock.nowIso());
    this.leads.save(lead);
    this.outbox.publish(lead.pullEvents());
    return lead;
  }

  private buildAttribution(
    ctx: TenantContext,
    model: AttributionModel,
    lead: Lead,
    journey: ReturnType<TouchpointRepository["listByLead"]>,
  ): HandoffAttributionDto {
    if (journey.length === 0 || !lead.conversionValue) {
      return { model, touchpointCount: 0, slices: [] };
    }
    const allocations = allocateCredit(model, journey, lead.conversionValue);

    // Collapse per-touchpoint credit into per-(campaign, channel) slices.
    const grouped = new Map<string, HandoffAttributionSliceDto>();
    for (const allocation of allocations) {
      const key = `${allocation.campaignId ?? "-"}|${allocation.channelId ?? "-"}`;
      const existing = grouped.get(key);
      if (existing) {
        grouped.set(key, {
          ...existing,
          weight: existing.weight + allocation.weight,
          credited: {
            amountMinor: existing.credited.amountMinor + allocation.credited.amountMinor,
            currency: existing.credited.currency,
          },
        });
      } else {
        const campaign = allocation.campaignId
          ? this.campaigns.findById(ctx.tenantId, allocation.campaignId)
          : undefined;
        grouped.set(key, {
          campaignId: allocation.campaignId,
          campaignCode: campaign?.code,
          channelId: allocation.channelId,
          weight: allocation.weight,
          credited: {
            amountMinor: allocation.credited.amountMinor,
            currency: allocation.credited.currency,
          },
        });
      }
    }
    return {
      model,
      touchpointCount: journey.length,
      firstTouchAt: journey[0]!.occurredAt,
      lastTouchAt: journey[journey.length - 1]!.occurredAt,
      slices: [...grouped.values()].sort((a, b) => b.credited.amountMinor - a.credited.amountMinor),
    };
  }

  private resolveSourceCampaign(
    ctx: TenantContext,
    lead: Lead,
    journey: ReturnType<TouchpointRepository["listByLead"]>,
  ): LeadOpportunityHandoffDto["sourceCampaign"] {
    // First-touch campaign wins as "source"; fall back to the captured UTM.
    const firstWithCampaign = journey.find((tp) => tp.campaignId !== undefined);
    const campaign = firstWithCampaign?.campaignId
      ? this.campaigns.findById(ctx.tenantId, firstWithCampaign.campaignId)
      : lead.capturedUtm
        ? this.campaigns.findByCode(ctx.tenantId, lead.capturedUtm.campaign)
        : undefined;
    return campaign
      ? { campaignId: campaign.id, code: campaign.code, name: campaign.name }
      : undefined;
  }
}
