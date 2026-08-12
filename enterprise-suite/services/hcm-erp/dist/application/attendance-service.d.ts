import { type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { AttendancePeriod, type AttendanceEntry, type AttendanceEntryKind, type AttendanceTotals } from "../domain/attendance.js";
import type { IsoDate, TimeOfDay } from "../domain/common.js";
import type { AttendancePeriodRepository, EmployeeRepository, EventOutbox } from "./ports.js";
export declare class AttendanceService {
    private readonly periods;
    private readonly employees;
    private readonly outbox;
    constructor(periods: AttendancePeriodRepository, employees: EmployeeRepository, outbox: EventOutbox);
    openPeriod(tenantId: TenantId, employeeId: Ulid, year: number, month: number): AttendancePeriod;
    getPeriod(tenantId: TenantId, id: Ulid): AttendancePeriod;
    listPeriods(tenantId: TenantId, employeeId: Ulid): AttendancePeriod[];
    addEntry(tenantId: TenantId, periodId: Ulid, input: {
        date: IsoDate;
        kind: AttendanceEntryKind;
        startTime?: TimeOfDay;
        endTime?: TimeOfDay;
        breakMinutes?: number;
        note?: string;
    }): AttendanceEntry;
    removeEntry(tenantId: TenantId, periodId: Ulid, entryId: Ulid): AttendancePeriod;
    submit(tenantId: TenantId, periodId: Ulid): AttendancePeriod;
    reopen(tenantId: TenantId, periodId: Ulid, note: string): AttendancePeriod;
    approve(tenantId: TenantId, periodId: Ulid, approverId: Ulid): AttendancePeriod;
    lock(tenantId: TenantId, periodId: Ulid): AttendancePeriod;
    totals(tenantId: TenantId, periodId: Ulid): AttendanceTotals;
}
//# sourceMappingURL=attendance-service.d.ts.map