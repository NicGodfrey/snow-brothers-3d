import {
  AggregateRoot,
  DomainError,
  Entity,
  envelope,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { assertRange, round2, type IsoDate } from "./common.js";
import { HcmEvents } from "./events.js";

/** Well-known leave type codes; tenants may define additional custom codes. */
export const STANDARD_LEAVE_TYPES = ["annual", "sick", "parental", "unpaid", "bereavement"] as const;
export type LeaveTypeCode = string;

const LEAVE_TYPE_RE = /^[a-z][a-z0-9_]{2,31}$/;

// ---------------------------------------------------------------------------
// LeavePolicy — per-tenant rules for one leave type
// ---------------------------------------------------------------------------

export interface LeavePolicyProps {
  leaveType: LeaveTypeCode;
  name: string;
  accrualDaysPerYear: number;
  maxCarryoverDays: number;
  requiresApproval: boolean;
  allowNegativeBalance: boolean;
  paid: boolean;
}

export class LeavePolicy extends Entity<LeavePolicyProps> {
  private constructor(tenantId: TenantId, props: LeavePolicyProps) {
    super(tenantId, props);
  }

  static define(
    tenantId: TenantId,
    input: {
      leaveType: string;
      name: string;
      accrualDaysPerYear: number;
      maxCarryoverDays?: number;
      requiresApproval?: boolean;
      allowNegativeBalance?: boolean;
      paid?: boolean;
    },
  ): LeavePolicy {
    const leaveType = input.leaveType.trim().toLowerCase();
    if (!LEAVE_TYPE_RE.test(leaveType)) {
      throw new DomainError(
        `Leave type code must be 3-32 chars of a-z, 0-9, '_': got "${input.leaveType}"`,
        "INVALID_LEAVE_TYPE",
      );
    }
    if (input.accrualDaysPerYear < 0 || input.accrualDaysPerYear > 366) {
      throw new DomainError("Accrual days per year must be within [0, 366]", "INVALID_ACCRUAL");
    }
    if ((input.maxCarryoverDays ?? 0) < 0) {
      throw new DomainError("Max carryover days cannot be negative", "INVALID_CARRYOVER");
    }
    return new LeavePolicy(tenantId, {
      leaveType,
      name: input.name.trim() || leaveType,
      accrualDaysPerYear: input.accrualDaysPerYear,
      maxCarryoverDays: input.maxCarryoverDays ?? 0,
      requiresApproval: input.requiresApproval ?? true,
      allowNegativeBalance: input.allowNegativeBalance ?? false,
      paid: input.paid ?? true,
    });
  }

  get leaveType(): LeaveTypeCode {
    return this.props.leaveType;
  }
  get name(): string {
    return this.props.name;
  }
  get accrualDaysPerYear(): number {
    return this.props.accrualDaysPerYear;
  }
  get maxCarryoverDays(): number {
    return this.props.maxCarryoverDays;
  }
  get requiresApproval(): boolean {
    return this.props.requiresApproval;
  }
  get allowNegativeBalance(): boolean {
    return this.props.allowNegativeBalance;
  }
  get paid(): boolean {
    return this.props.paid;
  }

  /** One month's worth of accrual (1/12 of the annual figure, 2dp). */
  monthlyAccrualDays(): number {
    return round2(this.props.accrualDaysPerYear / 12);
  }

  /**
   * Entitlement for the hire year, pro-rated by full months remaining
   * including the hire month. Hired in July → 6/12 of the annual figure.
   */
  proRatedEntitlement(hireMonth1Based: number): number {
    const monthsRemaining = 12 - hireMonth1Based + 1;
    return round2((this.props.accrualDaysPerYear * monthsRemaining) / 12);
  }
}

// ---------------------------------------------------------------------------
// HolidayCalendar — public holidays excluded from working-day counts
// ---------------------------------------------------------------------------

export interface Holiday {
  readonly date: IsoDate;
  readonly name: string;
}

export interface HolidayCalendarProps {
  year: number;
  holidays: Holiday[];
}

export class HolidayCalendar extends Entity<HolidayCalendarProps> {
  private constructor(tenantId: TenantId, props: HolidayCalendarProps) {
    super(tenantId, props);
  }

  static define(tenantId: TenantId, year: number, holidays: Holiday[]): HolidayCalendar {
    if (year < 1900 || year > 2200) throw new DomainError(`Implausible year: ${year}`, "INVALID_YEAR");
    const seen = new Set<string>();
    for (const h of holidays) {
      if (!h.date.startsWith(String(year))) {
        throw new DomainError(`Holiday ${h.date} is outside calendar year ${year}`, "HOLIDAY_OUT_OF_YEAR");
      }
      if (seen.has(h.date)) {
        throw new DomainError(`Duplicate holiday date ${h.date}`, "DUPLICATE_HOLIDAY");
      }
      seen.add(h.date);
    }
    return new HolidayCalendar(tenantId, { year, holidays: [...holidays] });
  }

  get year(): number {
    return this.props.year;
  }
  get holidays(): readonly Holiday[] {
    return this.props.holidays;
  }

  holidayDates(): ReadonlySet<string> {
    return new Set(this.props.holidays.map((h) => h.date));
  }
}

// ---------------------------------------------------------------------------
// LeaveBalance — per employee, leave type, and calendar year
// ---------------------------------------------------------------------------

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

export class LeaveBalance extends Entity<LeaveBalanceProps> {
  private constructor(tenantId: TenantId, props: LeaveBalanceProps) {
    super(tenantId, props);
  }

  static open(tenantId: TenantId, employeeId: Ulid, leaveType: LeaveTypeCode, year: number): LeaveBalance {
    return new LeaveBalance(tenantId, {
      employeeId,
      leaveType,
      year,
      entitledDays: 0,
      accruedDays: 0,
      carriedOverDays: 0,
      adjustmentDays: 0,
      takenDays: 0,
      pendingDays: 0,
    });
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get leaveType(): LeaveTypeCode {
    return this.props.leaveType;
  }
  get year(): number {
    return this.props.year;
  }
  get takenDays(): number {
    return this.props.takenDays;
  }
  get pendingDays(): number {
    return this.props.pendingDays;
  }
  get entitledDays(): number {
    return this.props.entitledDays;
  }
  get accruedDays(): number {
    return this.props.accruedDays;
  }
  get carriedOverDays(): number {
    return this.props.carriedOverDays;
  }

  /** Days still available to request. */
  get availableDays(): number {
    return round2(
      this.props.entitledDays +
        this.props.accruedDays +
        this.props.carriedOverDays +
        this.props.adjustmentDays -
        this.props.takenDays -
        this.props.pendingDays,
    );
  }

  /** Remaining days ignoring pending reservations — used for carryover. */
  get remainingDays(): number {
    return round2(
      this.props.entitledDays +
        this.props.accruedDays +
        this.props.carriedOverDays +
        this.props.adjustmentDays -
        this.props.takenDays,
    );
  }

  grantEntitlement(days: number): void {
    if (days < 0) throw new DomainError("Entitlement grant cannot be negative", "INVALID_GRANT");
    this.props.entitledDays = round2(this.props.entitledDays + days);
    this.touch();
  }

  accrue(days: number): void {
    if (days < 0) throw new DomainError("Accrual cannot be negative", "INVALID_ACCRUAL");
    this.props.accruedDays = round2(this.props.accruedDays + days);
    this.touch();
  }

  applyCarryover(days: number): void {
    if (days < 0) throw new DomainError("Carryover cannot be negative", "INVALID_CARRYOVER");
    this.props.carriedOverDays = round2(this.props.carriedOverDays + days);
    this.touch();
  }

  adjust(deltaDays: number): void {
    this.props.adjustmentDays = round2(this.props.adjustmentDays + deltaDays);
    this.touch();
  }

  /** Reserves days for a submitted request. */
  reserve(days: number, allowNegative: boolean): void {
    if (days <= 0) throw new DomainError("Reservation must be positive", "INVALID_RESERVATION");
    if (!allowNegative && this.availableDays < days) {
      throw new DomainError(
        `Insufficient ${this.props.leaveType} balance: requested ${days}, available ${this.availableDays}`,
        "INSUFFICIENT_LEAVE_BALANCE",
        409,
      );
    }
    this.props.pendingDays = round2(this.props.pendingDays + days);
    this.touch();
  }

  /** Releases a reservation (request rejected or cancelled before approval). */
  release(days: number): void {
    if (days > this.props.pendingDays + 1e-9) {
      throw new DomainError(
        `Cannot release ${days} days; only ${this.props.pendingDays} pending`,
        "INVALID_RELEASE",
      );
    }
    this.props.pendingDays = round2(this.props.pendingDays - days);
    this.touch();
  }

  /** Converts a reservation into consumed days (request approved). */
  commitPending(days: number): void {
    this.release(days);
    this.props.takenDays = round2(this.props.takenDays + days);
    this.touch();
  }

  /** Returns consumed days (approved future request cancelled). */
  refundTaken(days: number): void {
    if (days > this.props.takenDays + 1e-9) {
      throw new DomainError(`Cannot refund ${days} days; only ${this.props.takenDays} taken`, "INVALID_REFUND");
    }
    this.props.takenDays = round2(this.props.takenDays - days);
    this.touch();
  }
}

// ---------------------------------------------------------------------------
// LeaveRequest — the approval workflow aggregate
// ---------------------------------------------------------------------------

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

export class LeaveRequest extends AggregateRoot<LeaveRequestProps> {
  private constructor(tenantId: TenantId, props: LeaveRequestProps) {
    super(tenantId, props);
  }

  /** `workingDays` is computed by LeaveService using the tenant holiday calendar. */
  static submit(
    tenantId: TenantId,
    input: {
      employeeId: Ulid;
      leaveType: LeaveTypeCode;
      startDate: IsoDate;
      endDate: IsoDate;
      workingDays: number;
      reason?: string;
    },
  ): LeaveRequest {
    assertRange(input.startDate, input.endDate, "Leave request");
    if (input.workingDays <= 0) {
      throw new DomainError(
        "Leave request covers no working days (weekend/holiday only)",
        "NO_WORKING_DAYS",
      );
    }
    const request = new LeaveRequest(tenantId, {
      employeeId: input.employeeId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      workingDays: input.workingDays,
      reason: input.reason?.trim() || undefined,
      status: "submitted",
    });
    request.raise(
      envelope({
        eventType: HcmEvents.LeaveRequested,
        aggregateType: "LeaveRequest",
        aggregateId: request.id,
        tenantId,
        payload: request.decisionPayload(),
      }),
    );
    return request;
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get leaveType(): LeaveTypeCode {
    return this.props.leaveType;
  }
  get startDate(): IsoDate {
    return this.props.startDate;
  }
  get endDate(): IsoDate {
    return this.props.endDate;
  }
  get workingDays(): number {
    return this.props.workingDays;
  }
  get status(): LeaveRequestStatus {
    return this.props.status;
  }

  /** True when this request blocks another request over [start, end]. */
  overlaps(start: IsoDate, end: IsoDate): boolean {
    if (this.props.status === "rejected" || this.props.status === "cancelled") return false;
    return this.props.startDate <= end && start <= this.props.endDate;
  }

  approve(decidedBy: Ulid): void {
    this.assertPending("approve");
    if (decidedBy === this.props.employeeId) {
      throw new DomainError("Employees cannot approve their own leave requests", "SELF_APPROVAL", 403);
    }
    this.props.status = "approved";
    this.props.decidedBy = decidedBy;
    this.props.decidedAt = nowIso();
    this.raise(
      envelope({
        eventType: HcmEvents.LeaveApproved,
        aggregateType: "LeaveRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: this.decisionPayload(decidedBy),
      }),
    );
  }

  reject(decidedBy: Ulid, note: string): void {
    this.assertPending("reject");
    if (!note.trim()) {
      throw new DomainError("A rejection must include a note for the employee", "REJECTION_NOTE_REQUIRED");
    }
    this.props.status = "rejected";
    this.props.decidedBy = decidedBy;
    this.props.decidedAt = nowIso();
    this.props.decisionNote = note.trim();
    this.raise(
      envelope({
        eventType: HcmEvents.LeaveRejected,
        aggregateType: "LeaveRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: this.decisionPayload(decidedBy),
      }),
    );
  }

  /** Whether cancellation is still allowed is checked by LeaveService (needs today's date). */
  cancel(): void {
    if (this.props.status !== "submitted" && this.props.status !== "approved") {
      throw new DomainError(
        `Cannot cancel a ${this.props.status} leave request`,
        "INVALID_STATUS_TRANSITION",
        409,
      );
    }
    const wasApproved = this.props.status === "approved";
    this.props.status = "cancelled";
    this.props.cancelledAt = nowIso();
    this.raise(
      envelope({
        eventType: HcmEvents.LeaveCancelled,
        aggregateType: "LeaveRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.decisionPayload(), wasApproved },
      }),
    );
  }

  private assertPending(action: string): void {
    if (this.props.status !== "submitted") {
      throw new DomainError(
        `Cannot ${action} a leave request in status ${this.props.status}`,
        "INVALID_STATUS_TRANSITION",
        409,
      );
    }
  }

  private decisionPayload(decidedBy?: Ulid) {
    return {
      leaveRequestId: this.id,
      employeeId: this.props.employeeId,
      leaveType: this.props.leaveType,
      startDate: this.props.startDate,
      endDate: this.props.endDate,
      workingDays: this.props.workingDays,
      decidedBy,
    };
  }
}
