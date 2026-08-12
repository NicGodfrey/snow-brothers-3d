import type { Money, Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "./common.js";

/**
 * Canonical event types emitted by the HCM bounded context.
 * Names follow `hcm.<aggregate>.<past-tense-verb>` so consumers can
 * subscribe with prefix filters (e.g. everything under `hcm.employee.`).
 */
export const HcmEvents = {
  OrgUnitCreated: "hcm.org_unit.created",
  OrgUnitMoved: "hcm.org_unit.moved",
  OrgUnitDeactivated: "hcm.org_unit.deactivated",

  PositionOpened: "hcm.position.opened",
  PositionFilled: "hcm.position.filled",
  PositionVacated: "hcm.position.vacated",
  PositionFrozen: "hcm.position.frozen",
  PositionUnfrozen: "hcm.position.unfrozen",
  PositionEliminated: "hcm.position.eliminated",

  EmployeeHired: "hcm.employee.hired",
  EmployeeManagerChanged: "hcm.employee.manager_changed",
  EmployeePlacedOnLeave: "hcm.employee.placed_on_leave",
  EmployeeReturnedFromLeave: "hcm.employee.returned_from_leave",
  EmployeeSuspended: "hcm.employee.suspended",
  EmployeeReinstated: "hcm.employee.reinstated",
  EmployeeTerminated: "hcm.employee.terminated",

  ContractDrafted: "hcm.contract.drafted",
  ContractActivated: "hcm.contract.activated",
  ContractAmended: "hcm.contract.amended",
  ContractTerminated: "hcm.contract.terminated",
  ContractExpired: "hcm.contract.expired",

  LeaveRequested: "hcm.leave_request.submitted",
  LeaveApproved: "hcm.leave_request.approved",
  LeaveRejected: "hcm.leave_request.rejected",
  LeaveCancelled: "hcm.leave_request.cancelled",
  LeaveBalanceAccrued: "hcm.leave_balance.accrued",
  LeaveBalanceCarriedOver: "hcm.leave_balance.carried_over",

  AttendancePeriodOpened: "hcm.attendance_period.opened",
  AttendanceSubmitted: "hcm.attendance_period.submitted",
  AttendanceApproved: "hcm.attendance_period.approved",
  AttendanceReopened: "hcm.attendance_period.reopened",
  AttendanceLocked: "hcm.attendance_period.locked",

  CompensationInitialized: "hcm.compensation.initialized",
  SalaryChanged: "hcm.compensation.salary_changed",
  AllowanceAdded: "hcm.compensation.allowance_added",
  AllowanceRemoved: "hcm.compensation.allowance_removed",
  BonusAwarded: "hcm.bonus.awarded",
  BonusPaid: "hcm.bonus.paid",
  BonusCancelled: "hcm.bonus.cancelled",

  SkillAssessed: "hcm.skill.assessed",
  CertificationGranted: "hcm.certification.granted",
  CertificationRevoked: "hcm.certification.revoked",
  CertificationExpired: "hcm.certification.expired",

  RequisitionSubmitted: "hcm.requisition.submitted",
  RequisitionApproved: "hcm.requisition.approved",
  RequisitionRejected: "hcm.requisition.rejected",
  RequisitionOpened: "hcm.requisition.opened",
  RequisitionHeld: "hcm.requisition.held",
  RequisitionResumed: "hcm.requisition.resumed",
  RequisitionHireRecorded: "hcm.requisition.hire_recorded",
  RequisitionFilled: "hcm.requisition.filled",
  RequisitionCancelled: "hcm.requisition.cancelled",
} as const;

export type HcmEventType = (typeof HcmEvents)[keyof typeof HcmEvents];

// ---------------------------------------------------------------------------
// Payload shapes for the most integration-relevant events. Downstream
// consumers (finance, reporting, identity) should code against these.
// ---------------------------------------------------------------------------

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
