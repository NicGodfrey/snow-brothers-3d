import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { CLOSE_CHECK_CODES, PeriodCloseRun } from "../domain/period-close.js";
import { expectOk } from "./service-support.js";
/**
 * Orchestrates the month-end close:
 *
 *   1. beginClose      — period OPEN -> CLOSING (soft close), checklist run created
 *   2. runChecks       — evaluates each gate against live ledger state
 *   3. completeClose   — all checks PASSED -> period CLOSED, close event emitted
 *   (  cancelClose     — abandons the run, period returns to OPEN )
 *   (  reopen          — CLOSED -> OPEN with an audit reason )
 */
export class PeriodCloseService {
    periods;
    closeRuns;
    journals;
    arInvoices;
    apBills;
    trialBalance;
    outbox;
    constructor(periods, closeRuns, journals, arInvoices, apBills, trialBalance, outbox) {
        this.periods = periods;
        this.closeRuns = closeRuns;
        this.journals = journals;
        this.arInvoices = arInvoices;
        this.apBills = apBills;
        this.trialBalance = trialBalance;
        this.outbox = outbox;
    }
    async beginClose(ctx, periodCodeValue) {
        const period = await this.getPeriod(ctx, periodCodeValue);
        const active = await this.closeRuns.findActiveForPeriod(ctx.tenantId, periodCodeValue);
        if (active) {
            throw new ConflictError(`a close run is already active for period ${periodCodeValue}`);
        }
        expectOk(period.beginClose(), "CLOSE_REJECTED");
        const run = PeriodCloseRun.start(ctx.tenantId, periodCodeValue, ctx.userId);
        await this.periods.save(period);
        await this.closeRuns.save(run);
        this.outbox.publishAll(period.pullEvents());
        return this.runChecks(ctx, periodCodeValue);
    }
    /** Re-evaluates every checklist gate; safe to call repeatedly while CLOSING. */
    async runChecks(ctx, periodCodeValue) {
        const period = await this.getPeriod(ctx, periodCodeValue);
        const run = await this.closeRuns.findActiveForPeriod(ctx.tenantId, periodCodeValue);
        if (!run)
            throw new NotFoundError("PeriodCloseRun (active)", periodCodeValue);
        const drafts = await this.journals.listByDateRange(ctx.tenantId, period.startDate, period.endDate, "DRAFT");
        expectOk(run.recordCheck(CLOSE_CHECK_CODES.NoDraftJournals, drafts.length === 0, drafts.length === 0
            ? "no draft journals in period"
            : `${drafts.length} draft journal(s): ${drafts.map((d) => d.journalNo).join(", ")}`));
        const invoices = await this.arInvoices.list(ctx.tenantId);
        const bills = await this.apBills.list(ctx.tenantId);
        const unpostedInvoices = invoices.filter((i) => i.status === "DRAFT" && i.issueDate >= period.startDate && i.issueDate <= period.endDate);
        const unpostedBills = bills.filter((b) => b.status === "DRAFT" && b.billDate >= period.startDate && b.billDate <= period.endDate);
        const subledgerIssues = [
            ...unpostedInvoices.map((i) => `AR ${i.invoiceNo} is DRAFT`),
            ...unpostedBills.map((b) => `AP ${b.billNo} is DRAFT`),
        ];
        expectOk(run.recordCheck(CLOSE_CHECK_CODES.SubledgersSettled, subledgerIssues.length === 0, subledgerIssues.length === 0 ? "all AR/AP documents posted" : subledgerIssues.join("; ")));
        const tb = await this.trialBalance.compute(ctx, {
            periodCode: periodCodeValue,
            basis: "PERIOD",
        });
        expectOk(run.recordCheck(CLOSE_CHECK_CODES.TrialBalanceBalanced, tb.balanced, `debits ${tb.totalDebitMinor} vs credits ${tb.totalCreditMinor}`));
        await this.closeRuns.save(run);
        return run;
    }
    async completeClose(ctx, periodCodeValue) {
        const period = await this.getPeriod(ctx, periodCodeValue);
        // Re-verify against live state so a stale READY run cannot close a dirty period.
        const run = await this.runChecks(ctx, periodCodeValue);
        expectOk(run.complete(ctx.userId), "CLOSE_NOT_READY");
        const tb = await this.trialBalance.compute(ctx, {
            periodCode: periodCodeValue,
            basis: "PERIOD",
        });
        expectOk(period.completeClose(ctx.userId, {
            totalDebitMinor: tb.totalDebitMinor,
            totalCreditMinor: tb.totalCreditMinor,
            journalCount: tb.journalCount,
        }), "CLOSE_REJECTED");
        await this.closeRuns.save(run);
        await this.periods.save(period);
        this.outbox.publishAll(period.pullEvents());
        return { run, periodStatus: period.status };
    }
    async cancelClose(ctx, periodCodeValue) {
        const period = await this.getPeriod(ctx, periodCodeValue);
        const run = await this.closeRuns.findActiveForPeriod(ctx.tenantId, periodCodeValue);
        if (run) {
            expectOk(run.cancel());
            await this.closeRuns.save(run);
        }
        expectOk(period.cancelClose(), "CLOSE_CANCEL_REJECTED");
        await this.periods.save(period);
    }
    async reopen(ctx, periodCodeValue, reason) {
        const period = await this.getPeriod(ctx, periodCodeValue);
        expectOk(period.reopen(reason), "REOPEN_REJECTED");
        await this.periods.save(period);
        this.outbox.publishAll(period.pullEvents());
    }
    async getCloseStatus(ctx, periodCodeValue) {
        const period = await this.getPeriod(ctx, periodCodeValue);
        const runs = await this.closeRuns.list(ctx.tenantId, periodCodeValue);
        const active = await this.closeRuns.findActiveForPeriod(ctx.tenantId, periodCodeValue);
        return {
            periodCode: period.code,
            periodStatus: period.status,
            activeRun: active?.toJSON(),
            history: runs.map((r) => r.toJSON()),
        };
    }
    async getPeriod(ctx, code) {
        const period = await this.periods.findByCode(ctx.tenantId, code);
        if (!period)
            throw new NotFoundError("PostingPeriod", code);
        return period;
    }
}
//# sourceMappingURL=period-close-service.js.map