import {
  ConflictError,
  NotFoundError,
  normalizePage,
  money,
  type IsoDateTime,
  type Money,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { ExternalRef } from "../domain/channel-quote.js";
import { ChannelOrder, type OrderSourceType } from "../domain/channel-order.js";
import type { DealRegistration } from "../domain/deal-registration.js";
import { PolicyViolationError, ValidationError } from "../domain/errors.js";
import { sumMoney, zeroMoney } from "../domain/money-math.js";
import { formatNumber } from "../domain/numbering.js";
import type { PartnerService } from "./partner-service.js";
import type {
  ChannelOrderFilter,
  ChannelOrderRepository,
  ChannelQuoteRepository,
  Clock,
  OutboxPort,
  RegistrationRepository,
  SequencePort,
} from "./ports.js";
import { Publisher } from "./unit-of-work.js";

export interface PlaceOrderCommand {
  readonly partnerId: Ulid;
  readonly channelQuoteId?: Ulid;
  readonly registrationId?: Ulid;
  readonly salesOrderRef: ExternalRef;
  /** Defaults to the approved quote total when a quote is referenced. */
  readonly netValue?: Money;
  readonly listValue?: Money;
  readonly sourceType?: OrderSourceType;
  readonly customerKey?: string;
  readonly customerName?: string;
  readonly poNumber?: string;
  readonly orderedAt?: IsoDateTime;
  /** Close the linked registration as won. Defaults to true. */
  readonly closeRegistration?: boolean;
}

export interface PartnerAttainment {
  readonly partnerId: Ulid;
  readonly currency: string;
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly bookedValue: Money;
  readonly orderCount: number;
  readonly registeredValue: Money;
  readonly unregisteredValue: Money;
  /** Share of booked value that came through a deal registration, in bps. */
  readonly registeredShareBps: number;
}

/**
 * Channel orders: the bridge between a channel deal and the sales order that
 * actually books revenue.
 *
 * Placing an order is the moment the channel's paperwork has to agree with
 * reality — the quote is consumed, the registration is closed won, and the
 * partner's attainment moves. Each of those has to happen exactly once, so
 * the sales order reference is unique per tenant and the whole sequence is
 * published as one batch.
 */
export class OrderService {
  private readonly publisher: Publisher;

  constructor(
    private readonly orders: ChannelOrderRepository,
    private readonly quotes: ChannelQuoteRepository,
    private readonly registrations: RegistrationRepository,
    private readonly partnerService: PartnerService,
    private readonly sequences: SequencePort,
    outbox: OutboxPort,
    private readonly clock: Clock,
  ) {
    this.publisher = new Publisher(outbox);
  }

  async place(ctx: TenantContext, command: PlaceOrderCommand): Promise<ChannelOrder> {
    const partner = await this.partnerService.get(ctx, command.partnerId);
    partner.assertActive("place channel orders");
    if (!partner.canTransact) {
      throw new PolicyViolationError(
        `Partner ${partner.code} is a referral agent and cannot transact`,
        "partner.type",
        { type: partner.type },
      );
    }
    const duplicate = await this.orders.bySalesOrderRef(ctx.tenantId, command.salesOrderRef.id);
    if (duplicate) {
      throw new ConflictError(
        `Sales order ${command.salesOrderRef.id} is already recorded as channel order ${duplicate.number}`,
      );
    }

    const at = command.orderedAt ?? this.clock.now();
    const quote = command.channelQuoteId ? await this.quotes.byId(ctx.tenantId, command.channelQuoteId) : undefined;
    if (command.channelQuoteId && !quote) throw new NotFoundError("ChannelQuote", command.channelQuoteId);
    if (quote && quote.partnerId !== partner.id) {
      throw new PolicyViolationError(`Quote ${quote.number} belongs to another partner`, "order.quoteOwner");
    }

    const registrationId = command.registrationId ?? quote?.registrationId;
    const registration = registrationId ? await this.loadRegistration(ctx, registrationId) : undefined;
    if (registration && registration.partnerId !== partner.id) {
      throw new PolicyViolationError(
        `Registration ${registration.number} belongs to another partner`,
        "order.registrationOwner",
      );
    }

    const netValue = command.netValue ?? quote?.approvedTotal();
    if (!netValue) {
      throw ValidationError.single("netValue", "a net value is required when no approved quote is referenced");
    }
    if (netValue.currency !== partner.currency) {
      throw new PolicyViolationError(
        `Order value must be in ${partner.currency}, the partner's transaction currency`,
        "partner.currency",
        { expected: partner.currency, actual: netValue.currency },
      );
    }
    const customerKey = command.customerKey ?? quote?.customerKey ?? registration?.customerKey;
    const customerName = command.customerName ?? quote?.customerName ?? registration?.endCustomer.name;
    if (!customerKey || !customerName) {
      throw ValidationError.single("customerKey", "a customer key and name are required");
    }

    const order = ChannelOrder.place(ctx.tenantId, {
      number: formatNumber("channelOrder", await this.sequences.next(ctx.tenantId, "channelOrder")),
      partnerId: partner.id,
      registrationId: registration?.id,
      channelQuoteId: quote?.id,
      customerKey,
      customerName,
      salesOrderRef: command.salesOrderRef,
      netValue,
      listValue: command.listValue ?? quote?.listTotal(),
      sourceType: command.sourceType ?? (registration ? "partner_sourced" : "vendor_sourced"),
      orderedAt: at,
      poNumber: command.poNumber,
    });

    if (quote) quote.markOrdered(order.id, at);
    if (registration) {
      registration.linkOrder({ id: order.id, number: order.number, linkedAt: at, value: netValue });
      if ((command.closeRegistration ?? true) && registration.status === "approved") {
        const bookedSoFar = await this.bookedForRegistration(ctx, registration.id, netValue.currency);
        registration.markWon({
          by: ctx.userId,
          at,
          value: money(bookedSoFar.amountMinor + netValue.amountMinor, netValue.currency),
          reason: `Closed by channel order ${order.number}`,
        });
      }
    }

    await this.orders.save(order);
    if (quote) await this.quotes.save(quote);
    if (registration) await this.registrations.save(registration);
    await this.publisher.publish(order, quote, registration);
    return order;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<ChannelOrder> {
    const order = await this.orders.byId(ctx.tenantId, id);
    if (!order) throw new NotFoundError("ChannelOrder", id);
    return order;
  }

  async list(ctx: TenantContext, filter: ChannelOrderFilter, page?: Partial<PageRequest>): Promise<Page<ChannelOrder>> {
    return this.orders.list(ctx.tenantId, filter, normalizePage(page));
  }

  async invoice(ctx: TenantContext, id: Ulid, invoiceRef?: ExternalRef): Promise<ChannelOrder> {
    const order = await this.get(ctx, id);
    order.invoice({ by: ctx.userId, at: this.clock.now(), invoiceRef });
    return this.commit(order);
  }

  async fulfill(ctx: TenantContext, id: Ulid): Promise<ChannelOrder> {
    const order = await this.get(ctx, id);
    order.fulfill({ by: ctx.userId, at: this.clock.now() });
    return this.commit(order);
  }

  async cancel(ctx: TenantContext, id: Ulid, reason: string): Promise<ChannelOrder> {
    const order = await this.get(ctx, id);
    order.cancel({ by: ctx.userId, at: this.clock.now(), reason });
    return this.commit(order);
  }

  async forRegistration(ctx: TenantContext, registrationId: Ulid): Promise<readonly ChannelOrder[]> {
    return this.orders.byRegistration(ctx.tenantId, registrationId);
  }

  /**
   * Booked value for a partner over a period, split by whether the revenue
   * came through a registered deal. Cancelled orders contribute nothing.
   */
  async attainment(
    ctx: TenantContext,
    partnerId: Ulid,
    range: { from: IsoDateTime; to: IsoDateTime },
  ): Promise<PartnerAttainment> {
    const partner = await this.partnerService.get(ctx, partnerId);
    const page = await this.orders.list(
      ctx.tenantId,
      { partnerId, from: range.from, to: range.to },
      normalizePage({ pageSize: 200 }),
    );
    const live = page.items.filter((o) => o.status !== "cancelled" && o.netValue.currency === partner.currency);
    const registered = live.filter((o) => o.registrationId !== undefined);
    const unregistered = live.filter((o) => o.registrationId === undefined);
    const booked = sumMoney(live.map((o) => o.netValue), partner.currency);
    const registeredValue = sumMoney(registered.map((o) => o.netValue), partner.currency);
    return {
      partnerId,
      currency: partner.currency,
      from: range.from,
      to: range.to,
      bookedValue: booked,
      orderCount: live.length,
      registeredValue,
      unregisteredValue: sumMoney(unregistered.map((o) => o.netValue), partner.currency),
      registeredShareBps:
        booked.amountMinor === 0 ? 0 : Math.round((registeredValue.amountMinor / booked.amountMinor) * 10_000),
    };
  }

  private async bookedForRegistration(ctx: TenantContext, registrationId: Ulid, currency: string): Promise<Money> {
    const existing = await this.orders.byRegistration(ctx.tenantId, registrationId);
    const live = existing.filter((o) => o.status !== "cancelled" && o.netValue.currency === currency);
    return live.length === 0 ? zeroMoney(currency) : sumMoney(live.map((o) => o.netValue), currency);
  }

  private async loadRegistration(ctx: TenantContext, id: Ulid): Promise<DealRegistration> {
    const registration = await this.registrations.byId(ctx.tenantId, id);
    if (!registration) throw new NotFoundError("DealRegistration", id);
    return registration;
  }

  private async commit(order: ChannelOrder): Promise<ChannelOrder> {
    await this.orders.save(order);
    await this.publisher.publish(order);
    return order;
  }
}
