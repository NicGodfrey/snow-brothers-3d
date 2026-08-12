import {
  ConflictError,
  DomainError,
  NotFoundError,
  type CurrencyCode,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import type { AccountId, CostCenterId, JournalId } from "../domain/ids.js";
import { Journal, type JournalSource, type JournalStatus } from "../domain/journal.js";
import type {
  AccountRepository,
  CostCenterRepository,
  JournalRepository,
  PeriodRepository,
} from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";

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
export class JournalService {
  constructor(
    private readonly journals: JournalRepository,
    private readonly accounts: AccountRepository,
    private readonly costCenters: CostCenterRepository,
    private readonly periods: PeriodRepository,
    private readonly outbox: EventOutbox,
  ) {}

  async createDraft(ctx: TenantContext, command: CreateJournalCommand): Promise<Journal> {
    const period = await this.periods.findByDate(ctx.tenantId, command.journalDate);
    if (!period) {
      throw new NotFoundError("PostingPeriod (for date)", command.journalDate);
    }

    const resolvedLines = [];
    for (const line of command.lines) {
      const account = line.accountId
        ? await this.accounts.findById(ctx.tenantId, line.accountId)
        : line.accountCode
          ? await this.accounts.findByCode(ctx.tenantId, line.accountCode)
          : undefined;
      if (!account) {
        throw new NotFoundError("Account", line.accountId ?? line.accountCode ?? "(missing)");
      }
      if (!account.acceptsPostings()) {
        throw new ConflictError(
          `account ${account.code} (${account.name}) is not postable or inactive`,
        );
      }
      if (account.currency !== command.currency.toUpperCase()) {
        throw new ConflictError(
          `account ${account.code} is denominated in ${account.currency}, journal is ${command.currency.toUpperCase()}`,
        );
      }

      let costCenterId: CostCenterId | undefined;
      if (line.costCenterId || line.costCenterCode) {
        const cc = line.costCenterId
          ? await this.costCenters.findById(ctx.tenantId, line.costCenterId)
          : await this.costCenters.findByCode(ctx.tenantId, line.costCenterCode!);
        if (!cc) {
          throw new NotFoundError("CostCenter", line.costCenterId ?? line.costCenterCode ?? "");
        }
        if (!cc.active) throw new ConflictError(`cost center ${cc.code} is inactive`);
        costCenterId = cc.id;
      }

      resolvedLines.push({
        accountId: account.id,
        accountCode: account.code,
        costCenterId,
        description: line.description,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
      });
    }

    const journal = expectOk(Journal.create(ctx.tenantId, {
      journalNo: await this.journals.nextJournalNo(ctx.tenantId),
      journalDate: command.journalDate,
      periodCode: period.code,
      currency: command.currency.toUpperCase() as CurrencyCode,
      source: command.source,
      memo: command.memo,
      lines: resolvedLines,
    }));
    await this.journals.save(journal);
    return journal;
  }

  async post(ctx: TenantContext, journalId: JournalId): Promise<Journal> {
    const journal = await this.getJournal(ctx, journalId);
    const period = await this.periods.findByCode(ctx.tenantId, journal.periodCode);
    if (!period) throw new NotFoundError("PostingPeriod", journal.periodCode);
    if (!period.acceptsPosting(journal.source)) {
      throw new DomainError(
        `period ${period.code} is ${period.status} and does not accept ${journal.source} postings`,
        "PERIOD_NOT_OPEN",
        422,
      );
    }
    expectOk(journal.post(ctx.userId), "POSTING_REJECTED");
    await this.journals.save(journal);
    this.outbox.publishAll(journal.pullEvents());
    return journal;
  }

  /** Creates and immediately posts — used by subledgers and allocations. */
  async createAndPost(ctx: TenantContext, command: CreateJournalCommand): Promise<Journal> {
    const draft = await this.createDraft(ctx, command);
    return this.post(ctx, draft.id);
  }

  /**
   * Reverses a posted journal. The reversal is dated in the given (or same)
   * date, posted through the normal path, and both sides are cross-linked.
   */
  async reverse(ctx: TenantContext, journalId: JournalId, options?: {
    reversalDate?: string;
    memo?: string;
  }): Promise<{ original: Journal; reversal: Journal }> {
    const original = await this.getJournal(ctx, journalId);
    const reversalDate = options?.reversalDate ?? original.journalDate;
    const period = await this.periods.findByDate(ctx.tenantId, reversalDate);
    if (!period) throw new NotFoundError("PostingPeriod (for date)", reversalDate);
    if (!period.acceptsPosting(original.source)) {
      throw new DomainError(
        `period ${period.code} is ${period.status} and does not accept reversals`,
        "PERIOD_NOT_OPEN",
        422,
      );
    }

    const reversal = expectOk(original.buildReversal({
      journalNo: await this.journals.nextJournalNo(ctx.tenantId),
      journalDate: reversalDate,
      periodCode: period.code,
      memo: options?.memo,
    }), "REVERSAL_REJECTED");

    expectOk(reversal.post(ctx.userId), "POSTING_REJECTED");
    await this.journals.save(reversal);
    await this.journals.save(original);
    this.outbox.publishAll(original.pullEvents());
    this.outbox.publishAll(reversal.pullEvents());
    return { original, reversal };
  }

  async getJournal(ctx: TenantContext, id: JournalId): Promise<Journal> {
    const journal = await this.journals.findById(ctx.tenantId, id);
    if (!journal) throw new NotFoundError("Journal", id);
    return journal;
  }

  async listJournals(ctx: TenantContext, filter?: {
    status?: JournalStatus;
    periodCode?: string;
    source?: string;
  }): Promise<Journal[]> {
    return this.journals.list(ctx.tenantId, filter);
  }
}
