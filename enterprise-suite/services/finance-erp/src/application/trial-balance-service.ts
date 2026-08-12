import { NotFoundError, type TenantContext } from "@enterprise-suite/shared-kernel";
import type { AccountType, NormalBalance } from "../domain/account.js";
import type { AccountId } from "../domain/ids.js";
import type {
  AccountRepository,
  JournalRepository,
  PeriodRepository,
} from "../infrastructure/repositories.js";

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
export class TrialBalanceService {
  constructor(
    private readonly journals: JournalRepository,
    private readonly accounts: AccountRepository,
    private readonly periods: PeriodRepository,
  ) {}

  async compute(ctx: TenantContext, options: {
    periodCode: string;
    basis?: "PERIOD" | "CUMULATIVE";
  }): Promise<TrialBalance> {
    const basis = options.basis ?? "PERIOD";
    const period = await this.periods.findByCode(ctx.tenantId, options.periodCode);
    if (!period) throw new NotFoundError("PostingPeriod", options.periodCode);

    const startDate = basis === "PERIOD" ? period.startDate : "0000-01-01";
    const posted = await this.journals.listByDateRange(
      ctx.tenantId,
      startDate,
      period.endDate,
      "POSTED",
    );
    const reversed = await this.journals.listByDateRange(
      ctx.tenantId,
      startDate,
      period.endDate,
      "REVERSED",
    );
    // A REVERSED journal's amounts still hit the ledger; its reversing journal
    // (POSTED) nets them out. Both must be included for the TB to be faithful.
    const journals = [...posted, ...reversed];

    const totals = new Map<AccountId, { debit: number; credit: number }>();
    for (const journal of journals) {
      for (const line of journal.lines) {
        const entry = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
        entry.debit += line.debitMinor;
        entry.credit += line.creditMinor;
        totals.set(line.accountId, entry);
      }
    }

    const rows: TrialBalanceRow[] = [];
    for (const [accountId, entry] of totals) {
      const account = await this.accounts.findById(ctx.tenantId, accountId);
      if (!account) continue;
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
