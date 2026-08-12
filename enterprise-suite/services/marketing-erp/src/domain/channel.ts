import {
  AggregateRoot,
  DomainError,
  envelope,
  type EntityProps,
  type Money,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MarketingEvents } from "./events.js";

export const CHANNEL_KINDS = [
  "email",
  "sms",
  "paid_search",
  "paid_social",
  "organic_social",
  "display",
  "affiliate",
  "event",
  "webinar",
  "referral",
  "direct_mail",
] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * How spend on this channel is priced:
 * - cpc: cost per click
 * - cpm: cost per thousand impressions
 * - cpa: cost per acquisition/conversion
 * - flat: fixed fee per period (sponsorships, events)
 */
export const COST_MODELS = ["cpc", "cpm", "cpa", "flat"] as const;
export type CostModel = (typeof COST_MODELS)[number];

export interface ChannelProps {
  name: string;
  /** Stable machine code used in UTM medium mapping and reports. */
  code: string;
  kind: ChannelKind;
  costModel: CostModel;
  /** Unit cost under the cost model (per click, per mille, per acquisition, or per period). */
  unitCost: Money;
  active: boolean;
  description?: string;
}

const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

export function assertChannelKind(value: string): ChannelKind {
  if (!(CHANNEL_KINDS as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown channel kind: ${value}`, "CHANNEL_INVALID_KIND");
  }
  return value as ChannelKind;
}

export function assertCostModel(value: string): CostModel {
  if (!(COST_MODELS as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown cost model: ${value}`, "CHANNEL_INVALID_COST_MODEL");
  }
  return value as CostModel;
}

export class Channel extends AggregateRoot<ChannelProps> {
  private constructor(tenantId: TenantId, props: ChannelProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    name: string;
    code: string;
    kind: ChannelKind;
    costModel: CostModel;
    unitCost: Money;
    description?: string;
  }): Channel {
    if (input.name.trim().length < 2) {
      throw new DomainError("Channel name must be at least 2 characters", "CHANNEL_INVALID_NAME");
    }
    if (!CODE_PATTERN.test(input.code)) {
      throw new DomainError(
        `Channel code must match ${CODE_PATTERN}: ${input.code}`,
        "CHANNEL_INVALID_CODE",
      );
    }
    if (input.unitCost.amountMinor < 0) {
      throw new DomainError("Unit cost cannot be negative", "CHANNEL_INVALID_COST");
    }
    const channel = new Channel(input.tenantId, {
      name: input.name.trim(),
      code: input.code,
      kind: input.kind,
      costModel: input.costModel,
      unitCost: input.unitCost,
      active: true,
      description: input.description,
    });
    channel.raise(
      envelope({
        eventType: MarketingEvents.ChannelCreated,
        aggregateType: "Channel",
        aggregateId: channel.id,
        tenantId: channel.tenantId,
        payload: { channelId: channel.id, code: input.code, kind: input.kind },
      }),
    );
    return channel;
  }

  get name(): string {
    return this.props.name;
  }

  get code(): string {
    return this.props.code;
  }

  get kind(): ChannelKind {
    return this.props.kind;
  }

  get costModel(): CostModel {
    return this.props.costModel;
  }

  get unitCost(): Money {
    return this.props.unitCost;
  }

  get active(): boolean {
    return this.props.active;
  }

  /** True for channels that deliver a message directly to a person. */
  get isMessagingChannel(): boolean {
    return this.props.kind === "email" || this.props.kind === "sms";
  }

  rename(name: string): void {
    if (name.trim().length < 2) {
      throw new DomainError("Channel name must be at least 2 characters", "CHANNEL_INVALID_NAME");
    }
    this.props.name = name.trim();
    this.touch();
  }

  changeCostModel(costModel: CostModel, unitCost: Money): void {
    if (unitCost.amountMinor < 0) {
      throw new DomainError("Unit cost cannot be negative", "CHANNEL_INVALID_COST");
    }
    this.props.costModel = costModel;
    this.props.unitCost = unitCost;
    this.raise(
      envelope({
        eventType: MarketingEvents.ChannelCostModelChanged,
        aggregateType: "Channel",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { channelId: this.id, costModel, unitCost },
      }),
    );
  }

  deactivate(): void {
    if (!this.props.active) {
      throw new DomainError("Channel already deactivated", "CHANNEL_ALREADY_INACTIVE", 409);
    }
    this.props.active = false;
    this.raise(
      envelope({
        eventType: MarketingEvents.ChannelDeactivated,
        aggregateType: "Channel",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { channelId: this.id },
      }),
    );
  }

  reactivate(): void {
    if (this.props.active) {
      throw new DomainError("Channel already active", "CHANNEL_ALREADY_ACTIVE", 409);
    }
    this.props.active = true;
    this.raise(
      envelope({
        eventType: MarketingEvents.ChannelReactivated,
        aggregateType: "Channel",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { channelId: this.id },
      }),
    );
  }
}
