import { AggregateRoot, DomainError, envelope, newId, } from "@enterprise-suite/shared-kernel";
import { monthOf, round2, timeToMinutes, yearOf, } from "./common.js";
import { HcmEvents } from "./events.js";
const TIMED_KINDS = ["work", "remote", "training"];
const MAX_DAILY_HOURS = 16;
export const STANDARD_DAILY_HOURS = 8;
export class AttendancePeriod extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static openPeriod(tenantId, employeeId, year, month) {
        if (month < 1 || month > 12)
            throw new DomainError(`Invalid month: ${month}`, "INVALID_MONTH");
        if (year < 1900 || year > 2200)
            throw new DomainError(`Implausible year: ${year}`, "INVALID_YEAR");
        const period = new AttendancePeriod(tenantId, {
            employeeId,
            year,
            month,
            status: "open",
            entries: [],
        });
        period.raise(envelope({
            eventType: HcmEvents.AttendancePeriodOpened,
            aggregateType: "AttendancePeriod",
            aggregateId: period.id,
            tenantId,
            payload: { employeeId, year, month },
        }));
        return period;
    }
    get employeeId() {
        return this.props.employeeId;
    }
    get year() {
        return this.props.year;
    }
    get month() {
        return this.props.month;
    }
    get status() {
        return this.props.status;
    }
    get entries() {
        return this.props.entries;
    }
    addEntry(input) {
        this.assertOpen();
        if (yearOf(input.date) !== this.props.year || monthOf(input.date) !== this.props.month) {
            throw new DomainError(`Entry date ${input.date} is outside period ${this.props.year}-${String(this.props.month).padStart(2, "0")}`, "ENTRY_OUTSIDE_PERIOD");
        }
        const breakMinutes = input.breakMinutes ?? 0;
        if (breakMinutes < 0)
            throw new DomainError("Break minutes cannot be negative", "INVALID_BREAK");
        let hours = 0;
        if (TIMED_KINDS.includes(input.kind)) {
            if (!input.startTime || !input.endTime) {
                throw new DomainError(`A ${input.kind} entry requires start and end times`, "ENTRY_TIMES_REQUIRED");
            }
            const startMin = timeToMinutes(input.startTime);
            const endMin = timeToMinutes(input.endTime);
            if (endMin <= startMin) {
                throw new DomainError(`Entry end time ${input.endTime} must be after start time ${input.startTime}`, "INVALID_ENTRY_TIMES");
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
                throw new DomainError(`Total hours on ${input.date} would reach ${dayTotal}h (limit ${MAX_DAILY_HOURS}h)`, "EXCESSIVE_HOURS");
            }
        }
        else {
            if (input.startTime || input.endTime) {
                throw new DomainError(`A ${input.kind} day marker cannot carry times`, "MARKER_WITH_TIMES");
            }
            if (this.props.entries.some((e) => e.date === input.date)) {
                throw new DomainError(`Cannot add a ${input.kind} marker: ${input.date} already has entries`, "MARKER_CONFLICT", 409);
            }
        }
        const markerOnDate = this.props.entries.find((e) => e.date === input.date && !TIMED_KINDS.includes(e.kind));
        if (markerOnDate) {
            throw new DomainError(`${input.date} is already marked as ${markerOnDate.kind}`, "MARKER_CONFLICT", 409);
        }
        const entry = {
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
    removeEntry(entryId) {
        this.assertOpen();
        const idx = this.props.entries.findIndex((e) => e.entryId === entryId);
        if (idx === -1) {
            throw new DomainError(`Attendance entry not found: ${entryId}`, "ENTRY_NOT_FOUND", 404);
        }
        this.props.entries.splice(idx, 1);
        this.touch();
    }
    totals() {
        let totalHours = 0;
        let overtimeHours = 0;
        const workedDates = new Set();
        let absenceDays = 0;
        const byDate = new Map();
        for (const entry of this.props.entries) {
            if (TIMED_KINDS.includes(entry.kind)) {
                totalHours += entry.hours;
                workedDates.add(entry.date);
                byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + entry.hours);
            }
            else if (entry.kind === "leave" || entry.kind === "sick") {
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
    hoursOn(date) {
        return this.props.entries
            .filter((e) => e.date === date)
            .reduce((sum, e) => sum + e.hours, 0);
    }
    assertNoTimeOverlap(date, startMin, endMin) {
        for (const entry of this.props.entries) {
            if (entry.date !== date || !entry.startTime || !entry.endTime)
                continue;
            const s = timeToMinutes(entry.startTime);
            const e = timeToMinutes(entry.endTime);
            if (startMin < e && s < endMin) {
                throw new DomainError(`Entry ${entry.startTime}-${entry.endTime} on ${date} overlaps the new entry`, "ENTRY_OVERLAP", 409);
            }
        }
    }
    submit() {
        this.assertOpen();
        if (this.props.entries.length === 0) {
            throw new DomainError("Cannot submit an attendance period with no entries", "EMPTY_PERIOD");
        }
        this.props.status = "submitted";
        this.props.submittedAt = new Date().toISOString();
        this.raise(envelope({
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
        }));
    }
    /** Sends a submitted period back for correction. */
    reopen(note) {
        if (this.props.status !== "submitted") {
            throw new DomainError(`Only submitted periods can be reopened (status: ${this.props.status})`, "INVALID_STATUS_TRANSITION", 409);
        }
        this.props.status = "open";
        this.raise(envelope({
            eventType: HcmEvents.AttendanceReopened,
            aggregateType: "AttendancePeriod",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId: this.props.employeeId, note },
        }));
    }
    approve(approverId) {
        if (this.props.status !== "submitted") {
            throw new DomainError(`Only submitted periods can be approved (status: ${this.props.status})`, "INVALID_STATUS_TRANSITION", 409);
        }
        if (approverId === this.props.employeeId) {
            throw new DomainError("Employees cannot approve their own attendance", "SELF_APPROVAL", 403);
        }
        this.props.status = "approved";
        this.props.approvedBy = approverId;
        const totals = this.totals();
        this.raise(envelope({
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
        }));
    }
    /** Final state, typically after payroll export. */
    lock() {
        if (this.props.status !== "approved") {
            throw new DomainError(`Only approved periods can be locked (status: ${this.props.status})`, "INVALID_STATUS_TRANSITION", 409);
        }
        this.props.status = "locked";
        this.raise(envelope({
            eventType: HcmEvents.AttendanceLocked,
            aggregateType: "AttendancePeriod",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId: this.props.employeeId, year: this.props.year, month: this.props.month },
        }));
    }
    assertOpen() {
        if (this.props.status !== "open") {
            throw new DomainError(`Attendance period is ${this.props.status}; entries can only change while open`, "PERIOD_NOT_OPEN", 409);
        }
    }
}
//# sourceMappingURL=attendance.js.map