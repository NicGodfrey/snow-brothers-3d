import {
  ConflictError,
  ForbiddenError,
  hasRole,
  normalizePage,
  paginate,
  sku,
  type Page,
  type TenantContext,
  type Ulid,
} from "../kernel/index.js";
import type { Account } from "../domain/accounts/account.js";
import type { TaxCalculator } from "../domain/pricing/tax.js";
import { volumeDiscountPercent } from "../domain/pricing/discount.js";
import { totalsToJSON } from "../domain/quotes/calculator.js";
import { SalesOrder } from "../domain/orders/sales-order.js";
import { DocumentNumberGenerator } from "../domain/numbering.js";
import type {
  AccountRepository,
  OutboxPort,
  QuoteRepository,
  SalesOrderRepository,
} from "./ports.js";
import { CreditService } from "./credit-service.js";
import { PricingService } from "./pricing-service.js";
import { parse } from "./validation/validator.js";
import {
  allocateOrderSchema,
  cancelOrderSchema,
  confirmOrderSchema,
  createDraftOrderSchema,
  createOrderFromQuoteSchema,
  orderLineInputSchema,
  shipOrderSchema,
  type OrderLineCommand,
} from "./validation/order-schemas.js";

export const CREDIT_OVERRIDE_ROLES = ["sales_manager", "admin"];

export interface OrderView {
  order: Record<string, unknown>;
  totals: Record<string, unknown>;
}

export class OrderService {
  constructor(
    private readonly orders: SalesOrderRepository,
    private readonly accounts: AccountRepository,
    private readonly quotes: QuoteRepository,
    private readonly pricing: PricingService,
    private readonly credit: CreditService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: OutboxPort,
    private readonly taxCalculator?: TaxCalculator,
  ) {}

  createDraft(ctx: TenantContext, input: unknown): SalesOrder {
    const cmd = parse(createDraftOrderSchema, input);
    const account = this.accounts.getById(ctx.tenantId, cmd.accountId as Ulid);
    const order = SalesOrder.createDraft(ctx.tenantId, {
      orderNumber: this.numbers.nextNumber(ctx.tenantId, "order"),
      accountId: account.id,
      currency: account.currencyCode as unknown as string,
      taxRegion: cmd.taxRegion,
      shippingAddress: cmd.shippingAddress ?? account.shippingAddress,
      notes: cmd.notes,
    });
    for (const lineCmd of cmd.lines ?? []) {
      this.addResolvedLine(ctx, order, account, cmd.priceListId as Ulid | undefined, lineCmd);
    }
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  createFromQuote(ctx: TenantContext, input: unknown): SalesOrder {
    const cmd = parse(createOrderFromQuoteSchema, input);
    const quote = this.quotes.getById(ctx.tenantId, cmd.quoteId as Ulid);
    const account = this.accounts.getById(ctx.tenantId, quote.accountId);
    const order = SalesOrder.fromQuote(
      ctx.tenantId,
      this.numbers.nextNumber(ctx.tenantId, "order"),
      quote,
      cmd.shippingAddress ?? account.shippingAddress,
    );
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  get(ctx: TenantContext, id: Ulid): SalesOrder {
    return this.orders.getById(ctx.tenantId, id);
  }

  view(ctx: TenantContext, id: Ulid): OrderView {
    const order = this.orders.getById(ctx.tenantId, id);
    return {
      order: order.toJSON() as unknown as Record<string, unknown>,
      totals: totalsToJSON(order.totals(this.taxCalculator)),
    };
  }

  list(
    ctx: TenantContext,
    query: { page?: number; pageSize?: number; status?: string; accountId?: string } = {},
  ): Page<SalesOrder> {
    let items = query.accountId
      ? this.orders.listByAccount(ctx.tenantId, query.accountId as Ulid)
      : this.orders.listByTenant(ctx.tenantId);
    if (query.status) items = items.filter((o) => o.status === query.status);
    items.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
    return paginate(items, normalizePage(query));
  }

  addLine(ctx: TenantContext, orderId: Ulid, input: unknown): SalesOrder {
    const lineCmd = parse(orderLineInputSchema, input);
    const order = this.orders.getById(ctx.tenantId, orderId);
    const account = this.accounts.getById(ctx.tenantId, order.accountId);
    this.addResolvedLine(ctx, order, account, undefined, lineCmd);
    this.orders.save(order);
    return order;
  }

  removeLine(ctx: TenantContext, orderId: Ulid, lineId: Ulid): SalesOrder {
    const order = this.orders.getById(ctx.tenantId, orderId);
    order.removeLine(lineId);
    this.orders.save(order);
    return order;
  }

  /**
   * Confirmation runs the credit check against live exposure:
   * - declined        -> rejected with 409
   * - review_required -> needs overrideCreditReview + manager/admin role
   * - approved        -> confirms and emits OrderConfirmed
   */
  confirm(ctx: TenantContext, orderId: Ulid, input: unknown = {}): SalesOrder {
    const cmd = parse(confirmOrderSchema, input);
    const order = this.orders.getById(ctx.tenantId, orderId);
    const decision = this.credit.check(
      ctx,
      order.accountId,
      order.totals(this.taxCalculator).grandTotal,
      order.id,
    );
    if (decision.decision === "review_required") {
      if (!cmd.overrideCreditReview) {
        throw new ConflictError(
          `Order ${order.orderNumber} requires credit review: ${decision.reasons.join("; ")}`,
          { creditDecision: decision },
        );
      }
      if (!hasRole(ctx, ...CREDIT_OVERRIDE_ROLES)) {
        throw new ForbiddenError(
          `Credit review override requires one of: ${CREDIT_OVERRIDE_ROLES.join(", ")}`,
        );
      }
    }
    order.confirm(decision);
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  allocate(ctx: TenantContext, orderId: Ulid, input: unknown): SalesOrder {
    const cmd = parse(allocateOrderSchema, input);
    const order = this.orders.getById(ctx.tenantId, orderId);
    order.allocate(cmd.allocations.map((a) => ({ lineId: a.lineId as Ulid, qty: a.qty })));
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  ship(ctx: TenantContext, orderId: Ulid, input: unknown): SalesOrder {
    const cmd = parse(shipOrderSchema, input);
    const order = this.orders.getById(ctx.tenantId, orderId);
    order.ship(cmd.shipments.map((s) => ({ lineId: s.lineId as Ulid, qty: s.qty })));
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  invoice(ctx: TenantContext, orderId: Ulid): SalesOrder {
    const order = this.orders.getById(ctx.tenantId, orderId);
    order.invoice();
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  close(ctx: TenantContext, orderId: Ulid): SalesOrder {
    const order = this.orders.getById(ctx.tenantId, orderId);
    order.close();
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  cancel(ctx: TenantContext, orderId: Ulid, input: unknown): SalesOrder {
    const cmd = parse(cancelOrderSchema, input);
    const order = this.orders.getById(ctx.tenantId, orderId);
    order.cancel(cmd.reason);
    this.orders.save(order);
    this.outbox.append(order.pullEvents());
    return order;
  }

  private addResolvedLine(
    ctx: TenantContext,
    order: SalesOrder,
    account: Account,
    priceListId: Ulid | undefined,
    lineCmd: OrderLineCommand,
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
    order.addLine({
      sku: sku(lineCmd.sku),
      description: description ?? lineCmd.sku,
      qty: lineCmd.qty,
      unitPriceMinor,
      discountPercent: lineCmd.discountPercent ?? volumeDiscountPercent(lineCmd.qty),
      taxCategory,
    });
  }
}
