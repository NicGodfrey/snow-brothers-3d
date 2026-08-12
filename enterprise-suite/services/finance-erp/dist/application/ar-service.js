import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { ArInvoice } from "../domain/ar-invoice.js";
import { ArPayment } from "../domain/ar-payment.js";
import { expectOk } from "./service-support.js";
/**
 * Accounts receivable subledger. Issuing an invoice and applying payments
 * both post journals through JournalService, so the GL stays the single
 * source of truth for the trial balance.
 */
export class ArService {
    invoices;
    payments;
    accounts;
    taxCodes;
    settingsService;
    journalService;
    outbox;
    constructor(invoices, payments, accounts, taxCodes, settingsService, journalService, outbox) {
        this.invoices = invoices;
        this.payments = payments;
        this.accounts = accounts;
        this.taxCodes = taxCodes;
        this.settingsService = settingsService;
        this.journalService = journalService;
        this.outbox = outbox;
    }
    async createInvoice(ctx, command) {
        const lines = [];
        for (const line of command.lines) {
            const account = await this.accounts.findByCode(ctx.tenantId, line.revenueAccountCode);
            if (!account)
                throw new NotFoundError("Account", line.revenueAccountCode);
            if (account.type !== "REVENUE") {
                throw new ConflictError(`account ${account.code} is ${account.type}; AR invoice lines must post to REVENUE`);
            }
            let taxCodeId;
            let taxRateBps = 0;
            if (line.taxCode) {
                const tax = await this.taxCodes.findByCode(ctx.tenantId, line.taxCode);
                if (!tax)
                    throw new NotFoundError("TaxCode", line.taxCode);
                if (!tax.appliesTo("SALES")) {
                    throw new ConflictError(`tax code ${tax.code} does not apply to sales`);
                }
                taxCodeId = tax.id;
                taxRateBps = tax.rateBps;
            }
            lines.push({
                description: line.description,
                quantityMilli: line.quantityMilli,
                unitPriceMinor: line.unitPriceMinor,
                revenueAccountId: account.id,
                costCenterId: line.costCenterId,
                taxCodeId,
                taxRateBps,
            });
        }
        const invoice = expectOk(ArInvoice.create(ctx.tenantId, {
            invoiceNo: await this.invoices.nextInvoiceNo(ctx.tenantId),
            customerId: command.customerId,
            customerName: command.customerName,
            currency: command.currency.toUpperCase(),
            issueDate: command.issueDate,
            dueDate: command.dueDate,
            lines,
        }));
        await this.invoices.save(invoice);
        return invoice;
    }
    /**
     * Issue = recognize in the GL:
     *   DR  AR control            total
     *   CR  revenue (per line)    subtotal
     *   CR  sales tax payable     tax total
     */
    async issueInvoice(ctx, invoiceId) {
        const invoice = await this.getInvoice(ctx, invoiceId);
        const settings = await this.settingsService.get(ctx);
        const journalLines = [{
                accountId: settings.arControlAccountId,
                debitMinor: invoice.totalMinor,
                description: `AR ${invoice.invoiceNo} ${invoice.customerId}`,
            }];
        for (const line of invoice.lines) {
            journalLines.push({
                accountId: line.revenueAccountId,
                creditMinor: line.subtotalMinor,
                costCenterId: line.costCenterId,
                description: `${invoice.invoiceNo} L${line.lineNo}: ${line.description}`,
            });
        }
        if (invoice.taxTotalMinor > 0) {
            journalLines.push({
                accountId: settings.salesTaxPayableAccountId,
                creditMinor: invoice.taxTotalMinor,
                description: `${invoice.invoiceNo} sales tax`,
            });
        }
        const journal = await this.journalService.createAndPost(ctx, {
            journalDate: invoice.issueDate,
            currency: invoice.currency,
            source: "AR",
            memo: `AR invoice ${invoice.invoiceNo}`,
            lines: journalLines,
        });
        expectOk(invoice.issue(journal.id), "ISSUE_REJECTED");
        await this.invoices.save(invoice);
        this.outbox.publishAll(invoice.pullEvents());
        return invoice;
    }
    /**
     * Receipt journal:
     *   DR  cash        amount
     *   CR  AR control  amount
     * Applications then relieve individual invoices.
     */
    async receivePayment(ctx, command) {
        const settings = await this.settingsService.get(ctx);
        const payment = expectOk(ArPayment.receive(ctx.tenantId, {
            paymentNo: await this.payments.nextPaymentNo(ctx.tenantId),
            customerId: command.customerId,
            currency: command.currency.toUpperCase(),
            amountMinor: command.amountMinor,
            receivedDate: command.receivedDate,
            method: command.method,
            reference: command.reference,
        }));
        const journal = await this.journalService.createAndPost(ctx, {
            journalDate: command.receivedDate,
            currency: payment.currency,
            source: "AR",
            memo: `AR receipt ${payment.paymentNo} from ${payment.customerId}`,
            lines: [
                {
                    accountId: settings.cashAccountId,
                    debitMinor: payment.amountMinor,
                    description: `Receipt ${payment.paymentNo}`,
                },
                {
                    accountId: settings.arControlAccountId,
                    creditMinor: payment.amountMinor,
                    description: `Receipt ${payment.paymentNo}`,
                },
            ],
        });
        payment.linkJournal(journal.id);
        await this.payments.save(payment);
        this.outbox.publishAll(payment.pullEvents());
        for (const application of command.applications ?? []) {
            await this.applyPayment(ctx, payment.id, application.invoiceId, application.amountMinor);
        }
        return (await this.payments.findById(ctx.tenantId, payment.id));
    }
    async applyPayment(ctx, paymentId, invoiceId, amountMinor) {
        const payment = await this.getPayment(ctx, paymentId);
        const invoice = await this.getInvoice(ctx, invoiceId);
        if (payment.currency !== invoice.currency) {
            throw new ConflictError(`payment currency ${payment.currency} does not match invoice currency ${invoice.currency}`);
        }
        if (payment.customerId !== invoice.customerId) {
            throw new ConflictError(`payment ${payment.paymentNo} belongs to ${payment.customerId}, invoice to ${invoice.customerId}`);
        }
        expectOk(invoice.applyPayment(amountMinor), "APPLICATION_REJECTED");
        expectOk(payment.apply(invoiceId, amountMinor), "APPLICATION_REJECTED");
        await this.invoices.save(invoice);
        await this.payments.save(payment);
        this.outbox.publishAll(invoice.pullEvents());
        return { payment, invoice };
    }
    async voidInvoice(ctx, invoiceId, reason) {
        const invoice = await this.getInvoice(ctx, invoiceId);
        const journalId = invoice.journalId;
        expectOk(invoice.voidInvoice(reason), "VOID_REJECTED");
        if (journalId) {
            await this.journalService.reverse(ctx, journalId, {
                memo: `Void AR invoice ${invoice.invoiceNo}: ${reason}`,
            });
        }
        await this.invoices.save(invoice);
        this.outbox.publishAll(invoice.pullEvents());
        return invoice;
    }
    async getInvoice(ctx, id) {
        const invoice = await this.invoices.findById(ctx.tenantId, id);
        if (!invoice)
            throw new NotFoundError("ArInvoice", id);
        return invoice;
    }
    async getPayment(ctx, id) {
        const payment = await this.payments.findById(ctx.tenantId, id);
        if (!payment)
            throw new NotFoundError("ArPayment", id);
        return payment;
    }
    async listInvoices(ctx, filter) {
        return this.invoices.list(ctx.tenantId, filter);
    }
    async listPayments(ctx, filter) {
        return this.payments.list(ctx.tenantId, filter);
    }
    /** Open (unpaid) AR balance per customer — a simple aging-style summary. */
    async openBalanceByCustomer(ctx) {
        const invoices = await this.invoices.list(ctx.tenantId);
        const byCustomer = new Map();
        for (const invoice of invoices) {
            if (invoice.status !== "ISSUED" && invoice.status !== "PARTIALLY_PAID")
                continue;
            const entry = byCustomer.get(invoice.customerId) ?? { openMinor: 0, invoiceCount: 0 };
            entry.openMinor += invoice.balanceMinor();
            entry.invoiceCount += 1;
            byCustomer.set(invoice.customerId, entry);
        }
        return [...byCustomer.entries()]
            .map(([customerId, entry]) => ({ customerId, ...entry }))
            .sort((a, b) => b.openMinor - a.openMinor);
    }
}
//# sourceMappingURL=ar-service.js.map