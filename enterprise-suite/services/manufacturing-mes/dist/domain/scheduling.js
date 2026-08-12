import { brand, DomainError } from "@enterprise-suite/shared-kernel";
import { addDays, weekdayOf } from "./capacity-calendar.js";
const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_GUARD_DAYS = 1095; // ~3 years of calendar walking before giving up
/**
 * Build a windows provider from a shift template plus calendar exceptions.
 * Breaks are modelled by shortening each shift window from its end;
 * DOWNTIME trims minutes from the end of the day, OVERTIME extends the last
 * window (or opens a default 08:00 window on a non-working day).
 */
export function windowsFromCalendar(template, calendar) {
    return (date) => {
        const weekday = weekdayOf(date);
        let windows = template.shifts
            .filter((s) => s.daysOfWeek.includes(weekday))
            .map((s) => ({
            startMinute: s.startMinuteOfDay,
            endMinute: s.startMinuteOfDay + s.durationMinutes - s.breakMinutes,
        }))
            .filter((w) => w.endMinute > w.startMinute)
            .sort((a, b) => a.startMinute - b.startMinute);
        const exception = calendar.exceptions.find((e) => e.date === date);
        if (!exception)
            return windows;
        switch (exception.type) {
            case "HOLIDAY":
                return [];
            case "DOWNTIME": {
                let toTrim = exception.minutes;
                const trimmed = [];
                for (let i = windows.length - 1; i >= 0; i -= 1) {
                    const w = windows[i];
                    const length = w.endMinute - w.startMinute;
                    if (toTrim >= length) {
                        toTrim -= length;
                    }
                    else {
                        trimmed.unshift({ startMinute: w.startMinute, endMinute: w.endMinute - toTrim });
                        toTrim = 0;
                    }
                    if (toTrim === 0 && i > 0)
                        trimmed.unshift(...windows.slice(0, i));
                    if (toTrim === 0)
                        break;
                }
                return trimmed;
            }
            case "OVERTIME": {
                if (windows.length === 0) {
                    const start = 8 * 60;
                    return [{ startMinute: start, endMinute: Math.min(MINUTES_PER_DAY, start + exception.minutes) }];
                }
                const last = windows[windows.length - 1];
                windows = [
                    ...windows.slice(0, -1),
                    {
                        startMinute: last.startMinute,
                        endMinute: Math.min(MINUTES_PER_DAY, last.endMinute + exception.minutes),
                    },
                ];
                return windows;
            }
            default:
                return windows;
        }
    };
}
function toIso(point) {
    const ms = Date.parse(`${point.date}T00:00:00Z`) + point.minute * 60_000;
    return brand(new Date(ms).toISOString());
}
/** Walks backward through working windows, consuming minutes. */
class BackwardCursor {
    windows;
    guardDays;
    point;
    constructor(windows, dueDate, guardDays = DEFAULT_GUARD_DAYS) {
        this.windows = windows;
        this.guardDays = guardDays;
        // Anchor at the end of the last working window on (or before) dueDate.
        let date = dueDate;
        for (let i = 0; i <= this.guardDays; i += 1) {
            const dayWindows = this.windows(date);
            if (dayWindows.length > 0) {
                this.point = { date, minute: dayWindows[dayWindows.length - 1].endMinute };
                return;
            }
            date = addDays(date, -1);
        }
        throw new DomainError(`No working time found within ${this.guardDays} days before ${dueDate}`, "SCHEDULE_NO_CAPACITY", 422);
    }
    position() {
        return { ...this.point };
    }
    consume(minutes) {
        let remaining = minutes;
        let guard = 0;
        while (remaining > 0) {
            const dayWindows = this.windows(this.point.date);
            // Windows before (or containing) the current minute, latest first.
            const usable = dayWindows
                .filter((w) => w.startMinute < this.point.minute)
                .sort((a, b) => b.endMinute - a.endMinute);
            let advancedWithinDay = false;
            for (const w of usable) {
                const top = Math.min(this.point.minute, w.endMinute);
                const available = top - w.startMinute;
                if (available <= 0)
                    continue;
                const used = Math.min(available, remaining);
                this.point = { date: this.point.date, minute: top - used };
                remaining -= used;
                advancedWithinDay = true;
                if (remaining === 0)
                    return;
            }
            // Move to the end of the previous day.
            this.point = { date: addDays(this.point.date, -1), minute: MINUTES_PER_DAY };
            guard += 1;
            if (guard > this.guardDays && !advancedWithinDay) {
                throw new DomainError(`Ran out of working time scheduling backward (${remaining} min left)`, "SCHEDULE_NO_CAPACITY", 422);
            }
        }
    }
}
/** Walks forward through working windows, consuming minutes. */
class ForwardCursor {
    windows;
    guardDays;
    point;
    constructor(windows, earliestDate, guardDays = DEFAULT_GUARD_DAYS) {
        this.windows = windows;
        this.guardDays = guardDays;
        let date = earliestDate;
        for (let i = 0; i <= this.guardDays; i += 1) {
            const dayWindows = this.windows(date);
            if (dayWindows.length > 0) {
                this.point = { date, minute: dayWindows[0].startMinute };
                return;
            }
            date = addDays(date, 1);
        }
        throw new DomainError(`No working time found within ${this.guardDays} days after ${earliestDate}`, "SCHEDULE_NO_CAPACITY", 422);
    }
    position() {
        return { ...this.point };
    }
    consume(minutes) {
        let remaining = minutes;
        let guard = 0;
        while (remaining > 0) {
            const dayWindows = this.windows(this.point.date);
            const usable = dayWindows
                .filter((w) => w.endMinute > this.point.minute)
                .sort((a, b) => a.startMinute - b.startMinute);
            let advancedWithinDay = false;
            for (const w of usable) {
                const bottom = Math.max(this.point.minute, w.startMinute);
                const available = w.endMinute - bottom;
                if (available <= 0)
                    continue;
                const used = Math.min(available, remaining);
                this.point = { date: this.point.date, minute: bottom + used };
                remaining -= used;
                advancedWithinDay = true;
                if (remaining === 0)
                    return;
            }
            this.point = { date: addDays(this.point.date, 1), minute: 0 };
            guard += 1;
            if (guard > this.guardDays && !advancedWithinDay) {
                throw new DomainError(`Ran out of working time scheduling forward (${remaining} min left)`, "SCHEDULE_NO_CAPACITY", 422);
            }
        }
    }
}
function operationDurations(op, quantity) {
    return {
        worked: op.setupMinutes + op.runMinutesPerUnit * quantity + op.teardownMinutes,
        queue: op.queueMinutes,
        move: op.moveMinutes,
    };
}
/**
 * Backward-schedule operations so the last one finishes by the end of
 * working time on `dueDate`. Returns per-operation start/end timestamps.
 */
