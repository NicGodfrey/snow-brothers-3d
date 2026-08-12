import { AggregateRoot, type CurrencyCode, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
import { type ApBillId, type IsoDate, type JournalId } from "./ids.js";
import { type PaymentMethod } from "./ar-payment.js";
export type ApPaymentStatus = "ISSUED" | "PARTIALLY_APPLIED" | "APPLIED";
export interface BillApplication {
    readonly billId: ApBillId;
    readonly amountMinor: number;
}
export interface ApPaymentProps {
    paymentNo: string;
    supplierId: string;
    currency: CurrencyCode;
    amountMinor: number;
    paymentDate: IsoDate;
    method: PaymentMethod;
    reference?: string;
    applications: BillApplication[];
    status: ApPaymentStatus;
    journalId?: JournalId;
}
export declare class ApPayment extends AggregateRoot<ApPaymentProps> {
    private constructor();
    static issue(tenantId: TenantId, input: {
        paymentNo: string;
        supplierId: string;
        currency: CurrencyCode;
        amountMinor: number;
        paymentDate: string;
        method: PaymentMethod;
        reference?: string;
    }): Result<ApPayment>;
    get paymentNo(): string;
    get supplierId(): string;
    get currency(): CurrencyCode;
    get amountMinor(): number;
    get paymentDate(): IsoDate;
    get method(): PaymentMethod;
    get status(): ApPaymentStatus;
    get applications(): readonly BillApplication[];
    get journalId(): JournalId | undefined;
    appliedMinor(): number;
    unappliedMinor(): number;
    apply(billId: ApBillId, amountMinor: number): Result<void>;
    linkJournal(journalId: JournalId): void;
}
//# sourceMappingURL=ap-payment.d.ts.map