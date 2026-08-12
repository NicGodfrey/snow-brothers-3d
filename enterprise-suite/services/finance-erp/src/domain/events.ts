/**
 * Canonical event type names emitted by the finance-erp bounded context.
 * Envelope shape comes from the shared kernel (EventEnvelope).
 */
export const FinanceEventTypes = {
  AccountCreated: "finance.account.created",
  AccountDeactivated: "finance.account.deactivated",

  JournalPosted: "finance.journal.posted",
  JournalReversed: "finance.journal.reversed",

  PeriodOpened: "finance.period.opened",
  PeriodCloseStarted: "finance.period.close-started",
  PeriodClosed: "finance.period.closed",
  PeriodReopened: "finance.period.reopened",

  ArInvoiceIssued: "finance.ar.invoice-issued",
  ArInvoiceVoided: "finance.ar.invoice-voided",
  ArInvoicePaid: "finance.ar.invoice-paid",
  ArPaymentReceived: "finance.ar.payment-received",

  ApBillApproved: "finance.ap.bill-approved",
  ApBillVoided: "finance.ap.bill-voided",
  ApBillPaid: "finance.ap.bill-paid",
  ApPaymentIssued: "finance.ap.payment-issued",

  CostCenterCreated: "finance.cost-center.created",
  AllocationExecuted: "finance.allocation.executed",

  TaxCodeCreated: "finance.tax-code.created",
  FxRateStored: "finance.fx-rate.stored",
} as const;

export type FinanceEventType = (typeof FinanceEventTypes)[keyof typeof FinanceEventTypes];

export interface JournalPostedPayload {
  journalId: string;
  journalNo: string;
  periodCode: string;
  source: string;
  currency: string;
  totalDebitMinor: number;
  totalCreditMinor: number;
  lineCount: number;
}

export interface PeriodClosedPayload {
  periodCode: string;
  fiscalYear: number;
  periodNo: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
  journalCount: number;
}

export interface ArInvoiceIssuedPayload {
  invoiceId: string;
  invoiceNo: string;
  customerId: string;
  currency: string;
  totalMinor: number;
  journalId: string;
}

export interface ApBillApprovedPayload {
  billId: string;
  billNo: string;
  supplierId: string;
  currency: string;
  totalMinor: number;
  journalId: string;
}

export interface AllocationExecutedPayload {
  ruleId: string;
  ruleName: string;
  periodCode: string;
  sourceAmountMinor: number;
  journalId: string;
  targetCount: number;
}
