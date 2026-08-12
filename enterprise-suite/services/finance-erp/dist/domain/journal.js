import { AggregateRoot, envelope, err, ok, nowIso, } from "@enterprise-suite/shared-kernel";
import { assertIsoDate, isIsoDate, newJournalId, } from "./ids.js";
import { FinanceEventTypes } from "./events.js";
function validateLine(input, index) {
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
export class Journal extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static create(tenantId, input) {
        if (!isIsoDate(input.journalDate)) {
            return err(`journalDate must be an ISO date (yyyy-mm-dd), got "${input.journalDate}"`);
        }
        if (input.lines.length < 2) {
            return err("a journal requires at least two lines (double-entry)");
        }
        const lines = [];
        for (let i = 0; i < input.lines.length; i++) {
            const parsed = validateLine(input.lines[i], i);
            if (!parsed.ok)
                return parsed;
            lines.push(parsed.value);
        }
        const totalDebit = lines.reduce((s, l) => s + l.debitMinor, 0);
        const totalCredit = lines.reduce((s, l) => s + l.creditMinor, 0);
        if (totalDebit !== totalCredit) {
            return err(`journal is unbalanced: debits ${totalDebit} != credits ${totalCredit} (${input.currency})`);
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
    get journalNo() { return this.props.journalNo; }
    get journalDate() { return this.props.journalDate; }
    get periodCode() { return this.props.periodCode; }
    get currency() { return this.props.currency; }
    get status() { return this.props.status; }
    get source() { return this.props.source; }
    get lines() { return this.props.lines; }
    get reversalOfId() { return this.props.reversalOfId; }
    get reversedById() { return this.props.reversedById; }
    totalDebitMinor() {
        return this.props.lines.reduce((s, l) => s + l.debitMinor, 0);
    }
    totalCreditMinor() {
        return this.props.lines.reduce((s, l) => s + l.creditMinor, 0);
    }
    isBalanced() {
        return this.totalDebitMinor() === this.totalCreditMinor();
    }
    post(postedBy) {
        if (this.props.status !== "DRAFT") {
            return err(`journal ${this.props.journalNo} is ${this.props.status}, only DRAFT can be posted`);
        }
        if (!this.isBalanced()) {
            return err(`journal ${this.props.journalNo} is unbalanced and cannot be posted`);
        }
        this.props = { ...this.props, status: "POSTED", postedAt: nowIso(), postedBy };
        const payload = {
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
    buildReversal(input) {
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
        if (!reversal.ok)
            return reversal;
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
//# sourceMappingURL=journal.js.map