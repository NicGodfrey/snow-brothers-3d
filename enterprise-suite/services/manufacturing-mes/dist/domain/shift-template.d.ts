import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
/** 0 = Sunday … 6 = Saturday, matching JS Date.getUTCDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export declare const ALL_WEEKDAYS: readonly Weekday[];
export declare const MON_TO_FRI: readonly Weekday[];
export interface Shift {
    readonly name: string;
    /** Minutes after midnight, 0–1439. */
    readonly startMinuteOfDay: number;
    /** Total shift length in minutes. Must fit within the day. */
    readonly durationMinutes: number;
    /** Unpaid/unproductive break minutes inside the shift. */
    readonly breakMinutes: number;
    readonly daysOfWeek: readonly Weekday[];
}
export interface ShiftTemplateProps {
    code: string;
    name: string;
    shifts: Shift[];
}
export interface ShiftInput {
    name: string;
    /** "HH:MM" 24h clock. */
    startTime: string;
    durationMinutes: number;
    breakMinutes?: number;
    daysOfWeek: Weekday[];
}
export declare function parseTimeToMinutes(time: string): number;
export declare class ShiftTemplate extends AggregateRoot<ShiftTemplateProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        code: string;
        name: string;
        shifts: ShiftInput[];
    }): ShiftTemplate;
    private static toShift;
    private static assertNoOverlaps;
    get code(): string;
    get shifts(): readonly Shift[];
    /** Productive minutes (duration minus breaks) on the given weekday. */
    netMinutesOn(weekday: Weekday): number;
    /** Total weekly productive minutes — handy for rough-cut capacity. */
    netMinutesPerWeek(): number;
}
//# sourceMappingURL=shift-template.d.ts.map