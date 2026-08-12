import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import {
  BaseModuleApi,
  asPage,
  composeHits,
  count,
  emptyPage,
  hitSource,
  moneyValue,
  statusOf,
  sumMoney,
  type ModuleSummaryDto,
  type SearchHit,
} from "./module-api.js";
import type { ApiPage, ListQuery, RequestOptions, RowLike } from "./types.js";

/**
 * Typed client for `finance-erp` behind the gateway's `/api/finance` prefix.
 *
 * Receivables map to the real `ar/invoices` routes and payables to
 * `ap/bills`; journals are served as-is. Summary/search are composed from
 * those lists client-side. Periods have no gateway read route yet.
 */

export type AgeingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export type InvoiceStatus = "draft" | "open" | "part-paid" | "paid" | "written-off";
export type JournalStatus = "draft" | "posted" | "reversed";
export type PeriodStatus = "open" | "closing" | "closed";

export interface ReceivableDto {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly status: InvoiceStatus;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly ageingBucket: AgeingBucket;
  readonly amount: Money;
  readonly outstanding: Money;
}

export interface PayableDto {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly status: InvoiceStatus;
  readonly dueOn: string;
  readonly amount: Money;
  readonly outstanding: Money;
  readonly purchaseOrderId?: string;
  readonly discountIfPaidBy?: string;
}

export interface JournalLineDto {
  readonly lineNo: number;
  readonly account: string;
  readonly description: string;
  readonly debit?: Money;
  readonly credit?: Money;
}

export interface JournalDto {
  readonly id: string;
  readonly reference: string;
  readonly period: string;
  readonly status: JournalStatus;
  readonly postedOn?: string;
  readonly preparedBy: string;
  readonly total: Money;
  readonly lines?: readonly JournalLineDto[];
}

export interface PeriodDto {
  readonly id: string;
  readonly code: string;
  readonly status: PeriodStatus;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly openTasks: number;
  readonly closedBy?: string;
}

export interface PostJournalInput {
  readonly reference: string;
  readonly period: string;
  readonly lines: ReadonlyArray<{
    readonly account: string;
    readonly description: string;
    readonly debitMinor?: number;
    readonly creditMinor?: number;
  }>;
  readonly currency: string;
}

export interface ApplyPaymentInput {
  readonly amountMinor: number;
  readonly currency: string;
  readonly receivedOn: string;
  readonly reference: string;
}

export class FinanceApi extends BaseModuleApi {
  readonly module: ModuleKey = "finance";

  constructor(http: ApiClient) {
    super(http);
  }

  override async summary(options?: RequestOptions): Promise<ModuleSummaryDto> {
    const [receivables, payables, journals] = await Promise.all([
      this.listReceivables({ pageSize: 100 }, options),
      this.listPayables({ pageSize: 100 }, options).catch(() => emptyPage<PayableDto>()),
      this.listJournals({ pageSize: 100 }, options).catch(() => emptyPage<JournalDto>()),
    ]);

    const now = Date.now();
    const openReceivables = receivables.items.filter(
      (r) => (r.outstanding?.amountMinor ?? 0) > 0,
    );
    const receivablesOutstanding = sumMoney(openReceivables.map((r) => r.outstanding));
    const payablesOutstanding = sumMoney(
      payables.items
        .filter((p) => (p.outstanding?.amountMinor ?? 0) > 0)
        .map((p) => p.outstanding),
    );
    const overdue = openReceivables.filter(
      (r) => r.dueOn !== undefined && Date.parse(r.dueOn) < now,
    ).length;
    const drafts = journals.items.filter((j) => statusOf(j) === "draft").length;

    return {
      module: "finance",
      asOf: new Date().toISOString(),
      metrics: {
        ...(receivablesOutstanding
          ? { receivablesOutstanding: moneyValue(receivablesOutstanding) }
          : {}),
        ...(payablesOutstanding ? { payablesOutstanding: moneyValue(payablesOutstanding) } : {}),
        overdueInvoices: count(overdue),
        draftJournals: count(drafts),
      },
    };
  }

