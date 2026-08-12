import {
  AggregateRoot,
  DomainError,
  Entity,
  envelope,
  money,
  nowIso,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { compareDates, round2, type IsoDate } from "./common.js";
import { HcmEvents } from "./events.js";
import type { PayFrequency } from "./employment-contract.js";

export type SalaryChangeReason = "initial" | "merit" | "promotion" | "market_adjustment" | "demotion";
export type AllowanceRecurrence = "per_pay_period" | "annual";

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  monthly: 12,
  biweekly: 26,
  weekly: 52,
};

export interface Allowance {
  readonly code: string;
  readonly name: string;
  readonly amount: Money;
  readonly recurrence: AllowanceRecurrence;
}

export interface SalaryRevision {
  readonly revisionNumber: number;
  readonly previousSalary?: Money;
  readonly newSalary: Money;
  readonly effectiveDate: IsoDate;
  readonly reason: SalaryChangeReason;
  readonly changedBy: Ulid;
  readonly changedAt: IsoDateTime;
  readonly note?: string;
}

export interface CompensationRecordProps {
  employeeId: Ulid;
  baseSalary: Money;
  payFrequency: PayFrequency;
  allowances: Allowance[];
  revisions: SalaryRevision[];
}

/**
 * The single source of truth for what an employee is paid. `baseSalary` is
 * always the ANNUAL amount in minor units; per-period figures are derived.
 */
export class CompensationRecord extends AggregateRoot<CompensationRecordProps> {
  private constructor(tenantId: TenantId, props: CompensationRecordProps) {
    super(tenantId, props);
  }

  static initialize(
    tenantId: TenantId,
    input: {
      employeeId: Ulid;
      annualBaseSalary: Money;
      payFrequency: PayFrequency;
      effectiveDate: IsoDate;
      changedBy: Ulid;
    },
  ): CompensationRecord {
    if (input.annualBaseSalary.amountMinor <= 0) {
      throw new DomainError("Annual base salary must be positive", "INVALID_SALARY");
    }
    const record = new CompensationRecord(tenantId, {
      employeeId: input.employeeId,
      baseSalary: input.annualBaseSalary,
      payFrequency: input.payFrequency,
      allowances: [],
      revisions: [
        {
          revisionNumber: 1,
          newSalary: input.annualBaseSalary,
          effectiveDate: input.effectiveDate,
          reason: "initial",
          changedBy: input.changedBy,
          changedAt: nowIso(),
        },
      ],
    });
    record.raise(
      envelope({
        eventType: HcmEvents.CompensationInitialized,
        aggregateType: "CompensationRecord",
        aggregateId: record.id,
        tenantId,
        payload: {
          employeeId: input.employeeId,
          annualBaseSalary: input.annualBaseSalary,
          payFrequency: input.payFrequency,
        },
      }),
    );
    return record;
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get baseSalary(): Money {
    return this.props.baseSalary;
  }
  get payFrequency(): PayFrequency {
    return this.props.payFrequency;
  }
  get allowances(): readonly Allowance[] {
    return this.props.allowances;
  }
  get revisions(): readonly SalaryRevision[] {
    return this.props.revisions;
  }

  changeSalary(input: {
    newAnnualSalary: Money;
    effectiveDate: IsoDate;
    reason: Exclude<SalaryChangeReason, "initial">;
    changedBy: Ulid;
    note?: string;
  }): SalaryRevision {
    if (input.newAnnualSalary.amountMinor <= 0) {
      throw new DomainError("Annual base salary must be positive", "INVALID_SALARY");
    }
    if (input.newAnnualSalary.currency !== this.props.baseSalary.currency) {
      throw new DomainError(
        `Salary currency cannot change in a revision (${this.props.baseSalary.currency} → ${input.newAnnualSalary.currency})`,
        "CURRENCY_MISMATCH",
      );
    }
    if (input.newAnnualSalary.amountMinor === this.props.baseSalary.amountMinor) {
      throw new DomainError("New salary equals the current salary", "NO_OP_SALARY_CHANGE");
    }
    const last = this.props.revisions[this.props.revisions.length - 1];
    if (last && compareDates(input.effectiveDate, last.effectiveDate) < 0) {
      throw new DomainError(
        `Salary change effective ${input.effectiveDate} predates the last revision (${last.effectiveDate})`,
        "REVISION_OUT_OF_ORDER",
      );
    }
    if (input.reason === "demotion" && input.newAnnualSalary.amountMinor > this.props.baseSalary.amountMinor) {
      throw new DomainError("A demotion cannot increase salary", "REASON_MISMATCH");
    }
    if (
      (input.reason === "merit" || input.reason === "promotion") &&
      input.newAnnualSalary.amountMinor < this.props.baseSalary.amountMinor
    ) {
      throw new DomainError(`A ${input.reason} change cannot decrease salary`, "REASON_MISMATCH");
    }

    const revision: SalaryRevision = {
      revisionNumber: this.props.revisions.length + 1,
      previousSalary: this.props.baseSalary,
      newSalary: input.newAnnualSalary,
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      changedBy: input.changedBy,
      changedAt: nowIso(),
      note: input.note,
    };
    const previousSalary = this.props.baseSalary;
    this.props.revisions.push(revision);
    this.props.baseSalary = input.newAnnualSalary;
    this.raise(
      envelope({
        eventType: HcmEvents.SalaryChanged,
        aggregateType: "CompensationRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          previousSalary,
          newSalary: input.newAnnualSalary,
          effectiveDate: input.effectiveDate,
          reason: input.reason,
        },
      }),
    );
    return revision;
  }

