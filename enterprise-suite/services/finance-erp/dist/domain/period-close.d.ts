import { AggregateRoot, type IsoDateTime, type Result, type TenantId, type UserId } from "@enterprise-suite/shared-kernel";
export type CloseCheckStatus = "PENDING" | "PASSED" | "FAILED";
export type CloseRunStatus = "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";
export declare const CLOSE_CHECK_CODES: {
    readonly NoDraftJournals: "no-draft-journals";
    readonly SubledgersSettled: "subledgers-settled";
    readonly TrialBalanceBalanced: "trial-balance-balanced";
};
export type CloseCheckCode = (typeof CLOSE_CHECK_CODES)[keyof typeof CLOSE_CHECK_CODES];
export interface CloseCheck {
    readonly code: CloseCheckCode;
    readonly name: string;
    readonly status: CloseCheckStatus;
    readonly detail?: string;
    readonly evaluatedAt?: IsoDateTime;
}
export interface PeriodCloseRunProps {
    periodCode: string;
    status: CloseRunStatus;
    startedBy: UserId;
    checks: CloseCheck[];
    completedAt?: IsoDateTime;
    completedBy?: UserId;
}
/**
 * A period close run tracks the checklist that gates flipping a PostingPeriod
 * from CLOSING to CLOSED. Checks are re-evaluated against live ledger state,
 * so a run can flip back from READY to IN_PROGRESS if a check regresses.
 */
export declare class PeriodCloseRun extends AggregateRoot<PeriodCloseRunProps> {
    private constructor();
    static start(tenantId: TenantId, periodCodeValue: string, startedBy: UserId): PeriodCloseRun;
    get periodCode(): string;
    get status(): CloseRunStatus;
    get checks(): readonly CloseCheck[];
    recordCheck(code: CloseCheckCode, passed: boolean, detail?: string): Result<void>;
    complete(completedBy: UserId): Result<void>;
    cancel(): Result<void>;
}
//# sourceMappingURL=period-close.d.ts.map