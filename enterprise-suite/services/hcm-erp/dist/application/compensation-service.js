import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { BonusAward, calculatePayslipStub, CompensationRecord, } from "../domain/compensation.js";
import { firstDayOfMonth, lastDayOfMonth } from "../domain/common.js";
export class CompensationService {
    records;
    bonuses;
    employees;
    outbox;
    constructor(records, bonuses, employees, outbox) {
        this.records = records;
        this.bonuses = bonuses;
        this.employees = employees;
        this.outbox = outbox;
    }
    initialize(tenantId, input) {
        this.requireEmployedEmployee(tenantId, input.employeeId);
        if (this.records.findByEmployee(tenantId, input.employeeId)) {
            throw new ConflictError("Employee already has a compensation record; use a salary change instead");
        }
        const record = CompensationRecord.initialize(tenantId, input);
        this.records.save(record);
        this.outbox.append(record.pullEvents());
        return record;
    }
    getByEmployee(tenantId, employeeId) {
        const record = this.records.findByEmployee(tenantId, employeeId);
        if (!record)
            throw new NotFoundError("CompensationRecord", employeeId);
        return record;
    }
    changeSalary(tenantId, employeeId, input) {
        this.requireEmployedEmployee(tenantId, employeeId);
        const record = this.getByEmployee(tenantId, employeeId);
        record.changeSalary(input);
        this.records.save(record);
        this.outbox.append(record.pullEvents());
        return record;
    }
    addAllowance(tenantId, employeeId, input) {
        const record = this.getByEmployee(tenantId, employeeId);
        record.addAllowance(input);
        this.records.save(record);
        this.outbox.append(record.pullEvents());
        return record;
    }
    removeAllowance(tenantId, employeeId, code) {
        const record = this.getByEmployee(tenantId, employeeId);
        record.removeAllowance(code);
        this.records.save(record);
        this.outbox.append(record.pullEvents());
        return record;
    }
    awardBonus(tenantId, input) {
        this.requireEmployedEmployee(tenantId, input.employeeId);
        const bonus = BonusAward.award(tenantId, input);
        this.bonuses.save(bonus);
        this.outbox.append(bonus.pullEvents());
        return bonus;
    }
    markBonusPaid(tenantId, bonusId) {
        const bonus = this.getBonus(tenantId, bonusId);
        bonus.markPaid();
        this.bonuses.save(bonus);
        this.outbox.append(bonus.pullEvents());
        return bonus;
    }
    cancelBonus(tenantId, bonusId, note) {
        const bonus = this.getBonus(tenantId, bonusId);
        bonus.cancel(note);
        this.bonuses.save(bonus);
        this.outbox.append(bonus.pullEvents());
        return bonus;
    }
    listBonuses(tenantId, employeeId) {
        return this.bonuses.listByEmployee(tenantId, employeeId);
    }
    /**
     * Structured payslip preview for one calendar month. Earnings are real
     * (base + allowances + pending bonuses paying out in the month); all
     * deductions come from the placeholder table and are marked `stub`.
     */
    payslipPreview(tenantId, employeeId, year, month) {
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
    getBonus(tenantId, bonusId) {
        const bonus = this.bonuses.findById(tenantId, bonusId);
        if (!bonus)
            throw new NotFoundError("BonusAward", bonusId);
        return bonus;
    }
    requireEmployedEmployee(tenantId, employeeId) {
        const employee = this.employees.findById(tenantId, employeeId);
        if (!employee)
            throw new NotFoundError("Employee", employeeId);
        if (!employee.isEmployed()) {
            throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
        }
    }
}
//# sourceMappingURL=compensation-service.js.map