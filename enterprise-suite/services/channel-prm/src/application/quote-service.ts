import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type IsoDateTime,
  type Money,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  ChannelQuote,
  type AddQuoteLineInput,
  type ChannelQuoteLine,
  type ExternalRef,
} from "../domain/channel-quote.js";
import type { DealRegistration } from "../domain/deal-registration.js";
import { PolicyViolationError, ValidationError } from "../domain/errors.js";
import { formatNumber } from "../domain/numbering.js";
import type { TierPolicy } from "../domain/partner.js";
import type { PartnerService } from "./partner-service.js";
import type {
  ChannelQuoteFilter,
  ChannelQuoteRepository,
  Clock,
  OutboxPort,
  RegistrationRepository,
  SequencePort,
} from "./ports.js";
import type { RegistrationService } from "./registration-service.js";
import { Publisher } from "./unit-of-work.js";

export interface CreateQuoteCommand {
  readonly partnerId: Ulid;
  readonly registrationId?: Ulid;
  /** Required when the quote is not tied to a registration. */
  readonly customerKey?: string;
  readonly customerName?: string;
  readonly notes?: string;
  readonly salesQuoteRef?: ExternalRef;
  readonly lines?: readonly AddQuoteLineInput[];
}

export interface ApproveQuoteCommand {
  readonly discountBps?: number;
  readonly unitPrices?: ReadonlyMap<Ulid, Money>;
  readonly notes?: string;
  readonly salesQuoteRef?: ExternalRef;
}

export interface QuoteAuthority {
  /** Highest discount that may be approved on this quote. */
  readonly ceilingBps: number;
  /** At or below this the request needs no human decision. */
  readonly autoApproveBelowBps: number;
  readonly protectedByRegistration: boolean;
  readonly explanation: string;
}

/** How long an approved channel price stays good, unless overridden. */
const DEFAULT_VALIDITY_DAYS = 30;

/**
 * Channel quotes and special pricing.
 *
 * The discount a partner may receive is a function of deal protection, not of
 * who asks: a quote sitting under a live registration gets the tier's full
 * band, everything else is capped at the tier's base discount. That single
 * rule is what makes deal registration worth the partner's time, so it is
 * computed in one place and returned to callers as an explainable
 * `QuoteAuthority`.
 */
export class QuoteService {
  private readonly publisher: Publisher;

  constructor(
    private readonly quotes: ChannelQuoteRepository,
    private readonly registrations: RegistrationRepository,
    private readonly partnerService: PartnerService,
    private readonly registrationService: RegistrationService,
    private readonly sequences: SequencePort,
    outbox: OutboxPort,
    private readonly clock: Clock,
  ) {
    this.publisher = new Publisher(outbox);
  }

  /** Discount authority for a quote, with the reasoning that produced it. */
  authorityFor(policy: TierPolicy, registration: DealRegistration | undefined, at: IsoDateTime): QuoteAuthority {
    if (registration?.isProtectedAt(at)) {
      return {
        ceilingBps: policy.maxDiscountBps,
        autoApproveBelowBps: registration.discountBps,
        protectedByRegistration: true,
        explanation:
          `Registration ${registration.number} is protected until ${registration.protection!.endsAt}: ` +
          `up to ${policy.maxDiscountBps}bps may be approved, ${registration.discountBps}bps is automatic`,
      };
    }
    return {
      ceilingBps: policy.baseDiscountBps,
      autoApproveBelowBps: policy.baseDiscountBps,
      protectedByRegistration: false,
      explanation:
        `No live deal protection: capped at the tier's base discount of ${policy.baseDiscountBps}bps. ` +
        `Register the deal to unlock up to ${policy.maxDiscountBps}bps`,
    };
  }

