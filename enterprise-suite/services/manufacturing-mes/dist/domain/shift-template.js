import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid } from "./ids.js";
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const MON_TO_FRI = [1, 2, 3, 4, 5];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function parseTimeToMinutes(time) {
    const match = TIME_PATTERN.exec(time);
    if (!match) {
        throw new DomainError(`Invalid time '${time}', expected HH:MM`, "SHIFT_INVALID_TIME");
    }
    return Number(match[1]) * 60 + Number(match[2]);
}
export class ShiftTemplate extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static create(tenantId, input) {
        if (!input.code.trim()) {
            throw new DomainError("Shift template code is required", "SHIFT_TEMPLATE_INVALID_CODE");
        }
        if (input.shifts.length === 0) {
            throw new DomainError("Shift template needs at least one shift", "SHIFT_TEMPLATE_EMPTY");
        }
        const shifts = input.shifts.map(ShiftTemplate.toShift);
        ShiftTemplate.assertNoOverlaps(shifts);
        const template = new ShiftTemplate(tenantId, {
            code: input.code.trim().toUpperCase(),
            name: input.name.trim() || input.code.trim(),
            shifts,
        });
        template.raise(envelope({
            eventType: MesEvents.ShiftTemplateCreated,
            aggregateType: "ShiftTemplate",
            aggregateId: asUlid(template.id),
            tenantId,
            payload: { code: template.props.code, shiftCount: shifts.length },
        }));
        return template;
    }
    static toShift(input) {
        const start = parseTimeToMinutes(input.startTime);
        if (input.durationMinutes < 1) {
            throw new DomainError("Shift duration must be >= 1 minute", "SHIFT_INVALID_DURATION");
        }
        if (start + input.durationMinutes > 24 * 60) {
            throw new DomainError(`Shift '${input.name}' runs past midnight; split it into two shifts`, "SHIFT_CROSSES_MIDNIGHT");
        }
        const breakMinutes = input.breakMinutes ?? 0;
        if (breakMinutes < 0 || breakMinutes >= input.durationMinutes) {
            throw new DomainError("Break minutes must be >= 0 and shorter than the shift", "SHIFT_INVALID_BREAK");
        }
        if (input.daysOfWeek.length === 0) {
            throw new DomainError(`Shift '${input.name}' has no active weekdays`, "SHIFT_NO_DAYS");
        }
        const uniqueDays = [...new Set(input.daysOfWeek)].sort((a, b) => a - b);
        return {
            name: input.name.trim() || "Shift",
            startMinuteOfDay: start,
            durationMinutes: input.durationMinutes,
            breakMinutes,
            daysOfWeek: uniqueDays,
        };
    }
    static assertNoOverlaps(shifts) {
        for (const day of ALL_WEEKDAYS) {
            const onDay = shifts
                .filter((s) => s.daysOfWeek.includes(day))
                .sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay);
            for (let i = 1; i < onDay.length; i += 1) {
                const prev = onDay[i - 1];
                const curr = onDay[i];
                if (prev.startMinuteOfDay + prev.durationMinutes > curr.startMinuteOfDay) {
                    throw new DomainError(`Shifts '${prev.name}' and '${curr.name}' overlap on weekday ${day}`, "SHIFT_OVERLAP");
                }
            }
        }
    }
    get code() {
        return this.props.code;
    }
    get shifts() {
        return this.props.shifts;
    }
    /** Productive minutes (duration minus breaks) on the given weekday. */
    netMinutesOn(weekday) {
        return this.props.shifts
            .filter((s) => s.daysOfWeek.includes(weekday))
            .reduce((sum, s) => sum + s.durationMinutes - s.breakMinutes, 0);
    }
    /** Total weekly productive minutes — handy for rough-cut capacity. */
    netMinutesPerWeek() {
        return ALL_WEEKDAYS.reduce((sum, day) => sum + this.netMinutesOn(day), 0);
    }
}
//# sourceMappingURL=shift-template.js.map