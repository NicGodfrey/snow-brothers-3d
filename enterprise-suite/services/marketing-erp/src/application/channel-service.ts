import {
  ConflictError,
  money,
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import {
  assertChannelKind,
  assertCostModel,
  Channel,
} from "../domain/channel.js";
import type { ChannelRepository, OutboxPort } from "./ports.js";

export interface CreateChannelInput {
  name: string;
  code: string;
  kind: string;
  costModel: string;
  unitCostMinor: number;
  currency: string;
  description?: string;
}

export class ChannelService {
  constructor(
    private readonly channels: ChannelRepository,
    private readonly outbox: OutboxPort,
  ) {}

  create(ctx: TenantContext, input: CreateChannelInput): Channel {
    if (this.channels.findByCode(ctx.tenantId, input.code)) {
      throw new ConflictError(`Channel code already exists: ${input.code}`);
    }
    const channel = Channel.create({
      tenantId: ctx.tenantId,
      name: input.name,
      code: input.code,
      kind: assertChannelKind(input.kind),
      costModel: assertCostModel(input.costModel),
      unitCost: money(input.unitCostMinor, input.currency),
      description: input.description,
    });
    this.channels.save(channel);
    this.outbox.publish(channel.pullEvents());
    return channel;
  }

  get(ctx: TenantContext, id: string): Channel {
    return this.channels.getOrThrow(ctx.tenantId, id);
  }

  list(ctx: TenantContext, page?: Partial<PageRequest>, onlyActive = false): Page<Channel> {
    let items = this.channels.list(ctx.tenantId);
    if (onlyActive) items = items.filter((c) => c.active);
    items.sort((a, b) => a.code.localeCompare(b.code));
    return paginate(items, normalizePage(page));
  }

  changeCostModel(
    ctx: TenantContext,
    id: string,
    costModel: string,
    unitCostMinor: number,
    currency: string,
  ): Channel {
    const channel = this.channels.getOrThrow(ctx.tenantId, id);
    channel.changeCostModel(assertCostModel(costModel), money(unitCostMinor, currency));
    this.channels.save(channel);
    this.outbox.publish(channel.pullEvents());
    return channel;
  }

  deactivate(ctx: TenantContext, id: string): Channel {
    const channel = this.channels.getOrThrow(ctx.tenantId, id);
    channel.deactivate();
    this.channels.save(channel);
    this.outbox.publish(channel.pullEvents());
    return channel;
  }

  reactivate(ctx: TenantContext, id: string): Channel {
    const channel = this.channels.getOrThrow(ctx.tenantId, id);
    channel.reactivate();
    this.channels.save(channel);
    this.outbox.publish(channel.pullEvents());
    return channel;
  }
}
