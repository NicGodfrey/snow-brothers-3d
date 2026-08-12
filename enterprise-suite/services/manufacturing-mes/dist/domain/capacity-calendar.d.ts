import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
import { type ShiftTemplateId } from "./ids.js";
import type { ShiftTemplate, Weekday } from "./shift-template.js";
export declare const CALENDAR_EXCEPTION_TYPES: readonly ["HOLIDAY", "DOWNTIME", "OVERTIME"];
export type CalendarExceptionType = (typeof CALENDAR_EXCEPTION_TYPES)[number];
export interface CalendarException {
    /** ISO date, e.g. "2026-08-12". One exception per date. */
    readonly date: string;
    readonly type: CalendarExceptionType;
    /**
     * HOLIDAY ignores this (day is zeroed).
     * DOWNTIME subtracts these minutes from the template's net minutes.
     * OVERTIME adds these minutes on top of the template's net minutes.
     */
    readonly minutes: number;
    readonly reason: string | null;
}
export interface CapacityCalendarProps {
    code: string;
    name: string;
    shiftTemplateId: ShiftTemplateId;
    exceptions: CalendarException[];
}
export declare function assertIsoDate(date: string): void;
export declare function weekdayOf(isoDate: string): Weekday;
export declare function addDays(isoDate: string, days: number): string;
export declare class CapacityCalendar extends AggregateRoot<CapacityCalendarProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        code: string;
        name: string;
        shiftTemplateId: ShiftTemplateId;
    }): CapacityCalendar;
    get code(): string;
    get shiftTemplateId(): ShiftTemplateId;
    get exceptions(): readonly CalendarException[];
    addException(input: {
        date: string;
        type: CalendarExceptionType;
        minutes?: number;
        reason?: string;
    }): void;
    removeException(date: string): void;
    /**
     * Productive minutes available on one date, before any work-center
     * capacity factor is applied.
     */
    availableMinutesOn(date: string, template: ShiftTemplate): number;
    /** Inclusive day-by-day availability across a date range. */
    availabilityBetween(from: string, to: string, template: ShiftTemplate): Array<{
        date: string;
        minutes: number;
    }>;
}
//# sourceMappingURL=capacity-calendar.d.ts.map