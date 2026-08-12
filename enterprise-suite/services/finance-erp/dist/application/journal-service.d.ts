import { type TenantContext } from "@enterprise-suite/shared-kernel";
import type { AccountId, CostCenterId, JournalId } from "../domain/ids.js";
import { Journal, type JournalSource, type JournalStatus } from "../domain/journal.js";
import type { AccountRepository, CostCenterRepository, JournalRepository, PeriodRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
export interface JournalLineCommand {
    /** Either accountId or accountCode must be provided. */
    accountId?: AccountId;
    accountCode?: string;
    costCenterId?: CostCenterId;
    costCenterCode?: string;
    description?: string;
    debitMinor?: number;
    creditMinor?: number;
}
export interface CreateJournalCommand {
    journalDate: string;
    currency: string;
    memo?: string;
    source?: JournalSource;
    lines: JournalLineCommand[];
}
/**
 * The GL posting engine. Draft creation resolves and validates accounts,
 * cost centers and the posting period; posting enforces period status and
 * double-entry balance (the latter re-checked inside the aggregate).
 */
export declare class JournalService {
    private readonly journals;
    private readonly accounts;
    private readonly costCenters;
    private readonly periods;
    private readonly outbox;
    constructor(journals: JournalRepository, accounts: AccountRepository, costCenters: CostCenterRepository, periods: PeriodRepository, outbox: EventOutbox);
    createDraft(ctx: TenantContext, command: CreateJournalCommand): Promise<Journal>;
    post(ctx: TenantContext, journalId: JournalId): Promise<Journal>;
    /** Creates and immediately posts — used by subledgers and allocations. */
    createAndPost(ctx: TenantContext, command: CreateJournalCommand): Promise<Journal>;
    /**
     * Reverses a posted journal. The reversal is dated in the given (or same)
     * date, posted through the normal path, and both sides are cross-linked.
     */
    reverse(ctx: TenantContext, journalId: JournalId, options?: {
        reversalDate?: string;
        memo?: string;
    }): Promise<{
        original: Journal;
        reversal: Journal;
    }>;
    getJournal(ctx: TenantContext, id: JournalId): Promise<Journal>;
    listJournals(ctx: TenantContext, filter?: {
        status?: JournalStatus;
        periodCode?: string;
        source?: string;
    }): Promise<Journal[]>;
}
//# sourceMappingURL=journal-service.d.ts.map