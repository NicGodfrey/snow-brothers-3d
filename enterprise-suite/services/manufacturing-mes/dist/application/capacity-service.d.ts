import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { CapacityCalendar, type CalendarExceptionType } from "../domain/capacity-calendar.js";
import { ShiftTemplate, type ShiftInput } from "../domain/shift-template.js";
import type { CapacityCalendarRepository, EventPublisher, ShiftTemplateRepository, WorkCenterRepository, WorkOrderRepository } from "./ports.js";
export interface DayCapacity {
    date: string;
    /** Raw working minutes from the calendar (per machine). */
    calendarMinutes: number;
    /** Calendar minutes x machines x efficiency x utilization. */
    effectiveMinutes: number;
}
export interface DayLoad extends DayCapacity {
    /** Planned worked minutes from scheduled work order operations. */
    loadMinutes: number;
    /** loadMinutes / effectiveMinutes, as a 0–100+ percentage. */
    loadPct: number;
}
export declare class CapacityService {
    private readonly templates;
    private readonly calendars;
    private readonly workCenters;
    private readonly workOrders;
    private readonly publisher;
    constructor(templates: ShiftTemplateRepository, calendars: CapacityCalendarRepository, workCenters: WorkCenterRepository, workOrders: WorkOrderRepository, publisher: EventPublisher);
    createShiftTemplate(ctx: TenantContext, input: {
        code: string;
        name: string;
        shifts: ShiftInput[];
    }): Promise<ShiftTemplate>;
    getShiftTemplate(ctx: TenantContext, id: string): Promise<ShiftTemplate>;
    listShiftTemplates(ctx: TenantContext): Promise<ShiftTemplate[]>;
    createCalendar(ctx: TenantContext, input: {
        code: string;
        name: string;
        shiftTemplateId: string;
    }): Promise<CapacityCalendar>;
    getCalendar(ctx: TenantContext, id: string): Promise<CapacityCalendar>;
    listCalendars(ctx: TenantContext): Promise<CapacityCalendar[]>;
    addException(ctx: TenantContext, calendarIdValue: string, input: {
        date: string;
        type: CalendarExceptionType;
        minutes?: number;
        reason?: string;
    }): Promise<CapacityCalendar>;
    removeException(ctx: TenantContext, calendarIdValue: string, date: string): Promise<CapacityCalendar>;
    /**
     * Day-by-day capacity for a work center. Requires the work center to
     * have a calendar assigned.
     */
    workCenterCapacity(ctx: TenantContext, workCenterIdValue: string, from: string, to: string): Promise<DayCapacity[]>;
    /**
     * Capacity vs. load: planned worked minutes of scheduled operations on
     * this work center, spread evenly across the days each operation spans.
     */
    workCenterLoad(ctx: TenantContext, workCenterIdValue: string, from: string, to: string): Promise<DayLoad[]>;
}
//# sourceMappingURL=capacity-service.d.ts.map