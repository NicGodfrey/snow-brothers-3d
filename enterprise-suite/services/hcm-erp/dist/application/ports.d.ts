import type { EventEnvelope, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "../domain/common.js";
import type { AttendancePeriod } from "../domain/attendance.js";
import type { BonusAward, CompensationRecord } from "../domain/compensation.js";
import type { Employee, EmployeeStatus } from "../domain/employee.js";
import type { EmploymentContract } from "../domain/employment-contract.js";
import type { HolidayCalendar, LeaveBalance, LeavePolicy, LeaveRequest, LeaveTypeCode } from "../domain/leave.js";
import type { OrgUnit } from "../domain/org-unit.js";
import type { Position } from "../domain/position.js";
import type { HiringRequisition, RequisitionStatus } from "../domain/requisition.js";
import type { Certification, EmployeeCertification, EmployeeSkill, Skill } from "../domain/skills.js";
/**
 * Deterministic time source. Production uses SystemClock; tests use FixedClock
 * so leave/expiry rules can be exercised around any date.
 */
export interface Clock {
    today(): IsoDate;
}
/**
 * Transactional-outbox port. Services append the events pulled from
 * aggregates after persisting them; a dispatcher (integration-hub) drains.
 */
export interface EventOutbox {
    append(events: readonly EventEnvelope[]): void;
    /** Removes and returns all undispatched events, oldest first. */
    drain(): EventEnvelope[];
    /** Non-destructive view of undispatched events. */
    peek(): readonly EventEnvelope[];
}
/** Base repository shape shared by all aggregates/entities in this context. */
export interface Repository<T> {
    save(entity: T): void;
    findById(tenantId: TenantId, id: Ulid): T | undefined;
    listByTenant(tenantId: TenantId): T[];
}
export interface OrgUnitRepository extends Repository<OrgUnit> {
    findByCode(tenantId: TenantId, code: string): OrgUnit | undefined;
    findChildren(tenantId: TenantId, parentId: Ulid): OrgUnit[];
}
export interface PositionRepository extends Repository<Position> {
    findByOrgUnit(tenantId: TenantId, orgUnitId: Ulid): Position[];
}
export interface EmployeeRepository extends Repository<Employee> {
    findByEmployeeNumber(tenantId: TenantId, employeeNumber: string): Employee | undefined;
    findByManager(tenantId: TenantId, managerEmployeeId: Ulid): Employee[];
    listByStatus(tenantId: TenantId, status: EmployeeStatus): Employee[];
}
export interface ContractRepository extends Repository<EmploymentContract> {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): EmploymentContract[];
    findActiveByEmployee(tenantId: TenantId, employeeId: Ulid): EmploymentContract | undefined;
}
export interface LeavePolicyRepository extends Repository<LeavePolicy> {
    findByType(tenantId: TenantId, leaveType: LeaveTypeCode): LeavePolicy | undefined;
}
export interface HolidayCalendarRepository extends Repository<HolidayCalendar> {
    findByYear(tenantId: TenantId, year: number): HolidayCalendar | undefined;
}
export interface LeaveBalanceRepository extends Repository<LeaveBalance> {
    find(tenantId: TenantId, employeeId: Ulid, leaveType: LeaveTypeCode, year: number): LeaveBalance | undefined;
    listByEmployee(tenantId: TenantId, employeeId: Ulid, year?: number): LeaveBalance[];
}
export interface LeaveRequestRepository extends Repository<LeaveRequest> {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): LeaveRequest[];
}
export interface AttendancePeriodRepository extends Repository<AttendancePeriod> {
    find(tenantId: TenantId, employeeId: Ulid, year: number, month: number): AttendancePeriod | undefined;
    listByEmployee(tenantId: TenantId, employeeId: Ulid): AttendancePeriod[];
}
export interface CompensationRepository extends Repository<CompensationRecord> {
    findByEmployee(tenantId: TenantId, employeeId: Ulid): CompensationRecord | undefined;
}
export interface BonusRepository extends Repository<BonusAward> {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): BonusAward[];
}
export interface SkillRepository extends Repository<Skill> {
    findByCode(tenantId: TenantId, code: string): Skill | undefined;
}
export interface EmployeeSkillRepository extends Repository<EmployeeSkill> {
    find(tenantId: TenantId, employeeId: Ulid, skillId: Ulid): EmployeeSkill | undefined;
    listByEmployee(tenantId: TenantId, employeeId: Ulid): EmployeeSkill[];
    listBySkill(tenantId: TenantId, skillId: Ulid): EmployeeSkill[];
}
export interface CertificationRepository extends Repository<Certification> {
    findByCode(tenantId: TenantId, code: string): Certification | undefined;
}
export interface EmployeeCertificationRepository extends Repository<EmployeeCertification> {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): EmployeeCertification[];
    findActiveGrant(tenantId: TenantId, employeeId: Ulid, certificationId: Ulid): EmployeeCertification | undefined;
}
export interface RequisitionRepository extends Repository<HiringRequisition> {
    listByStatus(tenantId: TenantId, status: RequisitionStatus): HiringRequisition[];
    listByPosition(tenantId: TenantId, positionId: Ulid): HiringRequisition[];
}
/** All persistence ports bundled for service construction. */
export interface HcmRepositories {
    orgUnits: OrgUnitRepository;
    positions: PositionRepository;
    employees: EmployeeRepository;
    contracts: ContractRepository;
    leavePolicies: LeavePolicyRepository;
    holidayCalendars: HolidayCalendarRepository;
    leaveBalances: LeaveBalanceRepository;
    leaveRequests: LeaveRequestRepository;
    attendancePeriods: AttendancePeriodRepository;
    compensationRecords: CompensationRepository;
    bonuses: BonusRepository;
    skills: SkillRepository;
    employeeSkills: EmployeeSkillRepository;
    certifications: CertificationRepository;
    employeeCertifications: EmployeeCertificationRepository;
    requisitions: RequisitionRepository;
}
//# sourceMappingURL=ports.d.ts.map