  override async list(
    resource: string,
    query?: ListQuery,
    options?: RequestOptions,
  ): Promise<ApiPage<RowLike>> {
    switch (resource) {
      case "receivables":
        return (await this.listReceivables(query, options)) as unknown as ApiPage<RowLike>;
      case "payables":
        return (await this.listPayables(query, options)) as unknown as ApiPage<RowLike>;
      case "journals":
        return (await this.listJournals(query, options)) as unknown as ApiPage<RowLike>;
      case "periods":
        return (await this.listPeriods(query, options)) as unknown as ApiPage<RowLike>;
      default:
        return super.list(resource, query, options);
    }
  }

  override async search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    if (!term.trim()) return [];
    const [receivables, payables, journals] = await Promise.all([
      this.listReceivables({ pageSize: 50 }, options),
      this.listPayables({ pageSize: 50 }, options).catch(() => emptyPage<PayableDto>()),
      this.listJournals({ pageSize: 50 }, options).catch(() => emptyPage<JournalDto>()),
    ]);
    return composeHits("finance", term, limit, [
      hitSource({
        slug: "receivables",
        rows: receivables.items,
        fields: ["invoiceNumber", "customerName", "ageingBucket", "status"],
        title: (row) => `${row.invoiceNumber} · ${row.customerName}`,
        subtitle: (row) => `Receivable · ${row.ageingBucket ?? row.status}`,
      }),
      hitSource({
        slug: "payables",
        rows: payables.items,
        fields: ["invoiceNumber", "supplierName", "status"],
        title: (row) => `${row.invoiceNumber} · ${row.supplierName}`,
        subtitle: (row) => `Payable · due ${row.dueOn}`,
      }),
      hitSource({
        slug: "journals",
        rows: journals.items,
        fields: ["reference", "period", "status"],
        title: (row) => `${row.reference} · ${row.period}`,
        subtitle: (row) => `Journal · ${row.status}`,
      }),
    ]);
  }

  listReceivables(
    query: ListQuery & { bucket?: AgeingBucket; customerId?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<ReceivableDto>> {
    return this.http
      .get<unknown>("/ar/invoices", { ...options, query: { ...query } })
      .then(asPage<ReceivableDto>);
  }

  applyPayment(invoiceId: string, input: ApplyPaymentInput, idempotencyKey?: string): Promise<ReceivableDto> {
    return this.http.post<ReceivableDto>(
      `/ar/invoices/${encodeURIComponent(invoiceId)}/payments`,
      { body: input, idempotencyKey },
    );
  }

  listPayables(
    query: ListQuery & { supplierId?: string; dueBefore?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<PayableDto>> {
    return this.http
      .get<unknown>("/ap/bills", { ...options, query: { ...query } })
      .then(asPage<PayableDto>);
  }

  schedulePayment(invoiceId: string, payOn: string): Promise<PayableDto> {
    return this.http.post<PayableDto>(`/ap/bills/${encodeURIComponent(invoiceId)}/schedule`, {
      body: { payOn },
    });
  }

  listJournals(
    query: ListQuery & { status?: JournalStatus; period?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<JournalDto>> {
    return this.http
      .get<unknown>("/journals", { ...options, query: { ...query } })
      .then(asPage<JournalDto>);
  }

  getJournal(journalId: string): Promise<JournalDto> {
    return this.http.get<JournalDto>(`/journals/${encodeURIComponent(journalId)}`);
  }

  postJournal(input: PostJournalInput, idempotencyKey?: string): Promise<JournalDto> {
    return this.http.post<JournalDto>("/journals", { body: input, idempotencyKey });
  }

  reverseJournal(journalId: string, reason: string): Promise<JournalDto> {
    return this.http.post<JournalDto>(`/journals/${encodeURIComponent(journalId)}/reverse`, {
      body: { reason },
    });
  }

  listPeriods(
    query: ListQuery & { status?: PeriodStatus } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<PeriodDto>> {
    return this.http
      .get<unknown>("/periods", { ...options, query: { ...query } })
      .then(asPage<PeriodDto>);
  }

  closePeriod(periodId: string): Promise<PeriodDto> {
    return this.http.post<PeriodDto>(`/periods/${encodeURIComponent(periodId)}/close`, { body: {} });
  }
}
