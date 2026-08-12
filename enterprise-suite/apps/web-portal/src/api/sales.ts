import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import { BaseModuleApi } from "./module-api.js";
import type { ApiPage, ListQuery } from "./types.js";

/** Typed stub for `sales-erp`: quotes, orders, customers, discount approvals. */

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

export class SalesApi extends BaseModuleApi {
  readonly module: ModuleKey = "sales";

  constructor(http: ApiClient) {
    super(http);
  }

  listQuotes(query: ListQuery & { status?: QuoteStatus } = {}): Promise<ApiPage<QuoteDto>> {
    return this.http.get<ApiPage<QuoteDto>>("/quotes", { query: { ...query } });
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

  listOrders(query: ListQuery & { status?: OrderStatus } = {}): Promise<ApiPage<OrderDto>> {
    return this.http.get<ApiPage<OrderDto>>("/orders", { query: { ...query } });
  }

  getOrder(orderId: string): Promise<OrderDto> {
    return this.http.get<OrderDto>(`/orders/${encodeURIComponent(orderId)}`);
  }

  listCustomers(query: ListQuery & { creditStatus?: CreditStatus } = {}): Promise<ApiPage<CustomerDto>> {
    return this.http.get<ApiPage<CustomerDto>>("/customers", { query: { ...query } });
  }

  listPendingApprovals(query: ListQuery = {}): Promise<ApiPage<DiscountApprovalDto>> {
    return this.http.get<ApiPage<DiscountApprovalDto>>("/approvals", { query: { ...query } });
  }

  approveDiscount(approvalId: string, input: ApproveDiscountInput): Promise<DiscountApprovalDto> {
    return this.http.post<DiscountApprovalDto>(
      `/approvals/${encodeURIComponent(approvalId)}/approve`,
      { body: input },
    );
  }
}
