import { AggregateRoot, type CurrencyCode, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
import { type AccountId, type CostCenterId, type IsoDate, type JournalId, type TaxCodeId } from "./ids.js";
export type ArInvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
export interface ArInvoiceLine {
    readonly lineNo: number;
    readonly description: string;
    /** Quantity in thousandths to keep arithmetic integral (1500 = 1.5 units). */
    readonly quantityMilli: number;
    readonly unitPriceMinor: number;
    readonly revenueAccountId: AccountId;
    readonly costCenterId?: CostCenterId;
    readonly taxCodeId?: TaxCodeId;
    readonly taxRateBps: number;
    readonly subtotalMinor: number;
    readonly taxMinor: number;
    readonly totalMinor: number;
}
export interface ArInvoiceLineInput {
    description: string;
    quantityMilli: number;
    unitPriceMinor: number;
    revenueAccountId: AccountId;
    costCenterId?: CostCenterId;
    taxCodeId?: TaxCodeId;
    /** Resolved by the service from the tax code; 0 when untaxed. */
    taxRateBps?: number;
}
export interface ArInvoiceProps {
    invoiceNo: string;
    customerId: string;
    customerName: string;
    currency: CurrencyCode;
    issueDate: IsoDate;
    dueDate: IsoDate;
    status: ArInvoiceStatus;
    lines: ArInvoiceLine[];
    subtotalMinor: number;
    taxTotalMinor: number;
    totalMinor: number;
    paidMinor: number;
    journalId?: JournalId;
    voidReason?: string;
}
export declare function computeLine(input: ArInvoiceLineInput, lineNo: number): Result<ArInvoiceLine>;
export declare class ArInvoice extends AggregateRoot<ArInvoiceProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        invoiceNo: string;
        customerId: string;
        customerName: string;
        currency: CurrencyCode;
        issueDate: string;
        dueDate: string;
        lines: ArInvoiceLineInput[];
    }): Result<ArInvoice>;
    get invoiceNo(): string;
    get customerId(): string;
    get currency(): CurrencyCode;
    get issueDate(): IsoDate;
    get dueDate(): IsoDate;
    get status(): ArInvoiceStatus;
    get lines(): readonly ArInvoiceLine[];
    get subtotalMinor(): number;
    get taxTotalMinor(): number;
    get totalMinor(): number;
    get paidMinor(): number;
    get journalId(): JournalId | undefined;
    balanceMinor(): number;
    /** Issuing locks the invoice and links the GL journal that recognized it. */
    issue(journalId: JournalId): Result<void>;
    applyPayment(amountMinor: number): Result<void>;
    voidInvoice(reason: string): Result<void>;
}
//# sourceMappingURL=ar-invoice.d.ts.map