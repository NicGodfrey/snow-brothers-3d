import {
  brand,
  ConflictError,
  DomainError,
  normalizePage,
  paginate,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import {
  assertCampaignObjective,
  Campaign,
  CAMPAIGN_STATUSES,
  type CampaignStatus,
} from "../domain/campaign.js";
import { normalizeUtm } from "../domain/utm.js";
import type { CampaignRepository, ChannelRepository, OutboxPort } from "./ports.js";

export interface CreateCampaignInput {
  name: string;
  code: string;
  objective: string;
  startsAt?: string;
  endsAt?: string;
  description?: string;
  ownerUserId?: string;
  utmDefaults?: { source: string; medium: string; term?: string; content?: string };
}

function toIso(value: string | undefined, field: string): IsoDateTime | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new DomainError(`${field} is not a valid ISO date-time: ${value}`, "INVALID_DATE");
  }
  return brand<string, "IsoDateTime">(new Date(ms).toISOString());
}

export class CampaignService {
  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly channels: ChannelRepository,
    private readonly outbox: OutboxPort,
  ) {}

  private persist(campaign: Campaign): Campaign {
    this.campaigns.save(campaign);
    this.outbox.publish(campaign.pullEvents());
    return campaign;
  }

  create(ctx: TenantContext, input: CreateCampaignInput): Campaign {
    if (this.campaigns.findByCode(ctx.tenantId, input.code)) {
      throw new ConflictError(`Campaign code already exists: ${input.code}`);
    }
    const campaign = Campaign.create({
      tenantId: ctx.tenantId,
      name: input.name,
      code: input.code,
      objective: assertCampaignObjective(input.objective),
      startsAt: toIso(input.startsAt, "startsAt"),
      endsAt: toIso(input.endsAt, "endsAt"),
      description: input.description,
      ownerUserId: input.ownerUserId ?? ctx.userId,
      // Convention: the campaign code IS the utm_campaign value.
      utmDefaults: input.utmDefaults
        ? normalizeUtm({ ...input.utmDefaults, campaign: input.code })
        : undefined,
    });
    return this.persist(campaign);
  }

  get(ctx: TenantContext, id: string): Campaign {
    return this.campaigns.getOrThrow(ctx.tenantId, id);
  }

  getByCode(ctx: TenantContext, code: string): Campaign | undefined {
    return this.campaigns.findByCode(ctx.tenantId, code);
  }

  list(
    ctx: TenantContext,
    filter?: { status?: string },
    page?: Partial<PageRequest>,
  ): Page<Campaign> {
    let items = this.campaigns.list(ctx.tenantId);
    if (filter?.status !== undefined) {
      if (!(CAMPAIGN_STATUSES as readonly string[]).includes(filter.status)) {
        throw new DomainError(`Unknown campaign status: ${filter.status}`, "CAMPAIGN_INVALID_STATUS");
      }
      items = items.filter((c) => c.status === (filter.status as CampaignStatus));
    }
    items.sort((a, b) => a.code.localeCompare(b.code));
    return paginate(items, normalizePage(page));
  }

  schedule(ctx: TenantContext, id: string, startsAt: string, endsAt?: string): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, id);
    campaign.schedule(toIso(startsAt, "startsAt")!, toIso(endsAt, "endsAt"));
    return this.persist(campaign);
  }

  activate(ctx: TenantContext, id: string): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, id);
    campaign.activate();
    return this.persist(campaign);
  }

  pause(ctx: TenantContext, id: string): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, id);
    campaign.pause();
    return this.persist(campaign);
  }

  complete(ctx: TenantContext, id: string): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, id);
    campaign.complete();
    return this.persist(campaign);
  }

  archive(ctx: TenantContext, id: string): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, id);
    campaign.archive();
    return this.persist(campaign);
  }

  attachChannel(ctx: TenantContext, campaignId: string, channelId: string): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, campaignId);
    const channel = this.channels.getOrThrow(ctx.tenantId, channelId);
    if (!channel.active) {
      throw new ConflictError(`Cannot attach deactivated channel: ${channel.code}`);
    }
    campaign.attachChannel(channel.id);
    return this.persist(campaign);
  }

  detachChannel(ctx: TenantContext, campaignId: string, channelId: string): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, campaignId);
    const channel = this.channels.getOrThrow(ctx.tenantId, channelId);
    campaign.detachChannel(channel.id);
    return this.persist(campaign);
  }

  setUtmDefaults(
    ctx: TenantContext,
    campaignId: string,
    utm: { source: string; medium: string; term?: string; content?: string },
  ): Campaign {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, campaignId);
    campaign.setUtmDefaults(normalizeUtm({ ...utm, campaign: campaign.code }));
    return this.persist(campaign);
  }
}
