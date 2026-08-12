import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import {
  BaseModuleApi,
  asPage,
  composeHits,
  count,
  days,
  emptyPage,
  hitSource,
  moneyValue,
  percent,
  statusOf,
  sumMoney,
  type ModuleSummaryDto,
  type SearchHit,
} from "./module-api.js";
import type { ApiPage, ListQuery, RequestOptions, RowLike } from "./types.js";

/**
 * Typed client for `sales-erp` behind the gateway's `/api/sales` prefix.
 *
 * Quotes and orders are live routes. The shell-facing summary/search are
 * composed here from those lists so the backend needs no synthetic `/summary`.
 * Customers and discount approvals have no gateway route yet; their calls
 * degrade gracefully when the upstream answers 404.
 */

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type OrderStatus = "confirmed" | "picking" | "shipped" | "invoiced" | "cancelled";
export type CreditStatus = "ok" | "watch" | "blocked";

export interface QuoteLineDto {
  readonly lineNo: number;
  readonly sku: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly discountPct: number;
  readonly netAmount: Money;
}

export interface QuoteDto {
  readonly id: string;
  readonly number: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly status: QuoteStatus;
  readonly total: Money;
  readonly discountPct: number;
  readonly validUntil: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly lines?: readonly QuoteLineDto[];
}

export interface OrderDto {
  readonly id: string;
  readonly number: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly status: OrderStatus;
  readonly total: Money;
  readonly promisedDate: string;
  readonly quoteId?: string;
  readonly fulfillmentPct: number;
}

export interface CustomerDto {
  readonly id: string;
  readonly name: string;
  readonly segment: string;
  readonly creditStatus: CreditStatus;
  readonly creditLimit: Money;
  readonly openBalance: Money;
  readonly owner: string;
}

export interface DiscountApprovalDto {
  readonly id: string;
  readonly quoteId: string;
  readonly quoteNumber: string;
  readonly customerName: string;
  readonly requestedPct: number;
  readonly policyPct: number;
  readonly requestedBy: string;
  readonly requestedAt: string;
}

export interface CreateQuoteInput {
  readonly customerId: string;
  readonly currency: string;
  readonly lines: ReadonlyArray<{
    readonly sku: string;
    readonly quantity: number;
    readonly unitPriceMinor: number;
    readonly discountPct?: number;
  }>;
  readonly validUntil?: string;
}

export interface ApproveDiscountInput {
  readonly approvedPct: number;
  readonly comment?: string;
}

const OPEN_ORDER_STATUSES = new Set(["confirmed", "picking", "allocated", "partially-shipped"]);
const DECIDED_QUOTE_STATUSES = new Set(["accepted", "rejected", "expired"]);

export class SalesApi extends BaseModuleApi {
  readonly module: ModuleKey = "sales";

  constructor(http: ApiClient) {
    super(http);
  }

  override async summary(options?: RequestOptions): Promise<ModuleSummaryDto> {
    const [quotes, orders, approvals] = await Promise.all([
      this.listQuotes({ pageSize: 100 }, options),
      this.listOrders({ pageSize: 100 }, options),
      this.listPendingApprovals({ pageSize: 100 }, options).catch(() => undefined),
    ]);

    const openQuotes = quotes.items.filter((q) =>
      ["draft", "sent", "submitted"].includes(statusOf(q)),
    ).length;
    const decided = quotes.items.filter((q) => DECIDED_QUOTE_STATUSES.has(statusOf(q)));
    const won = decided.filter((q) => statusOf(q) === "accepted").length;
    const openOrders = orders.items.filter(
      (o) => !["invoiced", "closed", "cancelled"].includes(statusOf(o)),
    );
    const openOrderValue = sumMoney(
      orders.items.filter((o) => OPEN_ORDER_STATUSES.has(statusOf(o))).map((o) => o.total),
    );

    const quotesById = new Map(quotes.items.map((q) => [q.id, q]));
    const cycles = orders.items
      .filter((o) => o.quoteId && quotesById.has(o.quoteId))
      .map((o) => {
        const quote = quotesById.get(o.quoteId!)!;
        return (Date.parse(o.promisedDate) - Date.parse(quote.createdAt)) / 86_400_000;
      })
      .filter((value) => Number.isFinite(value) && value >= 0);
    const avgCycleDays =
      cycles.length > 0 ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : 0;

    return {
      module: "sales",
      asOf: new Date().toISOString(),
      metrics: {
        ...(openOrderValue ? { openOrderValue: moneyValue(openOrderValue) } : {}),
        openQuotes: count(openQuotes),
        quoteWinRate: percent(decided.length > 0 ? won / decided.length : 0),
        avgCycleDays: days(Math.round(avgCycleDays * 10) / 10),
        openOrders: count(openOrders.length),
        ...(approvals ? { pendingApprovals: count(approvals.total) } : {}),
      },
    };
  }

