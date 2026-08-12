import {
  ForbiddenError,
  hasRole,
  isoDate,
  normalizePage,
  paginate,
  sku,
  type Page,
  type TenantContext,
  type Ulid,
} from "../kernel/index.js";
import type { Account } from "../domain/accounts/account.js";
import { volumeDiscountPercent } from "../domain/pricing/discount.js";
import type { TaxCalculator } from "../domain/pricing/tax.js";
import { Quote } from "../domain/quotes/quote.js";
import { totalsToJSON } from "../domain/quotes/calculator.js";
import { SalesOrder } from "../domain/orders/sales-order.js";
import { DocumentNumberGenerator } from "../domain/numbering.js";
import type {
  AccountRepository,
  Clock,
  OpportunityRepository,
  OutboxPort,
  QuoteRepository,
  SalesOrderRepository,
} from "./ports.js";
import { PricingService } from "./pricing-service.js";
import { parse } from "./validation/validator.js";
import {
  createQuoteSchema,
  quoteLineInputSchema,
  rejectQuoteSchema,
  reviseQuoteSchema,
  updateQuoteLineSchema,
  type QuoteLineCommand,
} from "./validation/quote-schemas.js";

export const QUOTE_APPROVER_ROLES = ["sales_manager", "admin"];

export interface QuoteView {
  quote: Record<string, unknown>;
  totals: Record<string, unknown>;
}

