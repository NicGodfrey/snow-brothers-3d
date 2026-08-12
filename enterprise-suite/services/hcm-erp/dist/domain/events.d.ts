import type { Money, Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "./common.js";
/**
 * Canonical event types emitted by the HCM bounded context.
 * Names follow `hcm.<aggregate>.<past-tense-verb>` so consumers can
 * subscribe with prefix filters (e.g. everything under `hcm.employee.`).
 */
export declare const HcmEvents: {
    readonly OrgUnitCreated: "hcm.org_unit.created";
    readonly OrgUnitMoved: "hcm.org_unit.moved";
    readonly OrgUnitDeactivated: "hcm.org_unit.deactivated";
    readonly PositionOpened: "hcm.position.opened";
    readonly PositionFilled: "hcm.position.filled";
    readonly PositionVacated: "hcm.position.vacated";
    readonly PositionFrozen: "hcm.position.frozen";
    readonly PositionUnfrozen: "hcm.position.unfrozen";
    readonly PositionEliminated: "hcm.position.eliminated";
    readonly EmployeeHired: "hcm.employee.hired";
    readonly EmployeeManagerChanged: "hcm.employee.manager_changed";
    readonly EmployeePlacedOnLeave: "hcm.employee.placed_on_leave";
    readonly EmployeeReturnedFromLeave: "hcm.employee.returned_from_leave";
    readonly EmployeeSuspended: "hcm.employee.suspended";
    readonly EmployeeReinstated: "hcm.employee.reinstated";
    readonly EmployeeTerminated: "hcm.employee.terminated";
    readonly ContractDrafted: "hcm.contract.drafted";
    readonly ContractActivated: "hcm.contract.activated";
    readonly ContractAmended: "hcm.contract.amended";
    readonly ContractTerminated: "hcm.contract.terminated";
    readonly ContractExpired: "hcm.contract.expired";
    readonly LeaveRequested: "hcm.leave_request.submitted";
    readonly LeaveApproved: "hcm.leave_request.approved";
    readonly LeaveRejected: "hcm.leave_request.rejected";
    readonly LeaveCancelled: "hcm.leave_request.cancelled";
    readonly LeaveBalanceAccrued: "hcm.leave_balance.accrued";
    readonly LeaveBalanceCarriedOver: "hcm.leave_balance.carried_over";
    readonly AttendancePeriodOpened: "hcm.attendance_period.opened";
    readonly AttendanceSubmitted: "hcm.attendance_period.submitted";
    readonly AttendanceApproved: "hcm.attendance_period.approved";
    readonly AttendanceReopened: "hcm.attendance_period.reopened";
    readonly AttendanceLocked: "hcm.attendance_period.locked";
    readonly CompensationInitialized: "hcm.compensation.initialized";
    readonly SalaryChanged: "hcm.compensation.salary_changed";
    readonly AllowanceAdded: "hcm.compensation.allowance_added";
    readonly AllowanceRemoved: "hcm.compensation.allowance_removed";
    readonly BonusAwarded: "hcm.bonus.awarded";
    readonly BonusPaid: "hcm.bonus.paid";
    readonly BonusCancelled: "hcm.bonus.cancelled";
    readonly SkillAssessed: "hcm.skill.assessed";
    readonly CertificationGranted: "hcm.certification.granted";
    readonly CertificationRevoked: "hcm.certification.revoked";
    readonly CertificationExpired: "hcm.certification.expired";
    readonly RequisitionSubmitted: "hcm.requisition.submitted";
    readonly RequisitionApproved: "hcm.requisition.approved";
    readonly RequisitionRejected: "hcm.requisition.rejected";
    readonly RequisitionOpened: "hcm.requisition.opened";
    readonly RequisitionHeld: "hcm.requisition.held";
    readonly RequisitionResumed: "hcm.requisition.resumed";
    readonly RequisitionHireRecorded: "hcm.requisition.hire_recorded";
    readonly RequisitionFilled: "hcm.requisition.filled";
    readonly RequisitionCancelled: "hcm.requisition.cancelled";
};
export type HcmEventType = (typeof HcmEvents)[keyof typeof HcmEvents];
export interface EmployeeHiredPayload {
    employeeId: Ulid;
    employeeNumber: string;
    fullName: string;
    hireDate: IsoDate;
    positionId?: Ulid;
    orgUnitId?: Ulid;
}
export interface EmployeeTerminatedPayload {
    employeeId: Ulid;
    terminationDate: IsoDate;
    reason: string;
    rehireEligible: boolean;
}
export interface PositionFilledPayload {
    positionId: Ulid;
    employeeId: Ulid;
    orgUnitId: Ulid;
}
export interface LeaveDecisionPayload {
    leaveRequestId: Ulid;
    employeeId: Ulid;
    leaveType: string;
    startDate: IsoDate;
    endDate: IsoDate;
    workingDays: number;
    decidedBy?: Ulid;
}
export interface SalaryChangedPayload {
    employeeId: Ulid;
    previousSalary: Money;
    newSalary: Money;
    effectiveDate: IsoDate;
    reason: string;
}
export interface AttendanceApprovedPayload {
    attendancePeriodId: Ulid;
    employeeId: Ulid;
    year: number;
    month: number;
    totalHours: number;
    overtimeHours: number;
}
export interface RequisitionFilledPayload {
    requisitionId: Ulid;
    positionId: Ulid;
    hiredEmployeeIds: Ulid[];
}
//# sourceMappingURL=events.d.ts.map