import { brand, ConflictError, DomainError, envelope, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { assertRange, compareDates, countWorkingDays, lastDayOfMonth, monthOf, yearOf, } from "../domain/common.js";
import { HcmEvents } from "../domain/events.js";
import { HolidayCalendar, LeaveBalance, LeavePolicy, LeaveRequest, } from "../domain/leave.js";
/** Synthetic decider recorded on auto-approved requests (policy without approval). */
export const SYSTEM_DECIDER = brand("user_system");
export class LeaveService {
    policies;
    calendars;
    balances;
    requests;
    employees;
    outbox;
    clock;
    constructor(policies, calendars, balances, requests, employees, outbox, clock) {
        this.policies = policies;
        this.calendars = calendars;
        this.balances = balances;
        this.requests = requests;
        this.employees = employees;
        this.outbox = outbox;
        this.clock = clock;
    }
    // -------------------------------------------------------------- policies
    definePolicy(tenantId, input) {
        const normalized = input.leaveType.trim().toLowerCase();
        if (this.policies.findByType(tenantId, normalized)) {
            throw new ConflictError(`Leave policy already defined for type "${normalized}"`);
        }
        const policy = LeavePolicy.define(tenantId, input);
        this.policies.save(policy);
        return policy;
    }
    listPolicies(tenantId) {
        return this.policies.listByTenant(tenantId);
    }
    getPolicy(tenantId, leaveType) {
        const policy = this.policies.findByType(tenantId, leaveType);
        if (!policy)
            throw new NotFoundError("LeavePolicy", leaveType);
        return policy;
    }
    setHolidayCalendar(tenantId, year, holidays) {
        if (this.calendars.findByYear(tenantId, year)) {
            throw new ConflictError(`Holiday calendar for ${year} already exists`);
        }
        const calendar = HolidayCalendar.define(tenantId, year, holidays);
        this.calendars.save(calendar);
        return calendar;
    }
    // -------------------------------------------------------------- balances
    /** Balance rows are created lazily on first touch for a given year. */
    ensureBalance(tenantId, employeeId, leaveType, year) {
        const existing = this.balances.find(tenantId, employeeId, leaveType, year);
        if (existing)
            return existing;
        this.getPolicy(tenantId, leaveType);
        const balance = LeaveBalance.open(tenantId, employeeId, leaveType, year);
        this.balances.save(balance);
        return balance;
    }
    listBalances(tenantId, employeeId, year) {
        return this.balances.listByEmployee(tenantId, employeeId, year);
    }
    /**
     * Grants the annual upfront entitlement. In the employee's hire year the
     * grant is pro-rated by remaining months (hire month inclusive).
     */
    grantAnnualEntitlement(tenantId, employeeId, leaveType, year) {
        const employee = this.employees.findById(tenantId, employeeId);
        if (!employee)
            throw new NotFoundError("Employee", employeeId);
        if (!employee.isEmployed()) {
            throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
        }
        const policy = this.getPolicy(tenantId, leaveType);
        const balance = this.ensureBalance(tenantId, employeeId, leaveType, year);
        const days = yearOf(employee.hireDate) === year
            ? policy.proRatedEntitlement(monthOf(employee.hireDate))
            : policy.accrualDaysPerYear;
        balance.grantEntitlement(days);
        this.balances.save(balance);
        this.outbox.append([
            envelope({
                eventType: HcmEvents.LeaveBalanceAccrued,
                aggregateType: "LeaveBalance",
                aggregateId: balance.id,
                tenantId,
                payload: { employeeId, leaveType, year, days, mechanism: "annual_grant" },
            }),
        ]);
        return balance;
    }
    /**
     * Monthly accrual sweep for one leave type: every employee employed on or
     * before the end of the month accrues 1/12 of the annual figure.
     */
    runMonthlyAccrual(tenantId, leaveType, year, month) {
        const policy = this.getPolicy(tenantId, leaveType);
        const monthly = policy.monthlyAccrualDays();
        if (monthly === 0)
            return 0;
        const cutoff = lastDayOfMonth(year, month);
        let accruedFor = 0;
        for (const employee of this.employees.listByTenant(tenantId)) {
            if (!employee.isEmployed())
                continue;
            if (compareDates(employee.hireDate, cutoff) > 0)
                continue;
            const balance = this.ensureBalance(tenantId, employee.id, leaveType, year);
            balance.accrue(monthly);
            this.balances.save(balance);
            this.outbox.append([
                envelope({
                    eventType: HcmEvents.LeaveBalanceAccrued,
                    aggregateType: "LeaveBalance",
                    aggregateId: balance.id,
                    tenantId,
                    payload: { employeeId: employee.id, leaveType, year, month, days: monthly, mechanism: "monthly_accrual" },
                }),
            ]);
            accruedFor += 1;
        }
        return accruedFor;
    }
    /**
     * Year-end carryover: moves unused days (capped by policy) into the next
     * year's balance. Returns the number of days carried.
     */
    carryOver(tenantId, employeeId, leaveType, fromYear) {
        const policy = this.getPolicy(tenantId, leaveType);
        const source = this.balances.find(tenantId, employeeId, leaveType, fromYear);
        if (!source)
            return 0;
        if (source.pendingDays > 0) {
            throw new ConflictError(`Cannot carry over while ${source.pendingDays} day(s) are pending decision for ${fromYear}`);
        }
        const carry = Math.min(Math.max(source.remainingDays, 0), policy.maxCarryoverDays);
        if (carry === 0)
            return 0;
        source.adjust(-carry);
        this.balances.save(source);
        const target = this.ensureBalance(tenantId, employeeId, leaveType, fromYear + 1);
        target.applyCarryover(carry);
        this.balances.save(target);
        this.outbox.append([
            envelope({
                eventType: HcmEvents.LeaveBalanceCarriedOver,
                aggregateType: "LeaveBalance",
                aggregateId: target.id,
                tenantId,
                payload: { employeeId, leaveType, fromYear, toYear: fromYear + 1, days: carry },
            }),
        ]);
        return carry;
    }
    // -------------------------------------------------------------- requests
    submitRequest(tenantId, input) {
        const employee = this.employees.findById(tenantId, input.employeeId);
        if (!employee)
            throw new NotFoundError("Employee", input.employeeId);
        if (!employee.isEmployed()) {
            throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
        }
        const policy = this.getPolicy(tenantId, input.leaveType);
        assertRange(input.startDate, input.endDate, "Leave request");
        const workingDays = countWorkingDays(input.startDate, input.endDate, this.holidaySetForRange(tenantId, input.startDate, input.endDate));
        const overlapping = this.requests
            .listByEmployee(tenantId, input.employeeId)
            .find((r) => r.overlaps(input.startDate, input.endDate));
        if (overlapping) {
            throw new ConflictError(`Request overlaps existing ${overlapping.status} leave ${overlapping.startDate}..${overlapping.endDate}`);
        }
        const balance = this.ensureBalance(tenantId, input.employeeId, input.leaveType, yearOf(input.startDate));
        const request = LeaveRequest.submit(tenantId, { ...input, workingDays });
        balance.reserve(workingDays, policy.allowNegativeBalance);
        this.balances.save(balance);
        this.requests.save(request);
        this.outbox.append(request.pullEvents());
        if (!policy.requiresApproval) {
            request.approve(SYSTEM_DECIDER);
            balance.commitPending(workingDays);
            this.balances.save(balance);
            this.requests.save(request);
            this.outbox.append(request.pullEvents());
        }
        return request;
    }
    getRequest(tenantId, id) {
        const request = this.requests.findById(tenantId, id);
        if (!request)
            throw new NotFoundError("LeaveRequest", id);
        return request;
    }
    listRequests(tenantId, employeeId) {
        return this.requests.listByEmployee(tenantId, employeeId);
    }
    approve(tenantId, requestId, approverId) {
        const request = this.getRequest(tenantId, requestId);
        const balance = this.requireBalance(tenantId, request);
        request.approve(approverId);
        balance.commitPending(request.workingDays);
        this.balances.save(balance);
        this.requests.save(request);
        this.outbox.append(request.pullEvents());
        return request;
    }
    reject(tenantId, requestId, approverId, note) {
        const request = this.getRequest(tenantId, requestId);
        const balance = this.requireBalance(tenantId, request);
        request.reject(approverId, note);
        balance.release(request.workingDays);
        this.balances.save(balance);
        this.requests.save(request);
        this.outbox.append(request.pullEvents());
        return request;
    }
    /** Approved leave can only be cancelled before it starts. */
    cancel(tenantId, requestId) {
        const request = this.getRequest(tenantId, requestId);
        const balance = this.requireBalance(tenantId, request);
        const wasApproved = request.status === "approved";
        if (wasApproved && compareDates(this.clock.today(), request.startDate) >= 0) {
            throw new DomainError(`Leave starting ${request.startDate} has already begun and cannot be cancelled`, "LEAVE_ALREADY_STARTED", 409);
        }
        request.cancel();
        if (wasApproved) {
            balance.refundTaken(request.workingDays);
        }
        else {
            balance.release(request.workingDays);
        }
        this.balances.save(balance);
        this.requests.save(request);
        this.outbox.append(request.pullEvents());
        return request;
    }
    // ---------------------------------------------------------------- helpers
    requireBalance(tenantId, request) {
        const balance = this.balances.find(tenantId, request.employeeId, request.leaveType, yearOf(request.startDate));
        if (!balance) {
            throw new NotFoundError("LeaveBalance", `${request.employeeId}/${request.leaveType}`);
        }
        return balance;
    }
    holidaySetForRange(tenantId, start, end) {
        const dates = new Set();
        for (let year = yearOf(start); year <= yearOf(end); year += 1) {
            const calendar = this.calendars.findByYear(tenantId, year);
            if (calendar) {
                for (const date of calendar.holidayDates())
                    dates.add(date);
            }
        }
        return dates;
    }
}
//# sourceMappingURL=leave-service.js.map