export class QuoteService {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly accounts: AccountRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly orders: SalesOrderRepository,
    private readonly pricing: PricingService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
    private readonly taxCalculator?: TaxCalculator,
  ) {}

  create(ctx: TenantContext, input: unknown): Quote {
    const cmd = parse(createQuoteSchema, input);
    const account = this.accounts.getById(ctx.tenantId, cmd.accountId as Ulid);
    if (cmd.opportunityId) {
      this.opportunities.getById(ctx.tenantId, cmd.opportunityId as Ulid);
    }
    const quote = Quote.create(ctx.tenantId, {
      quoteNumber: this.numbers.nextNumber(ctx.tenantId, "quote"),
      accountId: account.id,
      opportunityId: cmd.opportunityId as Ulid | undefined,
      currency: account.currencyCode,
      taxRegion: cmd.taxRegion,
      validUntil: isoDate(cmd.validUntil),
      notes: cmd.notes,
    });
    for (const lineCmd of cmd.lines ?? []) {
      this.addResolvedLine(ctx, quote, account, cmd.priceListId as Ulid | undefined, lineCmd);
    }
    this.quotes.save(quote);
    this.outbox.append(quote.pullEvents());
    return quote;
  }

  get(ctx: TenantContext, id: Ulid): Quote {
    return this.quotes.getById(ctx.tenantId, id);
  }

  view(ctx: TenantContext, id: Ulid): QuoteView {
    const quote = this.quotes.getById(ctx.tenantId, id);
    return {
      quote: quote.toJSON() as unknown as Record<string, unknown>,
      totals: totalsToJSON(quote.totals(this.taxCalculator)),
    };
  }

  list(
    ctx: TenantContext,
    query: { page?: number; pageSize?: number; status?: string; accountId?: string } = {},
  ): Page<Quote> {
    let items = query.accountId
      ? this.quotes.listByAccount(ctx.tenantId, query.accountId as Ulid)
      : this.quotes.listByTenant(ctx.tenantId);
    if (query.status) items = items.filter((q) => q.status === query.status);
    items.sort((a, b) => a.quoteNumber.localeCompare(b.quoteNumber));
    return paginate(items, normalizePage(query));
  }

  addLine(ctx: TenantContext, quoteId: Ulid, input: unknown): Quote {
    const lineCmd = parse(quoteLineInputSchema, input);
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    const account = this.accounts.getById(ctx.tenantId, quote.accountId);
    this.addResolvedLine(ctx, quote, account, undefined, lineCmd);
    this.quotes.save(quote);
    return quote;
  }

  updateLine(ctx: TenantContext, quoteId: Ulid, lineId: Ulid, input: unknown): Quote {
    const patch = parse(updateQuoteLineSchema, input);
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    quote.updateLine(lineId, patch);
    this.quotes.save(quote);
    return quote;
  }

  removeLine(ctx: TenantContext, quoteId: Ulid, lineId: Ulid): Quote {
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    quote.removeLine(lineId);
    this.quotes.save(quote);
    return quote;
  }

  submit(ctx: TenantContext, quoteId: Ulid): Quote {
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    quote.submit(ctx.userId);
    this.quotes.save(quote);
    this.outbox.append(quote.pullEvents());
    return quote;
  }

  /** Discounts above the threshold need a sales_manager or admin approver. */
  approve(ctx: TenantContext, quoteId: Ulid): Quote {
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    if (quote.needsManagerApproval && !hasRole(ctx, ...QUOTE_APPROVER_ROLES)) {
      throw new ForbiddenError(
        `Quote ${quote.quoteNumber} has a line discount of ${quote.maxLineDiscountPercent}% and needs approval by: ${QUOTE_APPROVER_ROLES.join(", ")}`,
      );
    }
    quote.approve(ctx.userId);
    this.quotes.save(quote);
    this.outbox.append(quote.pullEvents());
    return quote;
  }

  reject(ctx: TenantContext, quoteId: Ulid, input: unknown): Quote {
    const cmd = parse(rejectQuoteSchema, input);
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    quote.reject(cmd.reason);
    this.quotes.save(quote);
    this.outbox.append(quote.pullEvents());
    return quote;
  }

  /**
   * Customer acceptance: emits QuoteAccepted, closes the linked opportunity
   * as won, and creates a draft sales order from the quote.
   */
  accept(ctx: TenantContext, quoteId: Ulid): { quote: Quote; order: SalesOrder } {
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    const account = this.accounts.getById(ctx.tenantId, quote.accountId);
    quote.accept(this.clock.today());
    this.quotes.save(quote);
    this.outbox.append(quote.pullEvents());

    if (quote.opportunityId) {
      const opportunity = this.opportunities.findById(ctx.tenantId, quote.opportunityId);
      if (opportunity && opportunity.isOpen) {
        opportunity.win(quote.id);
        this.opportunities.save(opportunity);
        this.outbox.append(opportunity.pullEvents());
      }
    }

    const order = SalesOrder.fromQuote(
      ctx.tenantId,
      this.numbers.nextNumber(ctx.tenantId, "order"),
      quote,
      account.shippingAddress,
    );
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return { quote, order };
  }

  cancel(ctx: TenantContext, quoteId: Ulid): Quote {
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    quote.cancel();
    this.quotes.save(quote);
    this.outbox.append(quote.pullEvents());
    return quote;
  }

  revise(ctx: TenantContext, quoteId: Ulid, input: unknown): Quote {
    const cmd = parse(reviseQuoteSchema, input);
    const quote = this.quotes.getById(ctx.tenantId, quoteId);
    quote.revise(isoDate(cmd.validUntil));
    this.quotes.save(quote);
    this.outbox.append(quote.pullEvents());
    return quote;
  }

  /** Validity sweep: expires approved quotes past validUntil. Returns count. */
  expireOverdueQuotes(ctx: TenantContext): number {
    const today = this.clock.today();
    let expired = 0;
    for (const quote of this.quotes.listByStatus(ctx.tenantId, "approved")) {
      if (quote.markExpired(today)) {
        this.quotes.save(quote);
        this.outbox.append(quote.pullEvents());
        expired += 1;
      }
    }
    return expired;
  }

  /**
   * Resolves a line command against the price list (tier price, description,
   * tax category); explicit values always win. Lines without an explicit
   * discount get the volume-ladder default.
   */
  private addResolvedLine(
    ctx: TenantContext,
    quote: Quote,
    account: Account,
    priceListId: Ulid | undefined,
    lineCmd: QuoteLineCommand,
  ): void {
    let unitPriceMinor = lineCmd.unitPriceMinor;
    let description = lineCmd.description;
    let taxCategory = lineCmd.taxCategory;
    if (unitPriceMinor === undefined || description === undefined || taxCategory === undefined) {
      const { priceList } = this.pricing.resolvePrice(ctx, {
        priceListId,
        currency: account.currencyCode as unknown as string,
        sku: lineCmd.sku,
        qty: lineCmd.qty,
      });
      const item = priceList.itemFor(sku(lineCmd.sku));
      unitPriceMinor =
        unitPriceMinor ??
        (priceList.priceFor(sku(lineCmd.sku), lineCmd.qty).amountMinor as unknown as number);
      description = description ?? item.description;
      taxCategory = taxCategory ?? item.taxCategory;
    }
    quote.addLine({
      sku: sku(lineCmd.sku),
      description: description ?? lineCmd.sku,
      qty: lineCmd.qty,
      unitPriceMinor,
      discountPercent: lineCmd.discountPercent ?? volumeDiscountPercent(lineCmd.qty),
      taxCategory,
    });
  }
}
