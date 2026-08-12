import { type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "../domain/common.js";
import { HolidayCalendar, LeaveBalance, LeavePolicy, LeaveRequest, type Holiday, type LeaveTypeCode } from "../domain/leave.js";
import type { Clock, EmployeeRepository, EventOutbox, HolidayCalendarRepository, LeaveBalanceRepository, LeavePolicyRepository, LeaveRequestRepository } from "./ports.js";
/** Synthetic decider recorded on auto-approved requests (policy without approval). */
export declare const SYSTEM_DECIDER: Ulid;
export declare class LeaveService {
    private readonly policies;
    private readonly calendars;
    private readonly balances;
    private readonly requests;
    private readonly employees;
    private readonly outbox;
    private readonly clock;
    constructor(policies: LeavePolicyRepository, calendars: HolidayCalendarRepository, balances: LeaveBalanceRepository, requests: LeaveRequestRepository, employees: EmployeeRepository, outbox: EventOutbox, clock: Clock);
    definePolicy(tenantId: TenantId, input: {
        leaveType: string;
        name: string;
        accrualDaysPerYear: number;
        maxCarryoverDays?: number;
        requiresApproval?: boolean;
        allowNegativeBalance?: boolean;
        paid?: boolean;
    }): LeavePolicy;
    listPolicies(tenantId: TenantId): LeavePolicy[];
    getPolicy(tenantId: TenantId, leaveType: LeaveTypeCode): LeavePolicy;
    setHolidayCalendar(tenantId: TenantId, year: number, holidays: Holiday[]): HolidayCalendar;
    /** Balance rows are created lazily on first touch for a given year. */
    ensureBalance(tenantId: TenantId, employeeId: Ulid, leaveType: LeaveTypeCode, year: number): LeaveBalance;
    listBalances(tenantId: TenantId, employeeId: Ulid, year?: number): LeaveBalance[];
    /**
     * Grants the annual upfront entitlement. In the employee's hire year the
     * grant is pro-rated by remaining months (hire month inclusive).
     */
    grantAnnualEntitlement(tenantId: TenantId, employeeId: Ulid, leaveType: LeaveTypeCode, year: number): LeaveBalance;
    /**
     * Monthly accrual sweep for one leave type: every employee employed on or
     * before the end of the month accrues 1/12 of the annual figure.
     */
    runMonthlyAccrual(tenantId: TenantId, leaveType: LeaveTypeCode, year: number, month: number): number;
    /**
     * Year-end carryover: moves unused days (capped by policy) into the next
     * year's balance. Returns the number of days carried.
     */
    carryOver(tenantId: TenantId, employeeId: Ulid, leaveType: LeaveTypeCode, fromYear: number): number;
    submitRequest(tenantId: TenantId, input: {
        employeeId: Ulid;
        leaveType: LeaveTypeCode;
        startDate: IsoDate;
        endDate: IsoDate;
        reason?: string;
    }): LeaveRequest;
    getRequest(tenantId: TenantId, id: Ulid): LeaveRequest;
    listRequests(tenantId: TenantId, employeeId: Ulid): LeaveRequest[];
    approve(tenantId: TenantId, requestId: Ulid, approverId: Ulid): LeaveRequest;
    reject(tenantId: TenantId, requestId: Ulid, approverId: Ulid, note: string): LeaveRequest;
    /** Approved leave can only be cancelled before it starts. */
    cancel(tenantId: TenantId, requestId: Ulid): LeaveRequest;
    private requireBalance;
    private holidaySetForRange;
}
//# sourceMappingURL=leave-service.d.ts.map