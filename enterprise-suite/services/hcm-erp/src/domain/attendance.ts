import {
  AggregateRoot,
  DomainError,
  envelope,
  newId,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  monthOf,
  round2,
  timeToMinutes,
  yearOf,
  type IsoDate,
  type TimeOfDay,
} from "./common.js";
import { HcmEvents } from "./events.js";

export type AttendancePeriodStatus = "open" | "submitted" | "approved" | "locked";

/**
 * `work`/`remote`/`training` carry hours; the day-marker kinds record an
 * absence or non-working day and carry no hours.
 */
export type AttendanceEntryKind = "work" | "remote" | "training" | "leave" | "sick" | "holiday";

const TIMED_KINDS: readonly AttendanceEntryKind[] = ["work", "remote", "training"];
const MAX_DAILY_HOURS = 16;
export const STANDARD_DAILY_HOURS = 8;

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

export class AttendancePeriod extends AggregateRoot<AttendancePeriodProps> {
  private constructor(tenantId: TenantId, props: AttendancePeriodProps) {
    super(tenantId, props);
  }

  static openPeriod(tenantId: TenantId, employeeId: Ulid, year: number, month: number): AttendancePeriod {
    if (month < 1 || month > 12) throw new DomainError(`Invalid month: ${month}`, "INVALID_MONTH");
    if (year < 1900 || year > 2200) throw new DomainError(`Implausible year: ${year}`, "INVALID_YEAR");
    const period = new AttendancePeriod(tenantId, {
      employeeId,
      year,
      month,
      status: "open",
      entries: [],
    });
    period.raise(
      envelope({
        eventType: HcmEvents.AttendancePeriodOpened,
        aggregateType: "AttendancePeriod",
        aggregateId: period.id,
        tenantId,
        payload: { employeeId, year, month },
      }),
    );
    return period;
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get year(): number {
    return this.props.year;
  }
  get month(): number {
    return this.props.month;
  }
  get status(): AttendancePeriodStatus {
    return this.props.status;
  }
  get entries(): readonly AttendanceEntry[] {
    return this.props.entries;
  }

  addEntry(input: {
    date: IsoDate;
    kind: AttendanceEntryKind;
    startTime?: TimeOfDay;
    endTime?: TimeOfDay;
    breakMinutes?: number;
    note?: string;
  }): AttendanceEntry {
    this.assertOpen();
    if (yearOf(input.date) !== this.props.year || monthOf(input.date) !== this.props.month) {
      throw new DomainError(
        `Entry date ${input.date} is outside period ${this.props.year}-${String(this.props.month).padStart(2, "0")}`,
        "ENTRY_OUTSIDE_PERIOD",
      );
    }

    const breakMinutes = input.breakMinutes ?? 0;
    if (breakMinutes < 0) throw new DomainError("Break minutes cannot be negative", "INVALID_BREAK");

    let hours = 0;
    if (TIMED_KINDS.includes(input.kind)) {
      if (!input.startTime || !input.endTime) {
        throw new DomainError(`A ${input.kind} entry requires start and end times`, "ENTRY_TIMES_REQUIRED");
      }
      const startMin = timeToMinutes(input.startTime);
      const endMin = timeToMinutes(input.endTime);
      if (endMin <= startMin) {
        throw new DomainError(
          `Entry end time ${input.endTime} must be after start time ${input.startTime}`,
          "INVALID_ENTRY_TIMES",
        );
      }
      const netMinutes = endMin - startMin - breakMinutes;
      if (netMinutes <= 0) {
        throw new DomainError("Break consumes the entire entry duration", "INVALID_BREAK");
      }
      hours = round2(netMinutes / 60);
      if (hours > MAX_DAILY_HOURS) {
        throw new DomainError(`Entry exceeds ${MAX_DAILY_HOURS}h/day limit (${hours}h)`, "EXCESSIVE_HOURS");
      }
      this.assertNoTimeOverlap(input.date, startMin, endMin);
      const dayTotal = round2(this.hoursOn(input.date) + hours);
      if (dayTotal > MAX_DAILY_HOURS) {
        throw new DomainError(
          `Total hours on ${input.date} would reach ${dayTotal}h (limit ${MAX_DAILY_HOURS}h)`,
          "EXCESSIVE_HOURS",
        );
      }
    } else {
      if (input.startTime || input.endTime) {
        throw new DomainError(`A ${input.kind} day marker cannot carry times`, "MARKER_WITH_TIMES");
      }
      if (this.props.entries.some((e) => e.date === input.date)) {
        throw new DomainError(
          `Cannot add a ${input.kind} marker: ${input.date} already has entries`,
          "MARKER_CONFLICT",
          409,
        );
      }
    }
    const markerOnDate = this.props.entries.find(
      (e) => e.date === input.date && !TIMED_KINDS.includes(e.kind),
    );
    if (markerOnDate) {
      throw new DomainError(
        `${input.date} is already marked as ${markerOnDate.kind}`,
        "MARKER_CONFLICT",
        409,
      );
    }

    const entry: AttendanceEntry = {
      entryId: newId("atde"),
      date: input.date,
      kind: input.kind,
      startTime: input.startTime,
      endTime: input.endTime,
      breakMinutes,
      hours,
      note: input.note?.trim() || undefined,
    };
    this.props.entries.push(entry);
    this.props.entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    this.touch();
    return entry;
  }

  removeEntry(entryId: Ulid): void {
    this.assertOpen();
    const idx = this.props.entries.findIndex((e) => e.entryId === entryId);
    if (idx === -1) {
      throw new DomainError(`Attendance entry not found: ${entryId}`, "ENTRY_NOT_FOUND", 404);
    }
    this.props.entries.splice(idx, 1);
    this.touch();
  }

  totals(): AttendanceTotals {
    let totalHours = 0;
    let overtimeHours = 0;
    const workedDates = new Set<string>();
    let absenceDays = 0;
    const byDate = new Map<string, number>();
    for (const entry of this.props.entries) {
      if (TIMED_KINDS.includes(entry.kind)) {
        totalHours += entry.hours;
        workedDates.add(entry.date);
        byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + entry.hours);
      } else if (entry.kind === "leave" || entry.kind === "sick") {
        absenceDays += 1;
      }
    }
    for (const hours of byDate.values()) {
      overtimeHours += Math.max(0, hours - STANDARD_DAILY_HOURS);
    }
    return {
      totalHours: round2(totalHours),
      overtimeHours: round2(overtimeHours),
      workedDays: workedDates.size,
      absenceDays,
    };
  }

