import { AggregateRoot, type CurrencyCode, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
import { type AccountId, type CostCenterId, type IsoDate, type JournalId, type TaxCodeId } from "./ids.js";
export type ApBillStatus = "DRAFT" | "APPROVED" | "PARTIALLY_PAID" | "PAID" | "VOID";
export interface ApBillLine {
    readonly lineNo: number;
    readonly description: string;
    readonly quantityMilli: number;
    readonly unitCostMinor: number;
    readonly expenseAccountId: AccountId;
    readonly costCenterId?: CostCenterId;
    readonly taxCodeId?: TaxCodeId;
    readonly taxRateBps: number;
    readonly subtotalMinor: number;
    readonly taxMinor: number;
    readonly totalMinor: number;
}
export interface ApBillLineInput {
    description: string;
    quantityMilli: number;
    unitCostMinor: number;
    expenseAccountId: AccountId;
    costCenterId?: CostCenterId;
    taxCodeId?: TaxCodeId;
    taxRateBps?: number;
}
export interface ApBillProps {
    billNo: string;
    supplierId: string;
    supplierName: string;
    supplierInvoiceRef?: string;
    currency: CurrencyCode;
    billDate: IsoDate;
    dueDate: IsoDate;
    status: ApBillStatus;
    lines: ApBillLine[];
    subtotalMinor: number;
    taxTotalMinor: number;
    totalMinor: number;
    paidMinor: number;
    journalId?: JournalId;
    voidReason?: string;
}
export declare class ApBill extends AggregateRoot<ApBillProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        billNo: string;
        supplierId: string;
        supplierName: string;
        supplierInvoiceRef?: string;
        currency: CurrencyCode;
        billDate: string;
        dueDate: string;
        lines: ApBillLineInput[];
    }): Result<ApBill>;
    get billNo(): string;
    get supplierId(): string;
    get currency(): CurrencyCode;
    get billDate(): IsoDate;
    get dueDate(): IsoDate;
    get status(): ApBillStatus;
    get lines(): readonly ApBillLine[];
    get subtotalMinor(): number;
    get taxTotalMinor(): number;
    get totalMinor(): number;
    get paidMinor(): number;
    get journalId(): JournalId | undefined;
    balanceMinor(): number;
    /** Approval recognizes the liability in the GL and locks the bill. */
    approve(journalId: JournalId): Result<void>;
    applyPayment(amountMinor: number): Result<void>;
    voidBill(reason: string): Result<void>;
}
//# sourceMappingURL=ap-bill.d.ts.map