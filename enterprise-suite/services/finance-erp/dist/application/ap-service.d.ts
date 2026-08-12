import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { ApBill } from "../domain/ap-bill.js";
import { ApPayment } from "../domain/ap-payment.js";
import type { PaymentMethod } from "../domain/ar-payment.js";
import type { ApBillId, ApPaymentId, CostCenterId } from "../domain/ids.js";
import type { JournalService } from "./journal-service.js";
import type { AccountRepository, ApBillRepository, ApPaymentRepository, TaxCodeRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import type { LedgerSettingsService } from "./settings-service.js";
export interface ApBillLineCommand {
    description: string;
    quantityMilli: number;
    unitCostMinor: number;
    expenseAccountCode: string;
    costCenterId?: CostCenterId;
    taxCode?: string;
}
export interface CreateApBillCommand {
    supplierId: string;
    supplierName: string;
    supplierInvoiceRef?: string;
    currency: string;
    billDate: string;
    dueDate: string;
    lines: ApBillLineCommand[];
}
export interface IssueApPaymentCommand {
    supplierId: string;
    currency: string;
    amountMinor: number;
    paymentDate: string;
    method: PaymentMethod;
    reference?: string;
    applications?: {
        billId: ApBillId;
        amountMinor: number;
    }[];
}
/**
 * Accounts payable subledger; the mirror image of ArService. Bill approval
 * recognizes expense + liability, payments relieve the AP control account.
 */
export declare class ApService {
    private readonly bills;
    private readonly payments;
    private readonly accounts;
    private readonly taxCodes;
    private readonly settingsService;
    private readonly journalService;
    private readonly outbox;
    constructor(bills: ApBillRepository, payments: ApPaymentRepository, accounts: AccountRepository, taxCodes: TaxCodeRepository, settingsService: LedgerSettingsService, journalService: JournalService, outbox: EventOutbox);
    createBill(ctx: TenantContext, command: CreateApBillCommand): Promise<ApBill>;
    /**
     * Approval journal:
     *   DR  expense/asset (per line)   subtotal
     *   DR  purchase tax receivable    tax total
     *   CR  AP control                 total
     */
    approveBill(ctx: TenantContext, billId: ApBillId): Promise<ApBill>;
    /**
     * Payment journal:
     *   DR  AP control  amount
     *   CR  cash        amount
     */
    issuePayment(ctx: TenantContext, command: IssueApPaymentCommand): Promise<ApPayment>;
    applyPayment(ctx: TenantContext, paymentId: ApPaymentId, billId: ApBillId, amountMinor: number): Promise<{
        payment: ApPayment;
        bill: ApBill;
    }>;
    voidBill(ctx: TenantContext, billId: ApBillId, reason: string): Promise<ApBill>;
    getBill(ctx: TenantContext, id: ApBillId): Promise<ApBill>;
    getPayment(ctx: TenantContext, id: ApPaymentId): Promise<ApPayment>;
    listBills(ctx: TenantContext, filter?: {
        supplierId?: string;
        status?: string;
    }): Promise<ApBill[]>;
    listPayments(ctx: TenantContext, filter?: {
        supplierId?: string;
    }): Promise<ApPayment[]>;
    /** Open (unpaid) AP balance per supplier. */
    openBalanceBySupplier(ctx: TenantContext): Promise<{
        supplierId: string;
        openMinor: number;
        billCount: number;
    }[]>;
}
//# sourceMappingURL=ap-service.d.ts.map