  addAllowance(input: { code: string; name: string; amount: Money; recurrence: AllowanceRecurrence }): void {
    const code = input.code.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(code)) {
      throw new DomainError(`Invalid allowance code "${input.code}"`, "INVALID_ALLOWANCE_CODE");
    }
    if (this.props.allowances.some((a) => a.code === code)) {
      throw new DomainError(`Allowance "${code}" already exists`, "DUPLICATE_ALLOWANCE", 409);
    }
    if (input.amount.amountMinor <= 0) {
      throw new DomainError("Allowance amount must be positive", "INVALID_ALLOWANCE_AMOUNT");
    }
    if (input.amount.currency !== this.props.baseSalary.currency) {
      throw new DomainError(
        `Allowance currency must match salary currency (${this.props.baseSalary.currency})`,
        "CURRENCY_MISMATCH",
      );
    }
    this.props.allowances.push({
      code,
      name: input.name.trim() || code,
      amount: input.amount,
      recurrence: input.recurrence,
    });
    this.raise(
      envelope({
        eventType: HcmEvents.AllowanceAdded,
        aggregateType: "CompensationRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { employeeId: this.props.employeeId, code, amount: input.amount },
      }),
    );
  }

  removeAllowance(code: string): void {
    const idx = this.props.allowances.findIndex((a) => a.code === code.trim().toLowerCase());
    if (idx === -1) {
      throw new DomainError(`Allowance not found: ${code}`, "ALLOWANCE_NOT_FOUND", 404);
    }
    const [removed] = this.props.allowances.splice(idx, 1);
    this.raise(
      envelope({
        eventType: HcmEvents.AllowanceRemoved,
        aggregateType: "CompensationRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { employeeId: this.props.employeeId, code: removed.code },
      }),
    );
  }

  /** Gross base pay for a single pay period (rounded to minor units). */
  perPeriodBase(): Money {
    const periods = PERIODS_PER_YEAR[this.props.payFrequency];
    return money(Math.round(this.props.baseSalary.amountMinor / periods), this.props.baseSalary.currency);
  }
}

// ---------------------------------------------------------------------------
// BonusAward — one-off payments outside the base salary
// ---------------------------------------------------------------------------

