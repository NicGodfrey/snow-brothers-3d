import { AggregateRoot, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate, type TimeOfDay } from "./common.js";
export type AttendancePeriodStatus = "open" | "submitted" | "approved" | "locked";
/**
 * `work`/`remote`/`training` carry hours; the day-marker kinds record an
 * absence or non-working day and carry no hours.
 */
export type AttendanceEntryKind = "work" | "remote" | "training" | "leave" | "sick" | "holiday";
export declare const STANDARD_DAILY_HOURS = 8;
export interface AttendanceEntry {
    readonly entryId: Ulid;
    readonly date: IsoDate;
    readonly kind: AttendanceEntryKind;
    readonly startTime?: TimeOfDay;
    readonly endTime?: TimeOfDay;
    readonly breakMinutes: number;
    /** Net hours (2dp) for timed kinds; 0 for day markers. */
    readonly hours: number;
    readonly note?: string;
}
export interface AttendanceTotals {
    readonly totalHours: number;
    readonly overtimeHours: number;
    readonly workedDays: number;
    readonly absenceDays: number;
}
export interface AttendancePeriodProps {
    employeeId: Ulid;
    year: number;
    month: number;
    status: AttendancePeriodStatus;
    entries: AttendanceEntry[];
    submittedAt?: string;
    approvedBy?: Ulid;
}
export declare class AttendancePeriod extends AggregateRoot<AttendancePeriodProps> {
    private constructor();
    static openPeriod(tenantId: TenantId, employeeId: Ulid, year: number, month: number): AttendancePeriod;
    get employeeId(): Ulid;
    get year(): number;
    get month(): number;
    get status(): AttendancePeriodStatus;
    get entries(): readonly AttendanceEntry[];
    addEntry(input: {
        date: IsoDate;
        kind: AttendanceEntryKind;
        startTime?: TimeOfDay;
        endTime?: TimeOfDay;
        breakMinutes?: number;
        note?: string;
    }): AttendanceEntry;
    removeEntry(entryId: Ulid): void;
    totals(): AttendanceTotals;
    private hoursOn;
    private assertNoTimeOverlap;
    submit(): void;
    /** Sends a submitted period back for correction. */
    reopen(note: string): void;
    approve(approverId: Ulid): void;
    /** Final state, typically after payroll export. */
    lock(): void;
    private assertOpen;
}
//# sourceMappingURL=attendance.d.ts.map