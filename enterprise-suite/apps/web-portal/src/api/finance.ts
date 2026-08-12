import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import { BaseModuleApi } from "./module-api.js";
import type { ApiPage, ListQuery } from "./types.js";

/** Typed stub for `finance-erp`: receivables, payables, journals, periods. */

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

  listReceivables(
    query: ListQuery & { bucket?: AgeingBucket; customerId?: string } = {},
  ): Promise<ApiPage<ReceivableDto>> {
    return this.http.get<ApiPage<ReceivableDto>>("/receivables", { query: { ...query } });
  }

  applyPayment(invoiceId: string, input: ApplyPaymentInput, idempotencyKey?: string): Promise<ReceivableDto> {
    return this.http.post<ReceivableDto>(
      `/receivables/${encodeURIComponent(invoiceId)}/payments`,
      { body: input, idempotencyKey },
    );
  }

  listPayables(
    query: ListQuery & { supplierId?: string; dueBefore?: string } = {},
  ): Promise<ApiPage<PayableDto>> {
    return this.http.get<ApiPage<PayableDto>>("/payables", { query: { ...query } });
  }

  schedulePayment(invoiceId: string, payOn: string): Promise<PayableDto> {
    return this.http.post<PayableDto>(`/payables/${encodeURIComponent(invoiceId)}/schedule`, {
      body: { payOn },
    });
  }

  listJournals(query: ListQuery & { status?: JournalStatus; period?: string } = {}): Promise<ApiPage<JournalDto>> {
    return this.http.get<ApiPage<JournalDto>>("/journals", { query: { ...query } });
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

  listPeriods(query: ListQuery & { status?: PeriodStatus } = {}): Promise<ApiPage<PeriodDto>> {
    return this.http.get<ApiPage<PeriodDto>>("/periods", { query: { ...query } });
  }

  closePeriod(periodId: string): Promise<PeriodDto> {
    return this.http.post<PeriodDto>(`/periods/${encodeURIComponent(periodId)}/close`, { body: {} });
  }
}
