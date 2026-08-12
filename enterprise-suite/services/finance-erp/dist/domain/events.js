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
};
//# sourceMappingURL=events.js.map