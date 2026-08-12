import { type TenantContext } from "@enterprise-suite/shared-kernel";
import type { AccountType, NormalBalance } from "../domain/account.js";
import type { AccountId } from "../domain/ids.js";
import type { AccountRepository, JournalRepository, PeriodRepository } from "../infrastructure/repositories.js";
export interface TrialBalanceRow {
    readonly accountId: AccountId;
    readonly accountCode: string;
    readonly accountName: string;
    readonly accountType: AccountType;
    readonly normalBalance: NormalBalance;
    readonly debitMinor: number;
    readonly creditMinor: number;
    /** debit - credit; positive means net debit. */
    readonly netMinor: number;
    /** Net presented on the account's normal side (assets/expenses positive when net debit). */
    readonly balanceMinor: number;
}
export interface TrialBalance {
    readonly periodCode: string;
    /** "PERIOD" = activity within the period; "CUMULATIVE" = through end of the period. */
    readonly basis: "PERIOD" | "CUMULATIVE";
    readonly currency?: string;
    readonly rows: readonly TrialBalanceRow[];
    readonly totalDebitMinor: number;
    readonly totalCreditMinor: number;
    readonly balanced: boolean;
    readonly journalCount: number;
}
/**
 * Trial balance is computed straight from POSTED journals — there is no
 * separately maintained balance table to drift out of sync.
 */
export declare class TrialBalanceService {
    private readonly journals;
    private readonly accounts;
    private readonly periods;
    constructor(journals: JournalRepository, accounts: AccountRepository, periods: PeriodRepository);
    compute(ctx: TenantContext, options: {
        periodCode: string;
        basis?: "PERIOD" | "CUMULATIVE";
    }): Promise<TrialBalance>;
}
//# sourceMappingURL=trial-balance-service.d.ts.map