import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { ArInvoice } from "../domain/ar-invoice.js";
import { ArPayment, type PaymentMethod } from "../domain/ar-payment.js";
import type { ArInvoiceId, ArPaymentId, CostCenterId } from "../domain/ids.js";
import type { JournalService } from "./journal-service.js";
import type { AccountRepository, ArInvoiceRepository, ArPaymentRepository, TaxCodeRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import type { LedgerSettingsService } from "./settings-service.js";
export interface ArInvoiceLineCommand {
    description: string;
    quantityMilli: number;
    unitPriceMinor: number;
    revenueAccountCode: string;
    costCenterId?: CostCenterId;
    taxCode?: string;
}
export interface CreateArInvoiceCommand {
    customerId: string;
    customerName: string;
    currency: string;
    issueDate: string;
    dueDate: string;
    lines: ArInvoiceLineCommand[];
}
export interface ReceiveArPaymentCommand {
    customerId: string;
    currency: string;
    amountMinor: number;
    receivedDate: string;
    method: PaymentMethod;
    reference?: string;
    /** Optional immediate applications; may also be applied later. */
    applications?: {
        invoiceId: ArInvoiceId;
        amountMinor: number;
    }[];
}
/**
 * Accounts receivable subledger. Issuing an invoice and applying payments
 * both post journals through JournalService, so the GL stays the single
 * source of truth for the trial balance.
 */
export declare class ArService {
    private readonly invoices;
    private readonly payments;
    private readonly accounts;
    private readonly taxCodes;
    private readonly settingsService;
    private readonly journalService;
    private readonly outbox;
    constructor(invoices: ArInvoiceRepository, payments: ArPaymentRepository, accounts: AccountRepository, taxCodes: TaxCodeRepository, settingsService: LedgerSettingsService, journalService: JournalService, outbox: EventOutbox);
    createInvoice(ctx: TenantContext, command: CreateArInvoiceCommand): Promise<ArInvoice>;
    /**
     * Issue = recognize in the GL:
     *   DR  AR control            total
     *   CR  revenue (per line)    subtotal
     *   CR  sales tax payable     tax total
     */
    issueInvoice(ctx: TenantContext, invoiceId: ArInvoiceId): Promise<ArInvoice>;
    /**
     * Receipt journal:
     *   DR  cash        amount
     *   CR  AR control  amount
     * Applications then relieve individual invoices.
     */
    receivePayment(ctx: TenantContext, command: ReceiveArPaymentCommand): Promise<ArPayment>;
    applyPayment(ctx: TenantContext, paymentId: ArPaymentId, invoiceId: ArInvoiceId, amountMinor: number): Promise<{
        payment: ArPayment;
        invoice: ArInvoice;
    }>;
    voidInvoice(ctx: TenantContext, invoiceId: ArInvoiceId, reason: string): Promise<ArInvoice>;
    getInvoice(ctx: TenantContext, id: ArInvoiceId): Promise<ArInvoice>;
    getPayment(ctx: TenantContext, id: ArPaymentId): Promise<ArPayment>;
    listInvoices(ctx: TenantContext, filter?: {
        customerId?: string;
        status?: string;
    }): Promise<ArInvoice[]>;
    listPayments(ctx: TenantContext, filter?: {
        customerId?: string;
    }): Promise<ArPayment[]>;
    /** Open (unpaid) AR balance per customer — a simple aging-style summary. */
    openBalanceByCustomer(ctx: TenantContext): Promise<{
        customerId: string;
        openMinor: number;
        invoiceCount: number;
    }[]>;
}
//# sourceMappingURL=ar-service.d.ts.map