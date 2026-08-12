import {
  AggregateRoot,
  envelope,
  err,
  ok,
  type CurrencyCode,
  type IsoDateTime,
  type Result,
  type TenantId,
  type UserId,
  nowIso,
} from "@enterprise-suite/shared-kernel";
import {
  assertIsoDate,
  isIsoDate,
  newJournalId,
  type AccountId,
  type CostCenterId,
  type IsoDate,
  type JournalId,
} from "./ids.js";
import { FinanceEventTypes, type JournalPostedPayload } from "./events.js";

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

function validateLine(input: JournalLineInput, index: number): Result<JournalLine> {
  const debit = input.debitMinor ?? 0;
  const credit = input.creditMinor ?? 0;
  if (!Number.isInteger(debit) || !Number.isInteger(credit)) {
    return err(`line ${index + 1}: amounts must be integer minor units`);
  }
  if (debit < 0 || credit < 0) {
    return err(`line ${index + 1}: amounts must be non-negative`);
  }
  if (debit > 0 && credit > 0) {
    return err(`line ${index + 1}: a line cannot carry both a debit and a credit`);
  }
  if (debit === 0 && credit === 0) {
    return err(`line ${index + 1}: a line must carry a debit or a credit`);
  }
  return ok({
    lineNo: index + 1,
    accountId: input.accountId,
    accountCode: input.accountCode,
    costCenterId: input.costCenterId,
    description: input.description,
    debitMinor: debit,
    creditMinor: credit,
  });
}

export class Journal extends AggregateRoot<JournalProps> {
  private constructor(tenantId: TenantId, props: JournalProps, id?: JournalId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static create(tenantId: TenantId, input: CreateJournalInput): Result<Journal> {
    if (!isIsoDate(input.journalDate)) {
      return err(`journalDate must be an ISO date (yyyy-mm-dd), got "${input.journalDate}"`);
    }
    if (input.lines.length < 2) {
      return err("a journal requires at least two lines (double-entry)");
    }
    const lines: JournalLine[] = [];
    for (let i = 0; i < input.lines.length; i++) {
      const parsed = validateLine(input.lines[i], i);
      if (!parsed.ok) return parsed;
      lines.push(parsed.value);
    }
    const totalDebit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const totalCredit = lines.reduce((s, l) => s + l.creditMinor, 0);
    if (totalDebit !== totalCredit) {
      return err(
        `journal is unbalanced: debits ${totalDebit} != credits ${totalCredit} (${input.currency})`,
      );
    }

    return ok(new Journal(tenantId, {
      journalNo: input.journalNo,
      journalDate: assertIsoDate(input.journalDate, "journalDate"),
      periodCode: input.periodCode,
      currency: input.currency,
      source: input.source ?? "MANUAL",
      status: "DRAFT",
      memo: input.memo,
      lines,
    }, newJournalId()));
  }

  get journalNo(): string { return this.props.journalNo; }
  get journalDate(): IsoDate { return this.props.journalDate; }
  get periodCode(): string { return this.props.periodCode; }
  get currency(): CurrencyCode { return this.props.currency; }
  get status(): JournalStatus { return this.props.status; }
  get source(): JournalSource { return this.props.source; }
  get lines(): readonly JournalLine[] { return this.props.lines; }
  get reversalOfId(): JournalId | undefined { return this.props.reversalOfId; }
  get reversedById(): JournalId | undefined { return this.props.reversedById; }

  totalDebitMinor(): number {
    return this.props.lines.reduce((s, l) => s + l.debitMinor, 0);
  }

  totalCreditMinor(): number {
    return this.props.lines.reduce((s, l) => s + l.creditMinor, 0);
  }

  isBalanced(): boolean {
    return this.totalDebitMinor() === this.totalCreditMinor();
  }

  post(postedBy: UserId): Result<void> {
    if (this.props.status !== "DRAFT") {
      return err(`journal ${this.props.journalNo} is ${this.props.status}, only DRAFT can be posted`);
    }
    if (!this.isBalanced()) {
      return err(`journal ${this.props.journalNo} is unbalanced and cannot be posted`);
    }
    this.props = { ...this.props, status: "POSTED", postedAt: nowIso(), postedBy };
    const payload: JournalPostedPayload = {
      journalId: this.id,
      journalNo: this.props.journalNo,
      periodCode: this.props.periodCode,
      source: this.props.source,
      currency: this.props.currency,
      totalDebitMinor: this.totalDebitMinor(),
      totalCreditMinor: this.totalCreditMinor(),
      lineCount: this.props.lines.length,
    };
    this.raise(envelope({
      eventType: FinanceEventTypes.JournalPosted,
      aggregateType: "Journal",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload,
    }));
    return ok(undefined);
  }

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
  }): Result<Journal> {
    if (this.props.status !== "POSTED") {
      return err(`journal ${this.props.journalNo} is ${this.props.status}, only POSTED can be reversed`);
    }
    const reversal = Journal.create(this.tenantId, {
      journalNo: input.journalNo,
      journalDate: input.journalDate,
      periodCode: input.periodCode,
      currency: this.props.currency,
      source: this.props.source,
      memo: input.memo ?? `Reversal of ${this.props.journalNo}`,
      lines: this.props.lines.map((l) => ({
        accountId: l.accountId,
        accountCode: l.accountCode,
        costCenterId: l.costCenterId,
        description: l.description,
        debitMinor: l.creditMinor,
        creditMinor: l.debitMinor,
      })),
    });
    if (!reversal.ok) return reversal;
    reversal.value.props = { ...reversal.value.props, reversalOfId: this.id };

    this.props = { ...this.props, status: "REVERSED", reversedById: reversal.value.id };
    this.raise(envelope({
      eventType: FinanceEventTypes.JournalReversed,
      aggregateType: "Journal",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        journalId: this.id,
        journalNo: this.props.journalNo,
        reversedByJournalId: reversal.value.id,
      },
    }));
    return ok(reversal.value);
  }
}