  async create(ctx: TenantContext, command: CreateQuoteCommand): Promise<ChannelQuote> {
    const partner = await this.partnerService.get(ctx, command.partnerId);
    partner.assertActive("request channel pricing");
    if (!partner.canTransact) {
      throw new PolicyViolationError(
        `Partner ${partner.code} is a referral agent and does not transact; no channel quote can be raised`,
        "partner.type",
        { type: partner.type },
      );
    }

    let customerKey = command.customerKey?.trim();
    let customerName = command.customerName?.trim();
    if (command.registrationId) {
      const registration = await this.loadRegistration(ctx, command.registrationId);
      if (registration.partnerId !== partner.id) {
        throw new PolicyViolationError(
          `Registration ${registration.number} belongs to another partner`,
          "quote.registrationOwner",
        );
      }
      customerKey = registration.customerKey;
      customerName = registration.endCustomer.name;
    }
    if (!customerKey || !customerName) {
      throw ValidationError.single("customerKey", "a customer key and name are required without a registration");
    }

    const quote = ChannelQuote.create(ctx.tenantId, {
      number: formatNumber("channelQuote", await this.sequences.next(ctx.tenantId, "channelQuote")),
      partnerId: partner.id,
      registrationId: command.registrationId,
      customerKey,
      customerName,
      currency: partner.currency,
      notes: command.notes,
      salesQuoteRef: command.salesQuoteRef,
    });
    for (const line of command.lines ?? []) quote.addLine(line);
    return this.commit(quote);
  }

  async get(ctx: TenantContext, id: Ulid): Promise<ChannelQuote> {
    const quote = await this.quotes.byId(ctx.tenantId, id);
    if (!quote) throw new NotFoundError("ChannelQuote", id);
    return quote;
  }

  async list(ctx: TenantContext, filter: ChannelQuoteFilter, page?: Partial<PageRequest>): Promise<Page<ChannelQuote>> {
    return this.quotes.list(ctx.tenantId, filter, normalizePage(page));
  }

  async addLine(ctx: TenantContext, id: Ulid, input: AddQuoteLineInput): Promise<ChannelQuoteLine> {
    const quote = await this.get(ctx, id);
    const line = quote.addLine(input);
    await this.quotes.save(quote);
    return line;
  }

  async updateLine(
    ctx: TenantContext,
    id: Ulid,
    lineId: Ulid,
    changes: { quantity?: number; requestedUnitPrice?: Money; description?: string },
  ): Promise<ChannelQuoteLine> {
    const quote = await this.get(ctx, id);
    const line = quote.updateLine(lineId, changes);
    await this.quotes.save(quote);
    return line;
  }

  async removeLine(ctx: TenantContext, id: Ulid, lineId: Ulid): Promise<ChannelQuote> {
    const quote = await this.get(ctx, id);
    quote.removeLine(lineId);
    await this.quotes.save(quote);
    return quote;
  }

  /**
   * Submits the pricing request. A request inside the automatic band on a
   * protected deal is approved in the same call — the partner should not wait
   * for a human to rubber-stamp a discount the program already promised them.
   */
  async submit(
    ctx: TenantContext,
    id: Ulid,
    options: { validityDays?: number } = {},
  ): Promise<{ quote: ChannelQuote; authority: QuoteAuthority; autoApproved: boolean }> {
    const quote = await this.get(ctx, id);
    const partner = await this.partnerService.get(ctx, quote.partnerId);
    const policy = await this.partnerService.policyFor(ctx, partner.tier);
    const registration = quote.registrationId ? await this.loadRegistration(ctx, quote.registrationId) : undefined;
    const at = this.clock.now();
    const authority = this.authorityFor(policy, registration, at);
    const requested = quote.requestedDiscountBps();

    if (requested > authority.ceilingBps) {
      throw new PolicyViolationError(
        `Requested discount ${requested}bps exceeds the ${authority.ceilingBps}bps authority for this quote. ${authority.explanation}`,
        "quote.discountCeiling",
        { requested, ceiling: authority.ceilingBps, protected: authority.protectedByRegistration },
      );
    }

    const autoApprove = requested <= authority.autoApproveBelowBps;
    quote.submit({
      by: ctx.userId,
      at,
      validityDays: options.validityDays ?? DEFAULT_VALIDITY_DAYS,
      requiresApproval: !autoApprove,
    });
    await this.commit(quote);

    if (autoApprove) {
      quote.approve({
        by: ctx.userId,
        at,
        ceilingBps: authority.ceilingBps,
        notes: `Auto-approved within the ${requested <= 0 ? "list-price" : `${authority.autoApproveBelowBps}bps`} band`,
      });
      await this.commit(quote);
      await this.attachToRegistration(ctx, quote);
    }
    return { quote, authority, autoApproved: autoApprove };
  }

