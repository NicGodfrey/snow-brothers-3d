import {
  ConflictError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { Touchpoint } from "../domain/touchpoint.js";
import { normalizeUtm, TrackedLink } from "../domain/utm.js";
import type {
  CampaignRepository,
  ChannelRepository,
  Clock,
  LeadRepository,
  OutboxPort,
  TouchpointRepository,
  TrackedLinkRepository,
} from "./ports.js";

export interface CreateTrackedLinkInput {
  destinationUrl: string;
  utm: { source: string; medium: string; campaign: string; term?: string; content?: string };
  shortCode?: string;
  campaignId?: string;
  channelId?: string;
}

export interface ClickResult {
  readonly redirectTo: string;
  readonly clickCount: number;
  readonly touchpointRecorded: boolean;
}

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/O/1/l/i lookalikes

export class TrackedLinkService {
  constructor(
    private readonly links: TrackedLinkRepository,
    private readonly campaigns: CampaignRepository,
    private readonly channels: ChannelRepository,
    private readonly leads: LeadRepository,
    private readonly touchpoints: TouchpointRepository,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  private generateCode(ctx: TenantContext): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = "";
      for (let i = 0; i < 7; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.links.findByCode(ctx.tenantId, code)) return code;
    }
    throw new ConflictError("Could not generate a unique short code");
  }

  create(ctx: TenantContext, input: CreateTrackedLinkInput): TrackedLink {
    const utm = normalizeUtm(input.utm);
    const shortCode = input.shortCode ?? this.generateCode(ctx);
    if (this.links.findByCode(ctx.tenantId, shortCode)) {
      throw new ConflictError(`Short code already in use: ${shortCode}`);
    }
    // Prefer the explicit campaign; otherwise resolve from the UTM campaign code.
    const campaign = input.campaignId
      ? this.campaigns.getOrThrow(ctx.tenantId, input.campaignId)
      : this.campaigns.findByCode(ctx.tenantId, utm.campaign);
    const channel = input.channelId
      ? this.channels.getOrThrow(ctx.tenantId, input.channelId)
      : undefined;

    const link = TrackedLink.create({
      tenantId: ctx.tenantId,
      shortCode,
      destinationUrl: input.destinationUrl,
      utm,
      campaignId: campaign?.id,
      channelId: channel?.id,
    });
    this.links.save(link);
    this.outbox.publish(link.pullEvents());
    return link;
  }

  get(ctx: TenantContext, id: string): TrackedLink {
    return this.links.getOrThrow(ctx.tenantId, id);
  }

  getByCode(ctx: TenantContext, shortCode: string): TrackedLink | undefined {
    return this.links.findByCode(ctx.tenantId, shortCode);
  }

  list(ctx: TenantContext): TrackedLink[] {
    return this.links
      .list(ctx.tenantId)
      .sort((a, b) => a.shortCode.localeCompare(b.shortCode));
  }

  /**
   * Resolves a click on a short link. When the visitor is a known lead the
   * click becomes an attributable touchpoint on their journey.
   */
  click(ctx: TenantContext, shortCode: string, leadId?: string): ClickResult {
    const link = this.links.findByCode(ctx.tenantId, shortCode);
    if (!link) {
      throw new ConflictError(`Unknown tracked link: ${shortCode}`);
    }
    const now = this.clock.nowIso();
    const lead = leadId ? this.leads.getOrThrow(ctx.tenantId, leadId) : undefined;
    link.recordClick(now, lead?.id);

    let touchpointRecorded = false;
    if (lead) {
      this.touchpoints.append(
        Touchpoint.record({
          tenantId: ctx.tenantId,
          leadId: lead.id,
          touchType: "click",
          occurredAt: now,
          campaignId: link.campaignId as Ulid | undefined,
          channelId: link.channelId as Ulid | undefined,
          utm: link.utm,
          sourceRef: `link:${link.shortCode}`,
        }),
      );
      touchpointRecorded = true;
    }
    this.links.save(link);
    this.outbox.publish(link.pullEvents());
    return { redirectTo: link.trackingUrl, clickCount: link.clickCount, touchpointRecorded };
  }

  deactivate(ctx: TenantContext, id: string): TrackedLink {
    const link = this.links.getOrThrow(ctx.tenantId, id);
    link.deactivate();
    this.links.save(link);
    this.outbox.publish(link.pullEvents());
    return link;
  }
}
