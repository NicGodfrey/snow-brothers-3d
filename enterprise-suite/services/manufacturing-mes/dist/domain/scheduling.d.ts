import { type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { type CapacityCalendar } from "./capacity-calendar.js";
import type { ShiftTemplate } from "./shift-template.js";
/**
 * Calendar-aware scheduling.
 *
 * The model: each working day exposes one or more working windows
 * (minute-of-day ranges derived from the shift template, adjusted by
 * calendar exceptions). Operation elements — queue, setup, run, teardown,
 * move — consume working minutes inside those windows. Backward scheduling
 * walks from the due date towards the past; forward scheduling walks from
 * an earliest start towards the future.
 *
 * Simplification (documented deliberately): queue and move time consume
 * working-calendar minutes rather than wall-clock minutes. This keeps the
 * schedule conservative — an order never looks *earlier* than reality.
 */
export interface SchedulableOperation {
    readonly seq: number;
    readonly setupMinutes: number;
    readonly runMinutesPerUnit: number;
    readonly teardownMinutes: number;
    readonly queueMinutes: number;
    readonly moveMinutes: number;
}
export interface OperationSchedule {
    readonly seq: number;
    /** Start of queue time (arrival at the work center). */
    readonly start: IsoDateTime;
    /** End of teardown (unit ready to move on). */
    readonly end: IsoDateTime;
    /** Setup + run + teardown minutes (excludes queue/move). */
    readonly workedMinutes: number;
}
export interface ScheduleResult {
    readonly scheduledStart: IsoDateTime;
    readonly scheduledEnd: IsoDateTime;
    readonly operations: readonly OperationSchedule[];
    readonly totalWorkedMinutes: number;
}
/** Minute-of-day working windows for one date. */
export interface WorkingWindow {
    readonly startMinute: number;
    readonly endMinute: number;
}
export type WindowsProvider = (date: string) => WorkingWindow[];
/**
 * Build a windows provider from a shift template plus calendar exceptions.
 * Breaks are modelled by shortening each shift window from its end;
 * DOWNTIME trims minutes from the end of the day, OVERTIME extends the last
 * window (or opens a default 08:00 window on a non-working day).
 */
export declare function windowsFromCalendar(template: ShiftTemplate, calendar: CapacityCalendar): WindowsProvider;
/**
 * Backward-schedule operations so the last one finishes by the end of
 * working time on `dueDate`. Returns per-operation start/end timestamps.
 */
export declare function backwardSchedule(input: {
    operations: readonly SchedulableOperation[];
    quantity: number;
    dueDate: string;
    windows: WindowsProvider;
}): ScheduleResult;
/**
 * Forward-schedule operations from the first working moment on/after
 * `earliestStart`. Used for rework orders and past-due replanning.
 */
export declare function forwardSchedule(input: {
    operations: readonly SchedulableOperation[];
    quantity: number;
    earliestStart: string;
    windows: WindowsProvider;
}): ScheduleResult;
//# sourceMappingURL=scheduling.d.ts.map