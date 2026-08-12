import {
  AggregateRoot,
  addMoney,
  envelope,
  money,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { fiscalPeriod, parseIso, type FiscalPeriod } from "./dates.js";
import { BudgetExhaustedError, InvalidStateError, ValidationError } from "./errors.js";
import { PrmEventTypes } from "./events.js";
import { assertSameCurrency, requirePositive, subtract, sum, zero } from "./money.js";

/**
 * Market Development Fund budget: a pot of money for one fiscal period,
 * carved into per-partner allocations.
 *
 * Each allocation is a small three-column ledger — allocated, committed, paid:
 *
 *   available = allocated − committed − paid
 *
 * An approved fund request *commits* money (it is no longer spendable but not
 * yet spent), a paid claim moves committed → paid, and a closed or rejected
 * request releases the commitment back. Every mutation keeps the identity
 * above true, which is what stops the classic MDF failure mode of approving
 * more activity than the program can fund.
 */

export type MdfBudgetStatus = "draft" | "open" | "closed";

export const MDF_BUDGET_STATUSES: readonly MdfBudgetStatus[] = ["draft", "open", "closed"];

export interface MdfAllocation {
  readonly id: Ulid;
  readonly partnerId: Ulid;
  readonly amount: Money;
  readonly committed: Money;
  readonly paid: Money;
  readonly allocatedAt: IsoDateTime;
  readonly note?: string;
}

export interface MdfBudgetProps {
  code: string;
  name: string;
  period: string;
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  currency: string;
  status: MdfBudgetStatus;
  total: Money;
  /** Days after the activity ends in which a claim must be filed. */
  claimWindowDays: number;
  /** Partner's own co-investment share of an activity, in basis points. */
  matchingRateBps: number;
  allocations: MdfAllocation[];
  openedAt?: IsoDateTime;
  closedAt?: IsoDateTime;
  closedBy?: UserId;
}

export interface CreateMdfBudgetInput {
  readonly code: string;
  readonly name: string;
  /** Fiscal period label such as `FY26-Q1`. */
  readonly period: string;
  readonly fiscalYearStartMonth?: number;
  readonly total: Money;
  readonly claimWindowDays?: number;
  readonly matchingRateBps?: number;
}

export interface AllocateInput {
  readonly partnerId: Ulid;
  readonly amount: Money;
  readonly at: IsoDateTime;
  readonly note?: string;
}

export class MdfBudget extends AggregateRoot<MdfBudgetProps> {
  static create(tenantId: TenantId, input: CreateMdfBudgetInput): MdfBudget {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,30}$/.test(code)) {
      throw ValidationError.single("code", "must be an uppercase budget code");
    }
    if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");
    const period: FiscalPeriod = fiscalPeriod(input.period, input.fiscalYearStartMonth ?? 1);
    requirePositive(input.total, "total");
    const claimWindowDays = input.claimWindowDays ?? 60;
    if (!Number.isInteger(claimWindowDays) || claimWindowDays < 1 || claimWindowDays > 365) {
      throw ValidationError.single("claimWindowDays", "must be an integer between 1 and 365");
    }
    const matchingRateBps = input.matchingRateBps ?? 5000;
    if (!Number.isInteger(matchingRateBps) || matchingRateBps < 0 || matchingRateBps > 10_000) {
      throw ValidationError.single("matchingRateBps", "must be an integer between 0 and 10000");
    }

    const budget = new MdfBudget(tenantId, {
      code,
      name: input.name.trim(),
      period: period.code,
      periodStart: period.start,
      periodEnd: period.end,
      currency: input.total.currency,
      status: "draft",
      total: input.total,
      claimWindowDays,
      matchingRateBps,
      allocations: [],
    });
    budget.raise(budget.budgetEvent(PrmEventTypes.MdfBudgetCreated));
    return budget;
  }

  static fromSnapshot(snapshot: EntityProps & MdfBudgetProps): MdfBudget {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new MdfBudget(
      tenantId,
      { ...props, allocations: [...props.allocations] },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -------------------------------------------------------------

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get period(): string {
    return this.props.period;
  }
  get periodStart(): IsoDateTime {
    return this.props.periodStart;
  }
  get periodEnd(): IsoDateTime {
    return this.props.periodEnd;
  }
  get currency(): string {
    return this.props.currency;
  }
  get status(): MdfBudgetStatus {
    return this.props.status;
  }
  get total(): Money {
    return this.props.total;
  }
  get claimWindowDays(): number {
    return this.props.claimWindowDays;
  }
  get matchingRateBps(): number {
    return this.props.matchingRateBps;
  }
  get allocations(): readonly MdfAllocation[] {
    return this.props.allocations;
  }

  allocationById(id: Ulid): MdfAllocation | undefined {
    return this.props.allocations.find((a) => a.id === id);
  }

  allocationForPartner(partnerId: Ulid): MdfAllocation | undefined {
    return this.props.allocations.find((a) => a.partnerId === partnerId);
  }

  allocatedTotal(): Money {
    return sum(
      this.props.allocations.map((a) => a.amount),
      this.props.currency,
    );
  }

  committedTotal(): Money {
    return sum(
      this.props.allocations.map((a) => a.committed),
      this.props.currency,
    );
  }

  paidTotal(): Money {
    return sum(
      this.props.allocations.map((a) => a.paid),
      this.props.currency,
    );
  }

  /** Budget money not yet carved into an allocation. */
  unallocated(): Money {
    return subtract(this.props.total, this.allocatedTotal());
  }

  /** Allocation money still free to commit. */
  allocationAvailable(allocationId: Ulid): Money {
    const allocation = this.requireAllocation(allocationId);
    return subtract(allocation.amount, addMoney(allocation.committed, allocation.paid));
  }

  /** Whole-budget view used by the funds dashboard. */
  summary(): {
    readonly total: Money;
    readonly allocated: Money;
    readonly unallocated: Money;
    readonly committed: Money;
    readonly paid: Money;
    readonly available: Money;
  } {
    const allocated = this.allocatedTotal();
    const committed = this.committedTotal();
    const paid = this.paidTotal();
    return {
      total: this.props.total,
      allocated,
      unallocated: subtract(this.props.total, allocated),
      committed,
      paid,
      available: subtract(allocated, addMoney(committed, paid)),
    };
  }

  // --- lifecycle -------------------------------------------------------------

  open(at: IsoDateTime): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`Budget ${this.props.code} is ${this.props.status}, not draft`);
    }
    this.props.status = "open";
    this.props.openedAt = parseIso(at, "at");
    this.raise(this.budgetEvent(PrmEventTypes.MdfBudgetOpened));
  }

  topUp(amount: Money, reason: string): void {
    this.assertOpen("top up the budget");
    requirePositive(amount, "amount");
    assertSameCurrency(this.props.total, amount);
    if (reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.total = addMoney(this.props.total, amount);
    this.raise(
      envelope({
        eventType: PrmEventTypes.MdfBudgetToppedUp,
        aggregateType: "MdfBudget",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          budgetId: this.id,
          code: this.props.code,
          period: this.props.period,
          amount,
          total: this.props.total,
          reason: reason.trim(),
        },
      }),
    );
  }

  /** Closing is refused while money is still committed but unpaid. */
  close(at: IsoDateTime, by: UserId): void {
    this.assertOpen("close the budget");
    const committed = this.committedTotal();
    if (committed.amountMinor !== 0) {
      throw new InvalidStateError(
        `Budget ${this.props.code} still has committed funds; settle or release them before closing`,
        { committed },
      );
    }
    this.props.status = "closed";
    this.props.closedAt = parseIso(at, "at");
    this.props.closedBy = by;
    this.raise(this.budgetEvent(PrmEventTypes.MdfBudgetClosed));
  }

  // --- allocations -----------------------------------------------------------

  allocate(input: AllocateInput): MdfAllocation {
    this.assertOpen("allocate funds");
    requirePositive(input.amount, "amount");
    assertSameCurrency(this.props.total, input.amount);
    if (this.allocationForPartner(input.partnerId)) {
      throw new InvalidStateError(
        `Partner ${input.partnerId} already has an allocation in ${this.props.code}; adjust it instead`,
      );
    }
    const unallocated = this.unallocated();
    if (input.amount.amountMinor > unallocated.amountMinor) {
      throw new BudgetExhaustedError(
        `Budget ${this.props.code}`,
        input.amount.amountMinor,
        unallocated.amountMinor,
        this.props.currency,
      );
    }
    const allocation: MdfAllocation = {
      id: newId("mdfalloc"),
      partnerId: input.partnerId,
      amount: input.amount,
      committed: zero(this.props.currency),
      paid: zero(this.props.currency),
      allocatedAt: parseIso(input.at, "at"),
      note: input.note?.trim() || undefined,
    };
    this.props.allocations.push(allocation);
    this.raise(
      envelope({
        eventType: PrmEventTypes.MdfAllocationCreated,
        aggregateType: "MdfBudget",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          budgetId: this.id,
          allocationId: allocation.id,
          partnerId: allocation.partnerId,
          amount: allocation.amount,
          budgetAvailable: this.unallocated(),
        },
      }),
    );
    return allocation;
  }

  /** Re-sizes an allocation; it can never shrink below what is already spoken for. */
  adjustAllocation(allocationId: Ulid, amount: Money, reason: string): MdfAllocation {
    this.assertOpen("adjust an allocation");
    requirePositive(amount, "amount");
    assertSameCurrency(this.props.total, amount);
    if (reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    const index = this.requireAllocationIndex(allocationId);
    const current = this.props.allocations[index]!;
    const spokenFor = addMoney(current.committed, current.paid);
    if (amount.amountMinor < spokenFor.amountMinor) {
      throw new InvalidStateError(
        `Allocation already has ${spokenFor.amountMinor} ${this.props.currency} committed or paid`,
        { requested: amount, spokenFor },
      );
    }
    const delta = amount.amountMinor - current.amount.amountMinor;
    if (delta > 0) {
      const unallocated = this.unallocated();
      if (delta > unallocated.amountMinor) {
        throw new BudgetExhaustedError(
          `Budget ${this.props.code}`,
          delta,
          unallocated.amountMinor,
          this.props.currency,
        );
      }
    }
    const updated: MdfAllocation = { ...current, amount };
    this.props.allocations[index] = updated;
    this.raise(
      envelope({
        eventType: PrmEventTypes.MdfAllocationAdjusted,
        aggregateType: "MdfBudget",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          budgetId: this.id,
          allocationId,
          partnerId: updated.partnerId,
          amount,
          previousAmount: current.amount,
          reason: reason.trim(),
        },
      }),
    );
    return updated;
  }

  // --- fund ledger -----------------------------------------------------------

  /** Reserves money for an approved fund request. */
  commit(allocationId: Ulid, amount: Money, reference: Ulid): MdfAllocation {
    this.assertOpen("commit funds");
    requirePositive(amount, "amount");
    assertSameCurrency(this.props.total, amount);
    const index = this.requireAllocationIndex(allocationId);
    const current = this.props.allocations[index]!;
    const available = subtract(current.amount, addMoney(current.committed, current.paid));
    if (amount.amountMinor > available.amountMinor) {
      throw new BudgetExhaustedError(
        `Allocation ${allocationId}`,
        amount.amountMinor,
        available.amountMinor,
        this.props.currency,
      );
    }
    const updated: MdfAllocation = { ...current, committed: addMoney(current.committed, amount) };
    this.props.allocations[index] = updated;
    this.raise(this.ledgerEvent(PrmEventTypes.MdfFundsCommitted, updated, amount, reference));
    return updated;
  }

  /** Gives committed money back (rejected claim, unspent activity, cancellation). */
  releaseCommitment(allocationId: Ulid, amount: Money, reference: Ulid): MdfAllocation {
    if (this.props.status === "draft") {
      throw new InvalidStateError(`Budget ${this.props.code} is draft; nothing can be committed yet`);
    }
    requirePositive(amount, "amount");
    assertSameCurrency(this.props.total, amount);
    const index = this.requireAllocationIndex(allocationId);
    const current = this.props.allocations[index]!;
    if (amount.amountMinor > current.committed.amountMinor) {
      throw new InvalidStateError(
        `Cannot release ${amount.amountMinor}; only ${current.committed.amountMinor} is committed`,
        { committed: current.committed, requested: amount },
      );
    }
    const updated: MdfAllocation = { ...current, committed: subtract(current.committed, amount) };
    this.props.allocations[index] = updated;
    this.raise(this.ledgerEvent(PrmEventTypes.MdfCommitmentReleased, updated, amount, reference));
    return updated;
  }

  /** Settles a paid claim: committed → paid. */
  settle(allocationId: Ulid, amount: Money, reference: Ulid): MdfAllocation {
    if (this.props.status !== "open") {
      throw new InvalidStateError(`Budget ${this.props.code} is ${this.props.status}; payments need an open budget`);
    }
    requirePositive(amount, "amount");
    assertSameCurrency(this.props.total, amount);
    const index = this.requireAllocationIndex(allocationId);
    const current = this.props.allocations[index]!;
    if (amount.amountMinor > current.committed.amountMinor) {
      throw new InvalidStateError(
        `Cannot pay ${amount.amountMinor}; only ${current.committed.amountMinor} is committed`,
        { committed: current.committed, requested: amount },
      );
    }
    const updated: MdfAllocation = {
      ...current,
      committed: subtract(current.committed, amount),
      paid: addMoney(current.paid, amount),
    };
    this.props.allocations[index] = updated;
    this.raise(this.ledgerEvent(PrmEventTypes.MdfFundsPaid, updated, amount, reference));
    return updated;
  }

  /** Cap on one request for a partner, given the tier's per-request share. */
  requestCap(allocationId: Ulid, capBps: number): Money {
    const allocation = this.requireAllocation(allocationId);
    if (!Number.isInteger(capBps) || capBps <= 0 || capBps > 10_000) {
      throw ValidationError.single("capBps", "must be an integer between 1 and 10000");
    }
    return money(Math.round((allocation.amount.amountMinor * capBps) / 10_000), this.props.currency);
  }

  // --- internals -------------------------------------------------------------

  private requireAllocation(allocationId: Ulid): MdfAllocation {
    const allocation = this.allocationById(allocationId);
    if (!allocation) {
      throw new InvalidStateError(`Allocation ${allocationId} is not part of budget ${this.props.code}`);
    }
    return allocation;
  }

  private requireAllocationIndex(allocationId: Ulid): number {
    const index = this.props.allocations.findIndex((a) => a.id === allocationId);
    if (index === -1) {
      throw new InvalidStateError(`Allocation ${allocationId} is not part of budget ${this.props.code}`);
    }
    return index;
  }

  private assertOpen(action: string): void {
    if (this.props.status !== "open") {
      throw new InvalidStateError(`Cannot ${action}: budget ${this.props.code} is ${this.props.status}`);
    }
  }

  private budgetEvent(eventType: string) {
    return envelope({
      eventType,
      aggregateType: "MdfBudget",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        budgetId: this.id,
        code: this.props.code,
        period: this.props.period,
        total: this.props.total,
      },
    });
  }

  private ledgerEvent(eventType: string, allocation: MdfAllocation, amount: Money, reference: Ulid) {
    return envelope({
      eventType,
      aggregateType: "MdfBudget",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        budgetId: this.id,
        allocationId: allocation.id,
        partnerId: allocation.partnerId,
        amount,
        reference,
        allocationAvailable: subtract(allocation.amount, addMoney(allocation.committed, allocation.paid)),
      },
    });
  }
}
