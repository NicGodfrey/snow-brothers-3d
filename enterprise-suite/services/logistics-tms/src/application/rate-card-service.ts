import {
  DomainError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  RateCard,
  type Accessorial,
  type CreateRateCardInput,
  type RateBreak,
  type ZoneRule,
} from "../domain/rate-card.js";
import type { CarrierRepository, RateCardRepository } from "../infrastructure/repositories.js";
import type { OutboxPort } from "../infrastructure/outbox.js";

export class RateCardService {
  constructor(
    private readonly rateCards: RateCardRepository,
    private readonly carriers: CarrierRepository,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Creates a draft rate card. The carrier must exist and actually offer
   * the referenced service level — a rate card for an unknown service is
   * a configuration bug we want to catch at the boundary.
   */
  async createRateCard(ctx: TenantContext, input: CreateRateCardInput): Promise<RateCard> {
    const carrier = await this.carriers.findById(ctx.tenantId, input.carrierId);
    if (carrier === undefined) {
      throw new NotFoundError("Carrier", input.carrierId);
    }
    if (carrier.serviceLevel(input.serviceLevelCode) === undefined) {
      throw new DomainError(
        `Carrier ${carrier.code} does not offer service level '${input.serviceLevelCode}'`,
        "VALIDATION",
        422,
      );
    }
    const card = RateCard.create(ctx.tenantId, input);
    await this.rateCards.save(card);
    this.outbox.enqueue(card.pullEvents());
    return card;
  }

  async addZoneRule(ctx: TenantContext, rateCardId: Ulid, rule: ZoneRule): Promise<RateCard> {
    const card = await this.requireRateCard(ctx, rateCardId);
    card.addZoneRule(rule);
    await this.rateCards.save(card);
    this.outbox.enqueue(card.pullEvents());
    return card;
  }

  async addBreak(ctx: TenantContext, rateCardId: Ulid, rateBreak: RateBreak): Promise<RateCard> {
    const card = await this.requireRateCard(ctx, rateCardId);
    card.addBreak(rateBreak);
    await this.rateCards.save(card);
    this.outbox.enqueue(card.pullEvents());
    return card;
  }

  async upsertAccessorial(
    ctx: TenantContext,
    rateCardId: Ulid,
    accessorial: Accessorial,
  ): Promise<RateCard> {
    const card = await this.requireRateCard(ctx, rateCardId);
    card.upsertAccessorial(accessorial);
    await this.rateCards.save(card);
    this.outbox.enqueue(card.pullEvents());
    return card;
  }

  async setFuelSurcharge(ctx: TenantContext, rateCardId: Ulid, pct: number): Promise<RateCard> {
    const card = await this.requireRateCard(ctx, rateCardId);
    card.setFuelSurcharge(pct);
    await this.rateCards.save(card);
    this.outbox.enqueue(card.pullEvents());
    return card;
  }

  async publish(ctx: TenantContext, rateCardId: Ulid): Promise<RateCard> {
    const card = await this.requireRateCard(ctx, rateCardId);
    card.publish();
    await this.rateCards.save(card);
    this.outbox.enqueue(card.pullEvents());
    return card;
  }

  async archive(ctx: TenantContext, rateCardId: Ulid): Promise<RateCard> {
    const card = await this.requireRateCard(ctx, rateCardId);
    card.archive();
    await this.rateCards.save(card);
    this.outbox.enqueue(card.pullEvents());
    return card;
  }

  async getRateCard(ctx: TenantContext, rateCardId: Ulid): Promise<RateCard> {
    return this.requireRateCard(ctx, rateCardId);
  }

  async listByCarrier(ctx: TenantContext, carrierId: Ulid): Promise<RateCard[]> {
    return this.rateCards.listByCarrier(ctx.tenantId, carrierId);
  }

  private async requireRateCard(ctx: TenantContext, rateCardId: Ulid): Promise<RateCard> {
    const card = await this.rateCards.findById(ctx.tenantId, rateCardId);
    if (card === undefined) {
      throw new NotFoundError("RateCard", rateCardId);
    }
    return card;
  }
}
