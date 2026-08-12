import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { AttendancePeriod, } from "../domain/attendance.js";
export class AttendanceService {
    periods;
    employees;
    outbox;
    constructor(periods, employees, outbox) {
        this.periods = periods;
        this.employees = employees;
        this.outbox = outbox;
    }
    openPeriod(tenantId, employeeId, year, month) {
        const employee = this.employees.findById(tenantId, employeeId);
        if (!employee)
            throw new NotFoundError("Employee", employeeId);
        if (!employee.isEmployed()) {
            throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
        }
        if (this.periods.find(tenantId, employeeId, year, month)) {
            throw new ConflictError(`Attendance period ${year}-${String(month).padStart(2, "0")} already exists for this employee`);
        }
        const period = AttendancePeriod.openPeriod(tenantId, employeeId, year, month);
        this.periods.save(period);
        this.outbox.append(period.pullEvents());
        return period;
    }
    getPeriod(tenantId, id) {
        const period = this.periods.findById(tenantId, id);
        if (!period)
            throw new NotFoundError("AttendancePeriod", id);
        return period;
    }
    listPeriods(tenantId, employeeId) {
        return this.periods.listByEmployee(tenantId, employeeId);
    }
    addEntry(tenantId, periodId, input) {
        const period = this.getPeriod(tenantId, periodId);
        const entry = period.addEntry(input);
        this.periods.save(period);
        return entry;
    }
    removeEntry(tenantId, periodId, entryId) {
        const period = this.getPeriod(tenantId, periodId);
        period.removeEntry(entryId);
        this.periods.save(period);
        return period;
    }
    submit(tenantId, periodId) {
        const period = this.getPeriod(tenantId, periodId);
        period.submit();
        this.periods.save(period);
        this.outbox.append(period.pullEvents());
        return period;
    }
    reopen(tenantId, periodId, note) {
        const period = this.getPeriod(tenantId, periodId);
        period.reopen(note);
        this.periods.save(period);
        this.outbox.append(period.pullEvents());
        return period;
    }
    approve(tenantId, periodId, approverId) {
        const period = this.getPeriod(tenantId, periodId);
        period.approve(approverId);
        this.periods.save(period);
        this.outbox.append(period.pullEvents());
        return period;
    }
    lock(tenantId, periodId) {
        const period = this.getPeriod(tenantId, periodId);
        period.lock();
        this.periods.save(period);
        this.outbox.append(period.pullEvents());
        return period;
    }
    totals(tenantId, periodId) {
        return this.getPeriod(tenantId, periodId).totals();
    }
}
//# sourceMappingURL=attendance-service.js.map