import {
  DomainError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { Audience } from "../domain/audience.js";
import type {
  AudienceRepository,
  CampaignRepository,
  Clock,
  LeadRepository,
  OutboxPort,
  SegmentRepository,
} from "./ports.js";

export interface BuildAudienceInput {
  segmentId: string;
  channelKind: string;
  campaignId?: string;
}

export class AudienceService {
  constructor(
    private readonly audiences: AudienceRepository,
    private readonly segments: SegmentRepository,
    private readonly leads: LeadRepository,
    private readonly campaigns: CampaignRepository,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  build(ctx: TenantContext, input: BuildAudienceInput): Audience {
    if (input.channelKind !== "email" && input.channelKind !== "sms") {
      throw new DomainError(
        `Audience channelKind must be email or sms, got: ${input.channelKind}`,
        "AUDIENCE_INVALID_CHANNEL_KIND",
      );
    }
    const segment = this.segments.getOrThrow(ctx.tenantId, input.segmentId);
    const campaign = input.campaignId
      ? this.campaigns.getOrThrow(ctx.tenantId, input.campaignId)
      : undefined;
    const audience = Audience.build({
      tenantId: ctx.tenantId,
      segment,
      leads: this.leads.list(ctx.tenantId),
      channelKind: input.channelKind,
      campaignId: campaign?.id,
      builtAt: this.clock.nowIso(),
    });
    this.audiences.save(audience);
    this.outbox.publish(audience.pullEvents());
    return audience;
  }

  get(ctx: TenantContext, id: string): Audience {
    return this.audiences.getOrThrow(ctx.tenantId, id);
  }

  list(ctx: TenantContext): Audience[] {
    return this.audiences
      .list(ctx.tenantId)
      .sort((a, b) => (a.builtAt < b.builtAt ? 1 : -1));
  }
}