  override async list(
    resource: string,
    query?: ListQuery,
    options?: RequestOptions,
  ): Promise<ApiPage<RowLike>> {
    switch (resource) {
      case "quotes":
        return (await this.listQuotes(query, options)) as unknown as ApiPage<RowLike>;
      case "orders":
        return (await this.listOrders(query, options)) as unknown as ApiPage<RowLike>;
      case "customers":
        return (await this.listCustomers(query, options)) as unknown as ApiPage<RowLike>;
      case "approvals":
        return (await this.listPendingApprovals(query, options)) as unknown as ApiPage<RowLike>;
      default:
        return super.list(resource, query, options);
    }
  }

  override async search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    if (!term.trim()) return [];
    const [quotes, orders, customers] = await Promise.all([
      this.listQuotes({ pageSize: 50 }, options),
      this.listOrders({ pageSize: 50 }, options).catch(() => emptyPage<OrderDto>()),
      this.listCustomers({ pageSize: 50 }, options).catch(() => emptyPage<CustomerDto>()),
    ]);
    return composeHits("sales", term, limit, [
      hitSource({
        slug: "quotes",
        rows: quotes.items,
        fields: ["number", "customerName", "status"],
        title: (row) => `${row.number} · ${row.customerName}`,
        subtitle: (row) => `Quote · ${row.status}`,
      }),
      hitSource({
        slug: "orders",
        rows: orders.items,
        fields: ["number", "customerName", "status"],
        title: (row) => `${row.number} · ${row.customerName}`,
        subtitle: (row) => `Order · ${row.status}`,
      }),
      hitSource({
        slug: "customers",
        rows: customers.items,
        fields: ["name", "segment", "creditStatus"],
        title: (row) => row.name,
        subtitle: (row) => `Customer · ${row.segment}`,
      }),
    ]);
  }

  listQuotes(
    query: ListQuery & { status?: QuoteStatus } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<QuoteDto>> {
    return this.http
      .get<unknown>("/quotes", { ...options, query: { ...query } })
      .then(asPage<QuoteDto>);
  }

  getQuote(quoteId: string): Promise<QuoteDto> {
    return this.http.get<QuoteDto>(`/quotes/${encodeURIComponent(quoteId)}`);
  }

  createQuote(input: CreateQuoteInput, idempotencyKey?: string): Promise<QuoteDto> {
    return this.http.post<QuoteDto>("/quotes", { body: input, idempotencyKey });
  }

  submitQuote(quoteId: string): Promise<QuoteDto> {
    return this.http.post<QuoteDto>(`/quotes/${encodeURIComponent(quoteId)}/submit`, { body: {} });
  }

  convertQuoteToOrder(quoteId: string, idempotencyKey?: string): Promise<OrderDto> {
    return this.http.post<OrderDto>(`/quotes/${encodeURIComponent(quoteId)}/convert`, {
      body: {},
      idempotencyKey,
    });
  }

  listOrders(
    query: ListQuery & { status?: OrderStatus } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<OrderDto>> {
    return this.http
      .get<unknown>("/orders", { ...options, query: { ...query } })
      .then(asPage<OrderDto>);
  }

  getOrder(orderId: string): Promise<OrderDto> {
    return this.http.get<OrderDto>(`/orders/${encodeURIComponent(orderId)}`);
  }

  listCustomers(
    query: ListQuery & { creditStatus?: CreditStatus } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<CustomerDto>> {
    return this.http
      .get<unknown>("/customers", { ...options, query: { ...query } })
      .then(asPage<CustomerDto>);
  }

  listPendingApprovals(
    query: ListQuery = {},
    options?: RequestOptions,
  ): Promise<ApiPage<DiscountApprovalDto>> {
    return this.http
      .get<unknown>("/approvals", { ...options, query: { ...query } })
      .then(asPage<DiscountApprovalDto>);
  }

  approveDiscount(approvalId: string, input: ApproveDiscountInput): Promise<DiscountApprovalDto> {
    return this.http.post<DiscountApprovalDto>(
      `/approvals/${encodeURIComponent(approvalId)}/approve`,
      { body: input },
    );
  }
}