export function backwardSchedule(input) {
    assertScheduleInput(input.operations, input.quantity);
    const cursor = new BackwardCursor(input.windows, input.dueDate);
    const schedules = [];
    let totalWorked = 0;
    for (let i = input.operations.length - 1; i >= 0; i -= 1) {
        const op = input.operations[i];
        const { worked, queue, move } = operationDurations(op, input.quantity);
        // Move time (transit to the *next* op) sits after this op's end.
        cursor.consume(move);
        const end = toIso(cursor.position());
        cursor.consume(worked);
        cursor.consume(queue);
        const start = toIso(cursor.position());
        schedules.unshift({ seq: op.seq, start, end, workedMinutes: worked });
        totalWorked += worked;
    }
    return {
        scheduledStart: schedules[0].start,
        scheduledEnd: schedules[schedules.length - 1].end,
        operations: schedules,
        totalWorkedMinutes: totalWorked,
    };
}
/**
 * Forward-schedule operations from the first working moment on/after
 * `earliestStart`. Used for rework orders and past-due replanning.
 */
export function forwardSchedule(input) {
    assertScheduleInput(input.operations, input.quantity);
    const cursor = new ForwardCursor(input.windows, input.earliestStart);
    const schedules = [];
    let totalWorked = 0;
    for (const op of input.operations) {
        const { worked, queue, move } = operationDurations(op, input.quantity);
        cursor.consume(queue);
        const start = toIso(cursor.position());
        cursor.consume(worked);
        const end = toIso(cursor.position());
        cursor.consume(move);
        // start reported at beginning of queue would be before `consume(queue)`;
        // we report work start (after queue) as the operation start for forward
        // passes, matching how dispatch lists are read on the shop floor.
        schedules.push({ seq: op.seq, start, end, workedMinutes: worked });
        totalWorked += worked;
    }
    return {
        scheduledStart: schedules[0].start,
        scheduledEnd: schedules[schedules.length - 1].end,
        operations: schedules,
        totalWorkedMinutes: totalWorked,
    };
}
function assertScheduleInput(operations, quantity) {
    if (operations.length === 0) {
        throw new DomainError("Nothing to schedule: no operations", "SCHEDULE_NO_OPERATIONS", 422);
    }
    if (!(quantity > 0)) {
        throw new DomainError("Quantity must be positive", "SCHEDULE_INVALID_QTY", 422);
    }
}
//# sourceMappingURL=scheduling.js.map