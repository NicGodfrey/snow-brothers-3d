import {
  ConflictError,
  NotFoundError,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  BonusAward,
  calculatePayslipStub,
  CompensationRecord,
  type AllowanceRecurrence,
  type BonusKind,
  type PayslipStub,
  type SalaryChangeReason,
} from "../domain/compensation.js";
import { firstDayOfMonth, lastDayOfMonth, type IsoDate } from "../domain/common.js";
import type { PayFrequency } from "../domain/employment-contract.js";
import type {
  BonusRepository,
  CompensationRepository,
  EmployeeRepository,
  EventOutbox,
} from "./ports.js";

export class CompensationService {
  constructor(
    private readonly records: CompensationRepository,
    private readonly bonuses: BonusRepository,
    private readonly employees: EmployeeRepository,
    private readonly outbox: EventOutbox,
  ) {}

  initialize(
    tenantId: TenantId,
    input: {
      employeeId: Ulid;
      annualBaseSalary: Money;
      payFrequency: PayFrequency;
      effectiveDate: IsoDate;
      changedBy: Ulid;
    },
  ): CompensationRecord {
    this.requireEmployedEmployee(tenantId, input.employeeId);
    if (this.records.findByEmployee(tenantId, input.employeeId)) {
      throw new ConflictError("Employee already has a compensation record; use a salary change instead");
    }
    const record = CompensationRecord.initialize(tenantId, input);
    this.records.save(record);
    this.outbox.append(record.pullEvents());
    return record;
  }

  getByEmployee(tenantId: TenantId, employeeId: Ulid): CompensationRecord {
    const record = this.records.findByEmployee(tenantId, employeeId);
    if (!record) throw new NotFoundError("CompensationRecord", employeeId);
    return record;
  }

  changeSalary(
    tenantId: TenantId,
    employeeId: Ulid,
    input: {
      newAnnualSalary: Money;
      effectiveDate: IsoDate;
      reason: Exclude<SalaryChangeReason, "initial">;
      changedBy: Ulid;
      note?: string;
    },
  ): CompensationRecord {
    this.requireEmployedEmployee(tenantId, employeeId);
    const record = this.getByEmployee(tenantId, employeeId);
    record.changeSalary(input);
    this.records.save(record);
    this.outbox.append(record.pullEvents());
    return record;
  }

  addAllowance(
    tenantId: TenantId,
    employeeId: Ulid,
    input: { code: string; name: string; amount: Money; recurrence: AllowanceRecurrence },
  ): CompensationRecord {
    const record = this.getByEmployee(tenantId, employeeId);
    record.addAllowance(input);
    this.records.save(record);
    this.outbox.append(record.pullEvents());
    return record;
  }

  removeAllowance(tenantId: TenantId, employeeId: Ulid, code: string): CompensationRecord {
    const record = this.getByEmployee(tenantId, employeeId);
    record.removeAllowance(code);
    this.records.save(record);
    this.outbox.append(record.pullEvents());
    return record;
  }

  awardBonus(
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
    this.requireEmployedEmployee(tenantId, input.employeeId);
    const bonus = BonusAward.award(tenantId, input);
    this.bonuses.save(bonus);
    this.outbox.append(bonus.pullEvents());
    return bonus;
  }

  markBonusPaid(tenantId: TenantId, bonusId: Ulid): BonusAward {
    const bonus = this.getBonus(tenantId, bonusId);
    bonus.markPaid();
    this.bonuses.save(bonus);
    this.outbox.append(bonus.pullEvents());
    return bonus;
  }

  cancelBonus(tenantId: TenantId, bonusId: Ulid, note: string): BonusAward {
    const bonus = this.getBonus(tenantId, bonusId);
    bonus.cancel(note);
    this.bonuses.save(bonus);
    this.outbox.append(bonus.pullEvents());
    return bonus;
  }

  listBonuses(tenantId: TenantId, employeeId: Ulid): BonusAward[] {
    return this.bonuses.listByEmployee(tenantId, employeeId);
  }

  /**
   * Structured payslip preview for one calendar month. Earnings are real
   * (base + allowances + pending bonuses paying out in the month); all
   * deductions come from the placeholder table and are marked `stub`.
   */
  payslipPreview(tenantId: TenantId, employeeId: Ulid, year: number, month: number): PayslipStub {
    const record = this.getByEmployee(tenantId, employeeId);
    const from = firstDayOfMonth(year, month);
    const to = lastDayOfMonth(year, month);
    const bonusesDue = this.bonuses
      .listByEmployee(tenantId, employeeId)
      .filter((b) => b.status === "pending" && b.payoutDate >= from && b.payoutDate <= to);
    return calculatePayslipStub({
      record,
      periodLabel: `${year}-${String(month).padStart(2, "0")}`,
      bonusesDue,
    });
  }

  private getBonus(tenantId: TenantId, bonusId: Ulid): BonusAward {
    const bonus = this.bonuses.findById(tenantId, bonusId);
    if (!bonus) throw new NotFoundError("BonusAward", bonusId);
    return bonus;
  }

  private requireEmployedEmployee(tenantId: TenantId, employeeId: Ulid): void {
    const employee = this.employees.findById(tenantId, employeeId);
    if (!employee) throw new NotFoundError("Employee", employeeId);
    if (!employee.isEmployed()) {
      throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
    }
  }
}
