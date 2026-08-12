/**
 * Canonical event type names emitted by the finance-erp bounded context.
 * Envelope shape comes from the shared kernel (EventEnvelope).
 */
export declare const FinanceEventTypes: {
    readonly AccountCreated: "finance.account.created";
    readonly AccountDeactivated: "finance.account.deactivated";
    readonly JournalPosted: "finance.journal.posted";
    readonly JournalReversed: "finance.journal.reversed";
    readonly PeriodOpened: "finance.period.opened";
    readonly PeriodCloseStarted: "finance.period.close-started";
    readonly PeriodClosed: "finance.period.closed";
    readonly PeriodReopened: "finance.period.reopened";
    readonly ArInvoiceIssued: "finance.ar.invoice-issued";
    readonly ArInvoiceVoided: "finance.ar.invoice-voided";
    readonly ArInvoicePaid: "finance.ar.invoice-paid";
    readonly ArPaymentReceived: "finance.ar.payment-received";
    readonly ApBillApproved: "finance.ap.bill-approved";
    readonly ApBillVoided: "finance.ap.bill-voided";
    readonly ApBillPaid: "finance.ap.bill-paid";
    readonly ApPaymentIssued: "finance.ap.payment-issued";
    readonly CostCenterCreated: "finance.cost-center.created";
    readonly AllocationExecuted: "finance.allocation.executed";
    readonly TaxCodeCreated: "finance.tax-code.created";
    readonly FxRateStored: "finance.fx-rate.stored";
};
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
//# sourceMappingURL=events.d.ts.map