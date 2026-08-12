import { AggregateRoot, Entity, type IsoDateTime, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "./common.js";
/** Well-known leave type codes; tenants may define additional custom codes. */
export declare const STANDARD_LEAVE_TYPES: readonly ["annual", "sick", "parental", "unpaid", "bereavement"];
export type LeaveTypeCode = string;
export interface LeavePolicyProps {
    leaveType: LeaveTypeCode;
    name: string;
    accrualDaysPerYear: number;
    maxCarryoverDays: number;
    requiresApproval: boolean;
    allowNegativeBalance: boolean;
    paid: boolean;
}
export declare class LeavePolicy extends Entity<LeavePolicyProps> {
    private constructor();
    static define(tenantId: TenantId, input: {
        leaveType: string;
        name: string;
        accrualDaysPerYear: number;
        maxCarryoverDays?: number;
        requiresApproval?: boolean;
        allowNegativeBalance?: boolean;
        paid?: boolean;
    }): LeavePolicy;
    get leaveType(): LeaveTypeCode;
    get name(): string;
    get accrualDaysPerYear(): number;
    get maxCarryoverDays(): number;
    get requiresApproval(): boolean;
    get allowNegativeBalance(): boolean;
    get paid(): boolean;
    /** One month's worth of accrual (1/12 of the annual figure, 2dp). */
    monthlyAccrualDays(): number;
    /**
     * Entitlement for the hire year, pro-rated by full months remaining
     * including the hire month. Hired in July → 6/12 of the annual figure.
     */
    proRatedEntitlement(hireMonth1Based: number): number;
}
export interface Holiday {
    readonly date: IsoDate;
    readonly name: string;
}
export interface HolidayCalendarProps {
    year: number;
    holidays: Holiday[];
}
export declare class HolidayCalendar extends Entity<HolidayCalendarProps> {
    private constructor();
    static define(tenantId: TenantId, year: number, holidays: Holiday[]): HolidayCalendar;
    get year(): number;
    get holidays(): readonly Holiday[];
    holidayDates(): ReadonlySet<string>;
}
export interface LeaveBalanceProps {
    employeeId: Ulid;
    leaveType: LeaveTypeCode;
    year: number;
    /** Upfront grant (pro-rated in the hire year). */
    entitledDays: number;
    /** Sum of monthly accruals, for tenants using accrual instead of upfront grants. */
    accruedDays: number;
    /** Days carried over from the previous year, capped by policy. */
    carriedOverDays: number;
    /** Manual HR adjustments (signed). */
    adjustmentDays: number;
    takenDays: number;
    pendingDays: number;
}
export declare class LeaveBalance extends Entity<LeaveBalanceProps> {
    private constructor();
    static open(tenantId: TenantId, employeeId: Ulid, leaveType: LeaveTypeCode, year: number): LeaveBalance;
    get employeeId(): Ulid;
    get leaveType(): LeaveTypeCode;
    get year(): number;
    get takenDays(): number;
    get pendingDays(): number;
    get entitledDays(): number;
    get accruedDays(): number;
    get carriedOverDays(): number;
    /** Days still available to request. */
    get availableDays(): number;
    /** Remaining days ignoring pending reservations — used for carryover. */
    get remainingDays(): number;
    grantEntitlement(days: number): void;
    accrue(days: number): void;
    applyCarryover(days: number): void;
    adjust(deltaDays: number): void;
    /** Reserves days for a submitted request. */
    reserve(days: number, allowNegative: boolean): void;
    /** Releases a reservation (request rejected or cancelled before approval). */
    release(days: number): void;
    /** Converts a reservation into consumed days (request approved). */
    commitPending(days: number): void;
    /** Returns consumed days (approved future request cancelled). */
    refundTaken(days: number): void;
}
export type LeaveRequestStatus = "submitted" | "approved" | "rejected" | "cancelled";
export interface LeaveRequestProps {
    employeeId: Ulid;
    leaveType: LeaveTypeCode;
    startDate: IsoDate;
    endDate: IsoDate;
    workingDays: number;
    reason?: string;
    status: LeaveRequestStatus;
    decidedBy?: Ulid;
    decidedAt?: IsoDateTime;
    decisionNote?: string;
    cancelledAt?: IsoDateTime;
}
export declare class LeaveRequest extends AggregateRoot<LeaveRequestProps> {
    private constructor();
    /** `workingDays` is computed by LeaveService using the tenant holiday calendar. */
    static submit(tenantId: TenantId, input: {
        employeeId: Ulid;
        leaveType: LeaveTypeCode;
        startDate: IsoDate;
        endDate: IsoDate;
        workingDays: number;
        reason?: string;
    }): LeaveRequest;
    get employeeId(): Ulid;
    get leaveType(): LeaveTypeCode;
    get startDate(): IsoDate;
    get endDate(): IsoDate;
    get workingDays(): number;
    get status(): LeaveRequestStatus;
    /** True when this request blocks another request over [start, end]. */
    overlaps(start: IsoDate, end: IsoDate): boolean;
    approve(decidedBy: Ulid): void;
    reject(decidedBy: Ulid, note: string): void;
    /** Whether cancellation is still allowed is checked by LeaveService (needs today's date). */
    cancel(): void;
    private assertPending;
    private decisionPayload;
}
//# sourceMappingURL=leave.d.ts.map