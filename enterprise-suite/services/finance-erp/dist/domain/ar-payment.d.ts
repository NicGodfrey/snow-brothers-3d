import { AggregateRoot, type CurrencyCode, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
import { type ArInvoiceId, type IsoDate, type JournalId } from "./ids.js";
export type PaymentMethod = "BANK_TRANSFER" | "CARD" | "CASH" | "CHECK" | "OTHER";
export type ArPaymentStatus = "RECEIVED" | "PARTIALLY_APPLIED" | "APPLIED";
export declare const PAYMENT_METHODS: readonly PaymentMethod[];
export interface PaymentApplication {
    readonly invoiceId: ArInvoiceId;
    readonly amountMinor: number;
}
export interface ArPaymentProps {
    paymentNo: string;
    customerId: string;
    currency: CurrencyCode;
    amountMinor: number;
    receivedDate: IsoDate;
    method: PaymentMethod;
    reference?: string;
    applications: PaymentApplication[];
    status: ArPaymentStatus;
    journalId?: JournalId;
}
export declare class ArPayment extends AggregateRoot<ArPaymentProps> {
    private constructor();
    static receive(tenantId: TenantId, input: {
        paymentNo: string;
        customerId: string;
        currency: CurrencyCode;
        amountMinor: number;
        receivedDate: string;
        method: PaymentMethod;
        reference?: string;
    }): Result<ArPayment>;
    get paymentNo(): string;
    get customerId(): string;
    get currency(): CurrencyCode;
    get amountMinor(): number;
    get receivedDate(): IsoDate;
    get method(): PaymentMethod;
    get status(): ArPaymentStatus;
    get applications(): readonly PaymentApplication[];
    get journalId(): JournalId | undefined;
    appliedMinor(): number;
    unappliedMinor(): number;
    apply(invoiceId: ArInvoiceId, amountMinor: number): Result<void>;
    linkJournal(journalId: JournalId): void;
}
//# sourceMappingURL=ar-payment.d.ts.map