import { NotFoundError } from "@enterprise-suite/shared-kernel";
/**
 * Trial balance is computed straight from POSTED journals — there is no
 * separately maintained balance table to drift out of sync.
 */
export class TrialBalanceService {
    journals;
    accounts;
    periods;
    constructor(journals, accounts, periods) {
        this.journals = journals;
        this.accounts = accounts;
        this.periods = periods;
    }
    async compute(ctx, options) {
        const basis = options.basis ?? "PERIOD";
        const period = await this.periods.findByCode(ctx.tenantId, options.periodCode);
        if (!period)
            throw new NotFoundError("PostingPeriod", options.periodCode);
        const startDate = basis === "PERIOD" ? period.startDate : "0000-01-01";
        const posted = await this.journals.listByDateRange(ctx.tenantId, startDate, period.endDate, "POSTED");
        const reversed = await this.journals.listByDateRange(ctx.tenantId, startDate, period.endDate, "REVERSED");
        // A REVERSED journal's amounts still hit the ledger; its reversing journal
        // (POSTED) nets them out. Both must be included for the TB to be faithful.
        const journals = [...posted, ...reversed];
        const totals = new Map();
        for (const journal of journals) {
            for (const line of journal.lines) {
                const entry = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
                entry.debit += line.debitMinor;
                entry.credit += line.creditMinor;
                totals.set(line.accountId, entry);
            }
        }
        const rows = [];
        for (const [accountId, entry] of totals) {
            const account = await this.accounts.findById(ctx.tenantId, accountId);
            if (!account)
                continue;
            const net = entry.debit - entry.credit;
            rows.push({
                accountId,
                accountCode: account.code,
                accountName: account.name,
                accountType: account.type,
                normalBalance: account.normalBalance,
                debitMinor: entry.debit,
                creditMinor: entry.credit,
                netMinor: net,
                balanceMinor: account.normalBalance === "DEBIT" ? net : -net,
            });
        }
        rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
        const totalDebit = rows.reduce((s, r) => s + r.debitMinor, 0);
        const totalCredit = rows.reduce((s, r) => s + r.creditMinor, 0);
        return {
            periodCode: period.code,
            basis,
            rows,
            totalDebitMinor: totalDebit,
            totalCreditMinor: totalCredit,
            balanced: totalDebit === totalCredit,
            journalCount: journals.length,
        };
    }
}
//# sourceMappingURL=trial-balance-service.js.map