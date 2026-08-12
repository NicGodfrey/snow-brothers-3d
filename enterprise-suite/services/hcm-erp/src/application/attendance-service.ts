import {
  ConflictError,
  NotFoundError,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  AttendancePeriod,
  type AttendanceEntry,
  type AttendanceEntryKind,
  type AttendanceTotals,
} from "../domain/attendance.js";
import type { IsoDate, TimeOfDay } from "../domain/common.js";
import type { AttendancePeriodRepository, EmployeeRepository, EventOutbox } from "./ports.js";

export class AttendanceService {
  constructor(
    private readonly periods: AttendancePeriodRepository,
    private readonly employees: EmployeeRepository,
    private readonly outbox: EventOutbox,
  ) {}

  openPeriod(tenantId: TenantId, employeeId: Ulid, year: number, month: number): AttendancePeriod {
    const employee = this.employees.findById(tenantId, employeeId);
    if (!employee) throw new NotFoundError("Employee", employeeId);
    if (!employee.isEmployed()) {
      throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
    }
    if (this.periods.find(tenantId, employeeId, year, month)) {
      throw new ConflictError(
        `Attendance period ${year}-${String(month).padStart(2, "0")} already exists for this employee`,
      );
    }
    const period = AttendancePeriod.openPeriod(tenantId, employeeId, year, month);
    this.periods.save(period);
    this.outbox.append(period.pullEvents());
    return period;
  }

  getPeriod(tenantId: TenantId, id: Ulid): AttendancePeriod {
    const period = this.periods.findById(tenantId, id);
    if (!period) throw new NotFoundError("AttendancePeriod", id);
    return period;
  }

  listPeriods(tenantId: TenantId, employeeId: Ulid): AttendancePeriod[] {
    return this.periods.listByEmployee(tenantId, employeeId);
  }

  addEntry(
    tenantId: TenantId,
    periodId: Ulid,
    input: {
      date: IsoDate;
      kind: AttendanceEntryKind;
      startTime?: TimeOfDay;
      endTime?: TimeOfDay;
      breakMinutes?: number;
      note?: string;
    },
  ): AttendanceEntry {
    const period = this.getPeriod(tenantId, periodId);
    const entry = period.addEntry(input);
    this.periods.save(period);
    return entry;
  }

  removeEntry(tenantId: TenantId, periodId: Ulid, entryId: Ulid): AttendancePeriod {
    const period = this.getPeriod(tenantId, periodId);
    period.removeEntry(entryId);
    this.periods.save(period);
    return period;
  }

  submit(tenantId: TenantId, periodId: Ulid): AttendancePeriod {
    const period = this.getPeriod(tenantId, periodId);
    period.submit();
    this.periods.save(period);
    this.outbox.append(period.pullEvents());
    return period;
  }

  reopen(tenantId: TenantId, periodId: Ulid, note: string): AttendancePeriod {
    const period = this.getPeriod(tenantId, periodId);
    period.reopen(note);
    this.periods.save(period);
    this.outbox.append(period.pullEvents());
    return period;
  }

  approve(tenantId: TenantId, periodId: Ulid, approverId: Ulid): AttendancePeriod {
    const period = this.getPeriod(tenantId, periodId);
    period.approve(approverId);
    this.periods.save(period);
    this.outbox.append(period.pullEvents());
    return period;
  }

  lock(tenantId: TenantId, periodId: Ulid): AttendancePeriod {
    const period = this.getPeriod(tenantId, periodId);
    period.lock();
    this.periods.save(period);
    this.outbox.append(period.pullEvents());
    return period;
  }

  totals(tenantId: TenantId, periodId: Ulid): AttendanceTotals {
    return this.getPeriod(tenantId, periodId).totals();
  }
}