  private hoursOn(date: IsoDate): number {
    return this.props.entries
      .filter((e) => e.date === date)
      .reduce((sum, e) => sum + e.hours, 0);
  }

  private assertNoTimeOverlap(date: IsoDate, startMin: number, endMin: number): void {
    for (const entry of this.props.entries) {
      if (entry.date !== date || !entry.startTime || !entry.endTime) continue;
      const s = timeToMinutes(entry.startTime);
      const e = timeToMinutes(entry.endTime);
      if (startMin < e && s < endMin) {
        throw new DomainError(
          `Entry ${entry.startTime}-${entry.endTime} on ${date} overlaps the new entry`,
          "ENTRY_OVERLAP",
          409,
        );
      }
    }
  }

  submit(): void {
    this.assertOpen();
    if (this.props.entries.length === 0) {
      throw new DomainError("Cannot submit an attendance period with no entries", "EMPTY_PERIOD");
    }
    this.props.status = "submitted";
    this.props.submittedAt = new Date().toISOString();
    this.raise(
      envelope({
        eventType: HcmEvents.AttendanceSubmitted,
        aggregateType: "AttendancePeriod",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          year: this.props.year,
          month: this.props.month,
          entryCount: this.props.entries.length,
        },
      }),
    );
  }

  /** Sends a submitted period back for correction. */
  reopen(note: string): void {
    if (this.props.status !== "submitted") {
      throw new DomainError(
        `Only submitted periods can be reopened (status: ${this.props.status})`,
        "INVALID_STATUS_TRANSITION",
        409,
      );
    }
    this.props.status = "open";
    this.raise(
      envelope({
        eventType: HcmEvents.AttendanceReopened,
        aggregateType: "AttendancePeriod",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { employeeId: this.props.employeeId, note },
      }),
    );
  }

  approve(approverId: Ulid): void {
    if (this.props.status !== "submitted") {
      throw new DomainError(
        `Only submitted periods can be approved (status: ${this.props.status})`,
        "INVALID_STATUS_TRANSITION",
        409,
      );
    }
    if (approverId === this.props.employeeId) {
      throw new DomainError("Employees cannot approve their own attendance", "SELF_APPROVAL", 403);
    }
    this.props.status = "approved";
    this.props.approvedBy = approverId;
    const totals = this.totals();
    this.raise(
      envelope({
        eventType: HcmEvents.AttendanceApproved,
        aggregateType: "AttendancePeriod",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          attendancePeriodId: this.id,
          employeeId: this.props.employeeId,
          year: this.props.year,
          month: this.props.month,
          totalHours: totals.totalHours,
          overtimeHours: totals.overtimeHours,
        },
      }),
    );
  }

  /** Final state, typically after payroll export. */
  lock(): void {
    if (this.props.status !== "approved") {
      throw new DomainError(
        `Only approved periods can be locked (status: ${this.props.status})`,
        "INVALID_STATUS_TRANSITION",
        409,
      );
    }
    this.props.status = "locked";
    this.raise(
      envelope({
        eventType: HcmEvents.AttendanceLocked,
        aggregateType: "AttendancePeriod",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { employeeId: this.props.employeeId, year: this.props.year, month: this.props.month },
      }),
    );
  }

  private assertOpen(): void {
    if (this.props.status !== "open") {
      throw new DomainError(
        `Attendance period is ${this.props.status}; entries can only change while open`,
        "PERIOD_NOT_OPEN",
        409,
      );
    }
  }
}
