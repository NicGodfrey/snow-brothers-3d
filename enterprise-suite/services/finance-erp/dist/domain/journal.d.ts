import { AggregateRoot, type CurrencyCode, type IsoDateTime, type Result, type TenantId, type UserId } from "@enterprise-suite/shared-kernel";
import { type AccountId, type CostCenterId, type IsoDate, type JournalId } from "./ids.js";
export type JournalStatus = "DRAFT" | "POSTED" | "REVERSED";
export type JournalSource = "MANUAL" | "AR" | "AP" | "ALLOCATION" | "CLOSING" | "SYSTEM";
export interface JournalLine {
    readonly lineNo: number;
    readonly accountId: AccountId;
    readonly accountCode: string;
    readonly costCenterId?: CostCenterId;
    readonly description?: string;
    /** Integer minor units; exactly one of debit/credit is non-zero per line. */
    readonly debitMinor: number;
    readonly creditMinor: number;
}
export interface JournalLineInput {
    accountId: AccountId;
    accountCode: string;
    costCenterId?: CostCenterId;
    description?: string;
    debitMinor?: number;
    creditMinor?: number;
}
export interface JournalProps {
    journalNo: string;
    journalDate: IsoDate;
    periodCode: string;
    currency: CurrencyCode;
    source: JournalSource;
    status: JournalStatus;
    memo?: string;
    lines: JournalLine[];
    postedAt?: IsoDateTime;
    postedBy?: UserId;
    /** Set on a reversing journal, pointing at the journal it reverses. */
    reversalOfId?: JournalId;
    /** Set on a reversed journal, pointing at its reversing journal. */
    reversedById?: JournalId;
}
export interface CreateJournalInput {
    journalNo: string;
    journalDate: string;
    periodCode: string;
    currency: CurrencyCode;
    source?: JournalSource;
    memo?: string;
    lines: JournalLineInput[];
}
export declare class Journal extends AggregateRoot<JournalProps> {
    private constructor();
    static create(tenantId: TenantId, input: CreateJournalInput): Result<Journal>;
    get journalNo(): string;
    get journalDate(): IsoDate;
    get periodCode(): string;
    get currency(): CurrencyCode;
    get status(): JournalStatus;
    get source(): JournalSource;
    get lines(): readonly JournalLine[];
    get reversalOfId(): JournalId | undefined;
    get reversedById(): JournalId | undefined;
    totalDebitMinor(): number;
    totalCreditMinor(): number;
    isBalanced(): boolean;
    post(postedBy: UserId): Result<void>;
    /**
     * Builds the reversing journal (debits and credits swapped) and marks this journal REVERSED.
     * The reversing journal is returned in DRAFT state; the caller posts it through the normal path
     * so period and account checks still apply.
     */
    buildReversal(input: {
        journalNo: string;
        journalDate: string;
        periodCode: string;
        memo?: string;
    }): Result<Journal>;
}
//# sourceMappingURL=journal.d.ts.map