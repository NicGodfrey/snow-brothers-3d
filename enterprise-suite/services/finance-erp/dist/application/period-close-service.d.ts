import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { PeriodCloseRun } from "../domain/period-close.js";
import type { ApBillRepository, ArInvoiceRepository, JournalRepository, PeriodCloseRunRepository, PeriodRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import type { TrialBalanceService } from "./trial-balance-service.js";
/**
 * Orchestrates the month-end close:
 *
 *   1. beginClose      — period OPEN -> CLOSING (soft close), checklist run created
 *   2. runChecks       — evaluates each gate against live ledger state
 *   3. completeClose   — all checks PASSED -> period CLOSED, close event emitted
 *   (  cancelClose     — abandons the run, period returns to OPEN )
 *   (  reopen          — CLOSED -> OPEN with an audit reason )
 */
export declare class PeriodCloseService {
    private readonly periods;
    private readonly closeRuns;
    private readonly journals;
    private readonly arInvoices;
    private readonly apBills;
    private readonly trialBalance;
    private readonly outbox;
    constructor(periods: PeriodRepository, closeRuns: PeriodCloseRunRepository, journals: JournalRepository, arInvoices: ArInvoiceRepository, apBills: ApBillRepository, trialBalance: TrialBalanceService, outbox: EventOutbox);
    beginClose(ctx: TenantContext, periodCodeValue: string): Promise<PeriodCloseRun>;
    /** Re-evaluates every checklist gate; safe to call repeatedly while CLOSING. */
    runChecks(ctx: TenantContext, periodCodeValue: string): Promise<PeriodCloseRun>;
    completeClose(ctx: TenantContext, periodCodeValue: string): Promise<{
        run: PeriodCloseRun;
        periodStatus: string;
    }>;
    cancelClose(ctx: TenantContext, periodCodeValue: string): Promise<void>;
    reopen(ctx: TenantContext, periodCodeValue: string, reason: string): Promise<void>;
    getCloseStatus(ctx: TenantContext, periodCodeValue: string): Promise<{
        periodCode: string;
        periodStatus: string;
        activeRun?: ReturnType<PeriodCloseRun["toJSON"]>;
        history: ReturnType<PeriodCloseRun["toJSON"]>[];
    }>;
    private getPeriod;
}
//# sourceMappingURL=period-close-service.d.ts.map