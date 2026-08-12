import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  MarketingEvents,
  type CampaignChannelPayload,
  type CampaignCreatedPayload,
  type CampaignStatusPayload,
} from "./events.js";
import type { UtmParams } from "./utm.js";

export const CAMPAIGN_OBJECTIVES = [
  "awareness",
  "acquisition",
  "activation",
  "retention",
  "upsell",
  "winback",
] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "paused",
  "completed",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Legal state machine transitions. Everything else is a conflict. */
const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["scheduled", "active", "archived"],
  scheduled: ["active", "draft", "archived"],
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: ["archived"],
  archived: [],
};

export interface CampaignProps {
  name: string;
  /** Stable machine code; also used as the utm_campaign value by convention. */
  code: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  startsAt?: IsoDateTime;
  endsAt?: IsoDateTime;
  channelIds: Ulid[];
  segmentIds: Ulid[];
  utmDefaults?: UtmParams;
  description?: string;
  ownerUserId?: string;
}

const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

export function assertCampaignObjective(value: string): CampaignObjective {
  if (!(CAMPAIGN_OBJECTIVES as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown campaign objective: ${value}`, "CAMPAIGN_INVALID_OBJECTIVE");
  }
  return value as CampaignObjective;
}

export class Campaign extends AggregateRoot<CampaignProps> {
  private constructor(tenantId: TenantId, props: CampaignProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    name: string;
    code: string;
    objective: CampaignObjective;
    startsAt?: IsoDateTime;
    endsAt?: IsoDateTime;
    utmDefaults?: UtmParams;
    description?: string;
    ownerUserId?: string;
  }): Campaign {
    if (input.name.trim().length < 3) {
      throw new DomainError("Campaign name must be at least 3 characters", "CAMPAIGN_INVALID_NAME");
    }
    if (!CODE_PATTERN.test(input.code)) {
      throw new DomainError(
        `Campaign code must match ${CODE_PATTERN}: ${input.code}`,
        "CAMPAIGN_INVALID_CODE",
      );
    }
    if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
      throw new DomainError("Campaign endsAt must be after startsAt", "CAMPAIGN_INVALID_WINDOW");
    }
    const campaign = new Campaign(input.tenantId, {
      name: input.name.trim(),
      code: input.code,
      objective: input.objective,
      status: "draft",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      channelIds: [],
      segmentIds: [],
      utmDefaults: input.utmDefaults,
      description: input.description,
      ownerUserId: input.ownerUserId,
    });
    campaign.raise(
      envelope<CampaignCreatedPayload>({
        eventType: MarketingEvents.CampaignCreated,
        aggregateType: "Campaign",
        aggregateId: campaign.id,
        tenantId: campaign.tenantId,
        payload: {
          campaignId: campaign.id,
          code: input.code,
          name: input.name.trim(),
          objective: input.objective,
        },
      }),
    );
    return campaign;
  }

  get name(): string {
    return this.props.name;
  }

  get code(): string {
    return this.props.code;
  }

  get objective(): CampaignObjective {
    return this.props.objective;
  }

  get status(): CampaignStatus {
    return this.props.status;
  }

  get startsAt(): IsoDateTime | undefined {
    return this.props.startsAt;
  }

  get endsAt(): IsoDateTime | undefined {
    return this.props.endsAt;
  }

  get channelIds(): readonly Ulid[] {
    return this.props.channelIds;
  }

  get segmentIds(): readonly Ulid[] {
    return this.props.segmentIds;
  }

  get utmDefaults(): UtmParams | undefined {
    return this.props.utmDefaults;
  }

  get isRunnable(): boolean {
    return this.props.status === "active";
  }

  private transitionTo(
    next: CampaignStatus,
    eventType: string,
    guard?: () => void,
  ): void {
    const current = this.props.status;
    if (!TRANSITIONS[current].includes(next)) {
      throw new ConflictError(
        `Campaign ${this.props.code} cannot transition ${current} -> ${next}`,
      );
    }
    guard?.();
    this.props.status = next;
    this.raise(
      envelope<CampaignStatusPayload>({
        eventType,
        aggregateType: "Campaign",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { campaignId: this.id, previousStatus: current, status: next },
      }),
    );
  }

  schedule(startsAt: IsoDateTime, endsAt?: IsoDateTime): void {
    if (endsAt && startsAt >= endsAt) {
      throw new DomainError("Campaign endsAt must be after startsAt", "CAMPAIGN_INVALID_WINDOW");
    }
    this.transitionTo("scheduled", MarketingEvents.CampaignScheduled, () => {
      this.props.startsAt = startsAt;
      if (endsAt) this.props.endsAt = endsAt;
    });
  }

  activate(): void {
    const eventType =
      this.props.status === "paused"
        ? MarketingEvents.CampaignResumed
        : MarketingEvents.CampaignActivated;
    this.transitionTo("active", eventType, () => {
      if (this.props.channelIds.length === 0) {
        throw new DomainError(
          "Campaign needs at least one channel before activation",
          "CAMPAIGN_NO_CHANNELS",
          422,
        );
      }
    });
  }

  pause(): void {
    this.transitionTo("paused", MarketingEvents.CampaignPaused);
  }

  complete(): void {
    this.transitionTo("completed", MarketingEvents.CampaignCompleted);
  }

  archive(): void {
    this.transitionTo("archived", MarketingEvents.CampaignArchived);
  }

  attachChannel(channelId: Ulid): void {
    if (this.props.status === "completed" || this.props.status === "archived") {
      throw new ConflictError("Cannot modify channels on a finished campaign");
    }
    if (this.props.channelIds.includes(channelId)) {
      throw new ConflictError(`Channel already attached: ${channelId}`);
    }
    this.props.channelIds.push(channelId);
    this.raise(
      envelope<CampaignChannelPayload>({
        eventType: MarketingEvents.CampaignChannelAttached,
        aggregateType: "Campaign",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { campaignId: this.id, channelId },
      }),
    );
  }

  detachChannel(channelId: Ulid): void {
    const idx = this.props.channelIds.indexOf(channelId);
    if (idx === -1) {
      throw new ConflictError(`Channel not attached: ${channelId}`);
    }
    if (this.props.status === "active" && this.props.channelIds.length === 1) {
      throw new ConflictError("An active campaign must keep at least one channel");
    }
    this.props.channelIds.splice(idx, 1);
    this.raise(
      envelope<CampaignChannelPayload>({
        eventType: MarketingEvents.CampaignChannelDetached,
        aggregateType: "Campaign",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { campaignId: this.id, channelId },
      }),
    );
  }

  attachSegment(segmentId: Ulid): void {
    if (!this.props.segmentIds.includes(segmentId)) {
      this.props.segmentIds.push(segmentId);
      this.touch();
    }
  }

  setUtmDefaults(utm: UtmParams): void {
    this.props.utmDefaults = utm;
    this.touch();
  }

  /** Whether the campaign window covers the given instant (undefined bounds are open). */
  coversInstant(at: IsoDateTime): boolean {
    if (this.props.startsAt && at < this.props.startsAt) return false;
    if (this.props.endsAt && at > this.props.endsAt) return false;
    return true;
  }
}
