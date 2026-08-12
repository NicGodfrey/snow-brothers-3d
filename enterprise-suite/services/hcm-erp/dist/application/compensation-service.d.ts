import { type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { BonusAward, CompensationRecord, type AllowanceRecurrence, type BonusKind, type PayslipStub, type SalaryChangeReason } from "../domain/compensation.js";
import { type IsoDate } from "../domain/common.js";
import type { PayFrequency } from "../domain/employment-contract.js";
import type { BonusRepository, CompensationRepository, EmployeeRepository, EventOutbox } from "./ports.js";
export declare class CompensationService {
    private readonly records;
    private readonly bonuses;
    private readonly employees;
    private readonly outbox;
    constructor(records: CompensationRepository, bonuses: BonusRepository, employees: EmployeeRepository, outbox: EventOutbox);
    initialize(tenantId: TenantId, input: {
        employeeId: Ulid;
        annualBaseSalary: Money;
        payFrequency: PayFrequency;
        effectiveDate: IsoDate;
        changedBy: Ulid;
    }): CompensationRecord;
    getByEmployee(tenantId: TenantId, employeeId: Ulid): CompensationRecord;
    changeSalary(tenantId: TenantId, employeeId: Ulid, input: {
        newAnnualSalary: Money;
        effectiveDate: IsoDate;
        reason: Exclude<SalaryChangeReason, "initial">;
        changedBy: Ulid;
        note?: string;
    }): CompensationRecord;
    addAllowance(tenantId: TenantId, employeeId: Ulid, input: {
        code: string;
        name: string;
        amount: Money;
        recurrence: AllowanceRecurrence;
    }): CompensationRecord;
    removeAllowance(tenantId: TenantId, employeeId: Ulid, code: string): CompensationRecord;
    awardBonus(tenantId: TenantId, input: {
        employeeId: Ulid;
        kind: BonusKind;
        amount: Money;
        awardedBy: Ulid;
        payoutDate: IsoDate;
        note?: string;
    }): BonusAward;
    markBonusPaid(tenantId: TenantId, bonusId: Ulid): BonusAward;
    cancelBonus(tenantId: TenantId, bonusId: Ulid, note: string): BonusAward;
    listBonuses(tenantId: TenantId, employeeId: Ulid): BonusAward[];
    /**
     * Structured payslip preview for one calendar month. Earnings are real
     * (base + allowances + pending bonuses paying out in the month); all
     * deductions come from the placeholder table and are marked `stub`.
     */
    payslipPreview(tenantId: TenantId, employeeId: Ulid, year: number, month: number): PayslipStub;
    private getBonus;
    private requireEmployedEmployee;
}
//# sourceMappingURL=compensation-service.d.ts.map