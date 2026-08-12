import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid } from "./ids.js";
export const CALENDAR_EXCEPTION_TYPES = ["HOLIDAY", "DOWNTIME", "OVERTIME"];
const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function assertIsoDate(date) {
    if (!ISO_DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        throw new DomainError(`Invalid ISO date '${date}'`, "CALENDAR_INVALID_DATE");
    }
}
export function weekdayOf(isoDate) {
    return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}
export function addDays(isoDate, days) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
export class CapacityCalendar extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static create(tenantId, input) {
        if (!input.code.trim()) {
            throw new DomainError("Calendar code is required", "CALENDAR_INVALID_CODE");
        }
        const calendar = new CapacityCalendar(tenantId, {
            code: input.code.trim().toUpperCase(),
            name: input.name.trim() || input.code.trim(),
            shiftTemplateId: input.shiftTemplateId,
            exceptions: [],
        });
        calendar.raise(envelope({
            eventType: MesEvents.CapacityCalendarCreated,
            aggregateType: "CapacityCalendar",
            aggregateId: asUlid(calendar.id),
            tenantId,
            payload: { code: calendar.props.code, shiftTemplateId: input.shiftTemplateId },
        }));
        return calendar;
    }
    get code() {
        return this.props.code;
    }
    get shiftTemplateId() {
        return this.props.shiftTemplateId;
    }
    get exceptions() {
        return this.props.exceptions;
    }
    addException(input) {
        assertIsoDate(input.date);
        if (this.props.exceptions.some((e) => e.date === input.date)) {
            throw new DomainError(`Calendar already has an exception on ${input.date}`, "CALENDAR_EXCEPTION_EXISTS", 409);
        }
        const minutes = input.minutes ?? 0;
        if (input.type !== "HOLIDAY" && minutes <= 0) {
            throw new DomainError(`${input.type} exception requires positive minutes`, "CALENDAR_EXCEPTION_MINUTES");
        }
        this.props.exceptions.push({
            date: input.date,
            type: input.type,
            minutes: input.type === "HOLIDAY" ? 0 : minutes,
            reason: input.reason?.trim() || null,
        });
        this.props.exceptions.sort((a, b) => a.date.localeCompare(b.date));
        this.raise(envelope({
            eventType: MesEvents.CapacityExceptionAdded,
            aggregateType: "CapacityCalendar",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { code: this.props.code, date: input.date, type: input.type },
        }));
    }
    removeException(date) {
        const idx = this.props.exceptions.findIndex((e) => e.date === date);
        if (idx === -1) {
            throw new DomainError(`No calendar exception on ${date}`, "CALENDAR_EXCEPTION_MISSING", 404);
        }
        this.props.exceptions.splice(idx, 1);
        this.raise(envelope({
            eventType: MesEvents.CapacityExceptionRemoved,
            aggregateType: "CapacityCalendar",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { code: this.props.code, date },
        }));
    }
    /**
     * Productive minutes available on one date, before any work-center
     * capacity factor is applied.
     */
    availableMinutesOn(date, template) {
        assertIsoDate(date);
        const base = template.netMinutesOn(weekdayOf(date));
        const exception = this.props.exceptions.find((e) => e.date === date);
        if (!exception)
            return base;
        switch (exception.type) {
            case "HOLIDAY":
                return 0;
            case "DOWNTIME":
                return Math.max(0, base - exception.minutes);
            case "OVERTIME":
                return base + exception.minutes;
            default:
                return base;
        }
    }
    /** Inclusive day-by-day availability across a date range. */
    availabilityBetween(from, to, template) {
        assertIsoDate(from);
        assertIsoDate(to);
        if (from > to) {
            throw new DomainError("'from' must not be after 'to'", "CALENDAR_INVALID_RANGE");
        }
        const days = [];
        for (let date = from; date <= to; date = addDays(date, 1)) {
            days.push({ date, minutes: this.availableMinutesOn(date, template) });
        }
        return days;
    }
}
//# sourceMappingURL=capacity-calendar.js.map