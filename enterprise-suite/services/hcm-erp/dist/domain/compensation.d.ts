import { AggregateRoot, type IsoDateTime, type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "./common.js";
import type { PayFrequency } from "./employment-contract.js";
export type SalaryChangeReason = "initial" | "merit" | "promotion" | "market_adjustment" | "demotion";
export type AllowanceRecurrence = "per_pay_period" | "annual";
export declare const PERIODS_PER_YEAR: Record<PayFrequency, number>;
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
export declare class CompensationRecord extends AggregateRoot<CompensationRecordProps> {
    private constructor();
    static initialize(tenantId: TenantId, input: {
        employeeId: Ulid;
        annualBaseSalary: Money;
        payFrequency: PayFrequency;
        effectiveDate: IsoDate;
        changedBy: Ulid;
    }): CompensationRecord;
    get employeeId(): Ulid;
    get baseSalary(): Money;
    get payFrequency(): PayFrequency;
    get allowances(): readonly Allowance[];
    get revisions(): readonly SalaryRevision[];
    changeSalary(input: {
        newAnnualSalary: Money;
        effectiveDate: IsoDate;
        reason: Exclude<SalaryChangeReason, "initial">;
        changedBy: Ulid;
        note?: string;
    }): SalaryRevision;
    addAllowance(input: {
        code: string;
        name: string;
        amount: Money;
        recurrence: AllowanceRecurrence;
    }): void;
    removeAllowance(code: string): void;
    /** Gross base pay for a single pay period (rounded to minor units). */
    perPeriodBase(): Money;
}
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
export declare class BonusAward extends AggregateRoot<BonusAwardProps> {
    private constructor();
    static award(tenantId: TenantId, input: {
        employeeId: Ulid;
        kind: BonusKind;
        amount: Money;
        awardedBy: Ulid;
        payoutDate: IsoDate;
        note?: string;
    }): BonusAward;
    get employeeId(): Ulid;
    get status(): BonusStatus;
    get amount(): Money;
    get kind(): BonusKind;
    get payoutDate(): IsoDate;
    markPaid(): void;
    cancel(note: string): void;
}
/**
 * PLACEHOLDER deduction table. Rates are illustrative only and carry an
 * explicit `stub: true` marker on every derived line. A real payroll/tax
 * engine (jurisdiction tables, brackets, YTD caps, benefits) plugs in behind
 * `PayslipCalculator` later; nothing else in the domain may depend on these
 * numbers.
 */
export declare const STUB_DEDUCTION_TABLE: {
    readonly incomeTaxRate: 0.2;
    readonly socialSecurityRate: 0.06;
    /** Per-period cap on the social security assessment base, in minor units. */
    readonly socialSecurityCapMinor: 1000000;
    readonly pensionEmployeeRate: 0.04;
    readonly pensionEmployerRate: 0.09;
};
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
export declare function calculatePayslipStub(input: {
    record: CompensationRecord;
    periodLabel: string;
    bonusesDue?: readonly BonusAward[];
}): PayslipStub;
//# sourceMappingURL=compensation.d.ts.map