  async approve(ctx: TenantContext, id: Ulid, command: ApproveQuoteCommand = {}): Promise<ChannelQuote> {
    const quote = await this.get(ctx, id);
    const partner = await this.partnerService.get(ctx, quote.partnerId);
    const policy = await this.partnerService.policyFor(ctx, partner.tier);
    const registration = quote.registrationId ? await this.loadRegistration(ctx, quote.registrationId) : undefined;
    const at = this.clock.now();
    const authority = this.authorityFor(policy, registration, at);
    quote.approve({
      by: ctx.userId,
      at,
      discountBps: command.discountBps,
      unitPrices: command.unitPrices,
      ceilingBps: authority.ceilingBps,
      notes: command.notes,
      salesQuoteRef: command.salesQuoteRef,
    });
    await this.commit(quote);
    await this.attachToRegistration(ctx, quote);
    return quote;
  }

  async reject(ctx: TenantContext, id: Ulid, reason: string): Promise<ChannelQuote> {
    const quote = await this.get(ctx, id);
    quote.reject({ by: ctx.userId, at: this.clock.now(), reason });
    return this.commit(quote);
  }

  /**
   * Opens a fresh draft carrying the same lines and supersedes the original —
   * the audit trail keeps both, which is what a partner disputing a price
   * change needs.
   */
  async revise(ctx: TenantContext, id: Ulid): Promise<ChannelQuote> {
    const original = await this.get(ctx, id);
    const revision = ChannelQuote.create(ctx.tenantId, {
      number: formatNumber("channelQuote", await this.sequences.next(ctx.tenantId, "channelQuote")),
      partnerId: original.partnerId,
      registrationId: original.registrationId,
      customerKey: original.customerKey,
      customerName: original.customerName,
      currency: original.currency,
      notes: `Revision of ${original.number}`,
      salesQuoteRef: original.salesQuoteRef,
    });
    for (const line of original.lines) {
      revision.addLine({
        productLine: line.productLine,
        sku: line.sku,
        description: line.description,
        quantity: line.quantity,
        listUnitPrice: line.listUnitPrice,
        requestedUnitPrice: line.requestedUnitPrice,
      });
    }
    const at = this.clock.now();
    original.supersede(revision.id, at);
    await this.quotes.save(revision);
    await this.quotes.save(original);
    await this.publisher.publish(revision, original);
    return revision;
  }

  /** Lapses submitted/approved quotes past their validity date. */
  async sweepExpired(ctx: TenantContext, at?: IsoDateTime): Promise<readonly ChannelQuote[]> {
    const now = at ?? this.clock.now();
    const due = await this.quotes.dueForExpiry(ctx.tenantId, now);
    const expired: ChannelQuote[] = [];
    for (const quote of due) {
      if (quote.expire(now)) {
        await this.quotes.save(quote);
        await this.publisher.publish(quote);
        expired.push(quote);
      }
    }
    return expired;
  }

  async forRegistration(ctx: TenantContext, registrationId: Ulid): Promise<readonly ChannelQuote[]> {
    return this.quotes.byRegistration(ctx.tenantId, registrationId);
  }

  private async attachToRegistration(ctx: TenantContext, quote: ChannelQuote): Promise<void> {
    if (!quote.registrationId) return;
    await this.registrationService.linkQuote(ctx, quote.registrationId, {
      id: quote.id,
      number: quote.number,
      linkedAt: this.clock.now(),
      value: quote.approvedTotal(),
    });
  }

  private async loadRegistration(ctx: TenantContext, id: Ulid): Promise<DealRegistration> {
    const registration = await this.registrations.byId(ctx.tenantId, id);
    if (!registration) throw new NotFoundError("DealRegistration", id);
    return registration;
  }

  private async commit(quote: ChannelQuote): Promise<ChannelQuote> {
    const existing = await this.quotes.byNumber(quote.tenantId, quote.number);
    if (existing && existing.id !== quote.id) {
      throw new ConflictError(`Quote number ${quote.number} is already in use`);
    }
    await this.quotes.save(quote);
    await this.publisher.publish(quote);
    return quote;
  }
}