export type BonusKind = "performance" | "signing" | "retention" | "spot";
export type BonusStatus = "pending" | "paid" | "cancelled";

export interface BonusAwardProps {
  employeeId: Ulid;
  kind: BonusKind;
  amount: Money;
  awardedBy: Ulid;
  payoutDate: IsoDate;
  status: BonusStatus;
  note?: string;
}

export class BonusAward extends AggregateRoot<BonusAwardProps> {
  private constructor(tenantId: TenantId, props: BonusAwardProps) {
    super(tenantId, props);
  }

  static award(
    tenantId: TenantId,
    input: {
      employeeId: Ulid;
      kind: BonusKind;
      amount: Money;
      awardedBy: Ulid;
      payoutDate: IsoDate;
      note?: string;
    },
  ): BonusAward {
    if (input.amount.amountMinor <= 0) {
      throw new DomainError("Bonus amount must be positive", "INVALID_BONUS_AMOUNT");
    }
    const bonus = new BonusAward(tenantId, {
      employeeId: input.employeeId,
      kind: input.kind,
      amount: input.amount,
      awardedBy: input.awardedBy,
      payoutDate: input.payoutDate,
      status: "pending",
      note: input.note,
    });
    bonus.raise(
      envelope({
        eventType: HcmEvents.BonusAwarded,
        aggregateType: "BonusAward",
        aggregateId: bonus.id,
        tenantId,
        payload: { employeeId: input.employeeId, kind: input.kind, amount: input.amount },
      }),
    );
    return bonus;
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get status(): BonusStatus {
    return this.props.status;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get kind(): BonusKind {
    return this.props.kind;
  }
  get payoutDate(): IsoDate {
    return this.props.payoutDate;
  }

  markPaid(): void {
    if (this.props.status !== "pending") {
      throw new DomainError(`Bonus is ${this.props.status}, not pending`, "INVALID_STATUS_TRANSITION", 409);
    }
    this.props.status = "paid";
    this.raise(
      envelope({
        eventType: HcmEvents.BonusPaid,
        aggregateType: "BonusAward",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { employeeId: this.props.employeeId, amount: this.props.amount },
      }),
    );
  }

  cancel(note: string): void {
    if (this.props.status !== "pending") {
      throw new DomainError(`Cannot cancel a ${this.props.status} bonus`, "INVALID_STATUS_TRANSITION", 409);
    }
    this.props.status = "cancelled";
    this.props.note = note;
    this.raise(
      envelope({
        eventType: HcmEvents.BonusCancelled,
        aggregateType: "BonusAward",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { employeeId: this.props.employeeId, note },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Payroll STUB — deliberately not a real tax engine
// ---------------------------------------------------------------------------

/**
 * PLACEHOLDER deduction table. Rates are illustrative only and carry an
 * explicit `stub: true` marker on every derived line. A real payroll/tax
 * engine (jurisdiction tables, brackets, YTD caps, benefits) plugs in behind
 * `PayslipCalculator` later; nothing else in the domain may depend on these
 * numbers.
 */
export const STUB_DEDUCTION_TABLE = {
  incomeTaxRate: 0.2,
  socialSecurityRate: 0.06,
  /** Per-period cap on the social security assessment base, in minor units. */
  socialSecurityCapMinor: 1_000_000,
  pensionEmployeeRate: 0.04,
  pensionEmployerRate: 0.09,
} as const;

export type PayslipLineKind = "earning" | "deduction" | "employer_contribution";

export interface PayslipLine {
  readonly code: string;
  readonly description: string;
  readonly kind: PayslipLineKind;
  readonly amountMinor: number;
  /** True when the amount comes from the placeholder deduction table. */
  readonly stub: boolean;
}

export interface PayslipStub {
  readonly employeeId: Ulid;
  readonly periodLabel: string;
  readonly currency: string;
  readonly lines: readonly PayslipLine[];
  readonly grossMinor: number;
  readonly totalDeductionsMinor: number;
  readonly netMinor: number;
  /** Always true: net figures are placeholders until a tax engine is wired in. */
  readonly stub: true;
}

/**
 * Produces a structured payslip preview for one pay period. Earnings (base +
 * allowances + bonuses due in the period) are real; deductions come from the
 * stub table above.
 */
export function calculatePayslipStub(input: {
  record: CompensationRecord;
  periodLabel: string;
  bonusesDue?: readonly BonusAward[];
}): PayslipStub {
  const { record } = input;
  const currency = record.baseSalary.currency as string;
  const periods = PERIODS_PER_YEAR[record.payFrequency];
  const lines: PayslipLine[] = [];

  const baseMinor = Math.round(record.baseSalary.amountMinor / periods);
  lines.push({
    code: "base_salary",
    description: `Base salary (${record.payFrequency})`,
    kind: "earning",
    amountMinor: baseMinor,
    stub: false,
  });

  for (const allowance of record.allowances) {
    const amountMinor =
      allowance.recurrence === "per_pay_period"
        ? allowance.amount.amountMinor
        : Math.round(allowance.amount.amountMinor / periods);
    lines.push({
      code: `allowance_${allowance.code}`,
      description: allowance.name,
      kind: "earning",
      amountMinor,
      stub: false,
    });
  }

  for (const bonus of input.bonusesDue ?? []) {
    if (bonus.status !== "pending") continue;
    if (bonus.amount.currency !== record.baseSalary.currency) {
      throw new DomainError(
        `Bonus currency ${bonus.amount.currency} does not match payroll currency ${currency}`,
        "CURRENCY_MISMATCH",
      );
    }
    lines.push({
      code: `bonus_${bonus.kind}`,
      description: `${bonus.kind} bonus`,
      kind: "earning",
      amountMinor: bonus.amount.amountMinor,
      stub: false,
    });
  }

  const grossMinor = lines
    .filter((l) => l.kind === "earning")
    .reduce((sum, l) => sum + l.amountMinor, 0);

  const t = STUB_DEDUCTION_TABLE;
  const incomeTaxMinor = Math.round(grossMinor * t.incomeTaxRate);
  const ssBaseMinor = Math.min(grossMinor, t.socialSecurityCapMinor);
  const socialSecurityMinor = Math.round(ssBaseMinor * t.socialSecurityRate);
  const pensionEmployeeMinor = Math.round(grossMinor * t.pensionEmployeeRate);
  const pensionEmployerMinor = Math.round(grossMinor * t.pensionEmployerRate);

  lines.push(
    {
      code: "income_tax_stub",
      description: `Income tax (STUB flat ${round2(t.incomeTaxRate * 100)}%)`,
      kind: "deduction",
      amountMinor: incomeTaxMinor,
      stub: true,
    },
    {
      code: "social_security_stub",
      description: `Social security (STUB ${round2(t.socialSecurityRate * 100)}%, capped base)`,
      kind: "deduction",
      amountMinor: socialSecurityMinor,
      stub: true,
    },
    {
      code: "pension_employee_stub",
      description: `Pension employee (STUB ${round2(t.pensionEmployeeRate * 100)}%)`,
      kind: "deduction",
      amountMinor: pensionEmployeeMinor,
      stub: true,
    },
    {
      code: "pension_employer_stub",
      description: `Pension employer (STUB ${round2(t.pensionEmployerRate * 100)}%, informational)`,
      kind: "employer_contribution",
      amountMinor: pensionEmployerMinor,
      stub: true,
    },
  );

  const totalDeductionsMinor = lines
    .filter((l) => l.kind === "deduction")
    .reduce((sum, l) => sum + l.amountMinor, 0);

  return {
    employeeId: record.employeeId,
    periodLabel: input.periodLabel,
    currency,
    lines,
    grossMinor,
    totalDeductionsMinor,
    netMinor: grossMinor - totalDeductionsMinor,
    stub: true,
  };
}
