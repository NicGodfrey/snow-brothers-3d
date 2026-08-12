import { AggregateRoot, type IsoDateTime, type Result, type TenantId, type UserId } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "./ids.js";
export type PeriodStatus = "OPEN" | "CLOSING" | "CLOSED";
export interface PostingPeriodProps {
    /** Canonical code "YYYY-PP", e.g. "2026-03". Period 13 is the year-end adjustment period. */
    code: string;
    fiscalYear: number;
    periodNo: number;
    startDate: IsoDate;
    endDate: IsoDate;
    status: PeriodStatus;
    closedAt?: IsoDateTime;
    closedBy?: UserId;
}
export declare function periodCode(fiscalYear: number, periodNo: number): string;
export declare class PostingPeriod extends AggregateRoot<PostingPeriodProps> {
    private constructor();
    static open(tenantId: TenantId, input: {
        fiscalYear: number;
        periodNo: number;
        startDate: string;
        endDate: string;
    }): Result<PostingPeriod>;
    get code(): string;
    get fiscalYear(): number;
    get periodNo(): number;
    get startDate(): IsoDate;
    get endDate(): IsoDate;
    get status(): PeriodStatus;
    containsDate(date: IsoDate): boolean;
    /** Journals may only be posted while the period is OPEN or in soft-close (CLOSING allows system sources). */
    acceptsPosting(source: string): boolean;
    beginClose(): Result<void>;
    /** Abort a soft close and return the period to OPEN without emitting close events. */
    cancelClose(): Result<void>;
    completeClose(closedBy: UserId, summary: {
        totalDebitMinor: number;
        totalCreditMinor: number;
        journalCount: number;
    }): Result<void>;
    reopen(reason: string): Result<void>;
}
//# sourceMappingURL=period.d.ts.map