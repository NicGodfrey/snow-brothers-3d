import { ConflictError, DomainError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { assertIsoDate, CapacityCalendar, } from "../domain/capacity-calendar.js";
import { capacityCalendarId, shiftTemplateId, workCenterId, } from "../domain/ids.js";
import { ShiftTemplate } from "../domain/shift-template.js";
const ACTIVE_LOAD_STATUSES = ["PLANNED", "RELEASED", "IN_PROGRESS"];
export class CapacityService {
    templates;
    calendars;
    workCenters;
    workOrders;
    publisher;
    constructor(templates, calendars, workCenters, workOrders, publisher) {
        this.templates = templates;
        this.calendars = calendars;
        this.workCenters = workCenters;
        this.workOrders = workOrders;
        this.publisher = publisher;
    }
    /* ---------------------- shift templates ------------------------- */
    async createShiftTemplate(ctx, input) {
        const existing = await this.templates.findByCode(ctx.tenantId, input.code.toUpperCase());
        if (existing) {
            throw new ConflictError(`Shift template '${input.code}' already exists`);
        }
        const template = ShiftTemplate.create(ctx.tenantId, input);
        await this.templates.save(template);
        await this.publisher.publish(template.pullEvents());
        return template;
    }
    async getShiftTemplate(ctx, id) {
        const template = await this.templates.findById(ctx.tenantId, shiftTemplateId(id));
        if (!template)
            throw new NotFoundError("ShiftTemplate", id);
        return template;
    }
    async listShiftTemplates(ctx) {
        return (await this.templates.list(ctx.tenantId)).sort((a, b) => a.code.localeCompare(b.code));
    }
    /* ------------------------- calendars ---------------------------- */
    async createCalendar(ctx, input) {
        const existing = await this.calendars.findByCode(ctx.tenantId, input.code.toUpperCase());
        if (existing) {
            throw new ConflictError(`Calendar '${input.code}' already exists`);
        }
        const template = await this.getShiftTemplate(ctx, input.shiftTemplateId);
        const calendar = CapacityCalendar.create(ctx.tenantId, {
            code: input.code,
            name: input.name,
            shiftTemplateId: shiftTemplateId(template.id),
        });
        await this.calendars.save(calendar);
        await this.publisher.publish(calendar.pullEvents());
        return calendar;
    }
    async getCalendar(ctx, id) {
        const calendar = await this.calendars.findById(ctx.tenantId, capacityCalendarId(id));
        if (!calendar)
            throw new NotFoundError("CapacityCalendar", id);
        return calendar;
    }
    async listCalendars(ctx) {
        return (await this.calendars.list(ctx.tenantId)).sort((a, b) => a.code.localeCompare(b.code));
    }
    async addException(ctx, calendarIdValue, input) {
        const calendar = await this.getCalendar(ctx, calendarIdValue);
        calendar.addException(input);
        await this.calendars.save(calendar);
        await this.publisher.publish(calendar.pullEvents());
        return calendar;
    }
    async removeException(ctx, calendarIdValue, date) {
        const calendar = await this.getCalendar(ctx, calendarIdValue);
        calendar.removeException(date);
        await this.calendars.save(calendar);
        await this.publisher.publish(calendar.pullEvents());
        return calendar;
    }
    /* ------------------------ capacity math ------------------------- */
    /**
     * Day-by-day capacity for a work center. Requires the work center to
     * have a calendar assigned.
     */
    async workCenterCapacity(ctx, workCenterIdValue, from, to) {
        assertIsoDate(from);
        assertIsoDate(to);
        const workCenter = await this.workCenters.findById(ctx.tenantId, workCenterId(workCenterIdValue));
        if (!workCenter)
            throw new NotFoundError("WorkCenter", workCenterIdValue);
        if (!workCenter.calendarId) {
            throw new DomainError(`Work center ${workCenter.code} has no capacity calendar assigned`, "WORK_CENTER_NO_CALENDAR", 422);
        }
        const calendar = await this.getCalendar(ctx, workCenter.calendarId);
        const template = await this.getShiftTemplate(ctx, calendar.shiftTemplateId);
        const factor = workCenter.capacityFactor();
        return calendar.availabilityBetween(from, to, template).map((day) => ({
            date: day.date,
            calendarMinutes: day.minutes,
            effectiveMinutes: Math.round(day.minutes * factor),
        }));
    }
    /**
     * Capacity vs. load: planned worked minutes of scheduled operations on
     * this work center, spread evenly across the days each operation spans.
     */
    async workCenterLoad(ctx, workCenterIdValue, from, to) {
        const capacity = await this.workCenterCapacity(ctx, workCenterIdValue, from, to);
        const loadByDate = new Map(capacity.map((d) => [d.date, 0]));
        const target = workCenterIdValue;
        for (const status of ACTIVE_LOAD_STATUSES) {
            const orders = await this.workOrders.list(ctx.tenantId, { status });
            for (const order of orders) {
                for (const op of order.operations) {
                    if (op.workCenterId !== target || !op.scheduledStart || !op.scheduledEnd)
                        continue;
                    const startDate = op.scheduledStart.slice(0, 10);
                    const endDate = op.scheduledEnd.slice(0, 10);
                    const workedMinutes = op.setupMinutes +
                        op.runMinutesPerUnit * order.quantityOrdered +
                        op.teardownMinutes;
                    const spanDays = daysBetweenInclusive(startDate, endDate);
                    const perDay = workedMinutes / spanDays.length;
                    for (const date of spanDays) {
                        if (loadByDate.has(date)) {
                            loadByDate.set(date, loadByDate.get(date) + perDay);
                        }
                    }
                }
            }
        }
        return capacity.map((day) => {
            const loadMinutes = Math.round(loadByDate.get(day.date) ?? 0);
            return {
                ...day,
                loadMinutes,
                loadPct: day.effectiveMinutes > 0
                    ? Math.round((loadMinutes / day.effectiveMinutes) * 1000) / 10
                    : loadMinutes > 0
                        ? 999.9
                        : 0,
            };
        });
    }
}
function daysBetweenInclusive(from, to) {
    const days = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
        days.push(d.toISOString().slice(0, 10));
    }
    return days.length > 0 ? days : [from];
}
//# sourceMappingURL=capacity-service.js.map