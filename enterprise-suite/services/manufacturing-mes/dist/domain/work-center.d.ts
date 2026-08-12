import { AggregateRoot, type Money, type TenantId } from "@enterprise-suite/shared-kernel";
import { type CapacityCalendarId } from "./ids.js";
export declare const WORK_CENTER_STATUSES: readonly ["ACTIVE", "INACTIVE", "MAINTENANCE"];
export type WorkCenterStatus = (typeof WORK_CENTER_STATUSES)[number];
export interface WorkCenterRates {
    /** Cost per labor hour, in minor units. */
    readonly laborRatePerHour: Money;
    /** Cost per machine hour, in minor units. */
    readonly machineRatePerHour: Money;
    /** Overhead applied per machine hour, in minor units. */
    readonly overheadRatePerHour: Money;
}
export interface WorkCenterProps {
    code: string;
    name: string;
    description: string | null;
    costCenterCode: string | null;
    status: WorkCenterStatus;
    /** Number of interchangeable machines/stations at this center. */
    machineCount: number;
    /** Realistic output vs. theoretical, 0–100. Applied to capacity. */
    efficiencyPct: number;
    /** Share of calendar time the center is actually loadable, 0–100. */
    utilizationPct: number;
    /** Default queue time in minutes for operations arriving here. */
    defaultQueueMinutes: number;
    rates: WorkCenterRates;
    calendarId: CapacityCalendarId | null;
    tags: string[];
}
export interface CreateWorkCenterInput {
    code: string;
    name: string;
    description?: string;
    costCenterCode?: string;
    machineCount?: number;
    efficiencyPct?: number;
    utilizationPct?: number;
    defaultQueueMinutes?: number;
    currency?: string;
    laborRatePerHourMinor?: number;
    machineRatePerHourMinor?: number;
    overheadRatePerHourMinor?: number;
    tags?: string[];
}
export declare class WorkCenter extends AggregateRoot<WorkCenterProps> {
    private constructor();
    static create(tenantId: TenantId, input: CreateWorkCenterInput): WorkCenter;
    get code(): string;
    get status(): WorkCenterStatus;
    get calendarId(): CapacityCalendarId | null;
    get machineCount(): number;
    get rates(): WorkCenterRates;
    get defaultQueueMinutes(): number;
    /**
     * Effective capacity factor applied to raw calendar minutes:
     * machines * efficiency * utilization.
     */
    capacityFactor(): number;
    isLoadable(): boolean;
    update(patch: {
        name?: string;
        description?: string | null;
        costCenterCode?: string | null;
        machineCount?: number;
        efficiencyPct?: number;
        utilizationPct?: number;
        defaultQueueMinutes?: number;
        tags?: string[];
    }): void;
    setRates(rates: WorkCenterRates): void;
    changeStatus(next: WorkCenterStatus, reason?: string): void;
    assignCalendar(calendarId: CapacityCalendarId): void;
}
//# sourceMappingURL=work-center.d.ts.map