import type { EventEnvelope, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { AttendancePeriod } from "../domain/attendance.js";
import type { IsoDate } from "../domain/common.js";
import type { BonusAward, CompensationRecord } from "../domain/compensation.js";
import type { Employee, EmployeeStatus } from "../domain/employee.js";
import type { EmploymentContract } from "../domain/employment-contract.js";
import type { HolidayCalendar, LeaveBalance, LeavePolicy, LeaveRequest, LeaveTypeCode } from "../domain/leave.js";
import type { OrgUnit } from "../domain/org-unit.js";
import type { Position } from "../domain/position.js";
import type { HiringRequisition, RequisitionStatus } from "../domain/requisition.js";
import type { Certification, EmployeeCertification, EmployeeSkill, Skill } from "../domain/skills.js";
import type { AttendancePeriodRepository, BonusRepository, CertificationRepository, Clock, CompensationRepository, ContractRepository, EmployeeCertificationRepository, EmployeeRepository, EmployeeSkillRepository, EventOutbox, HcmRepositories, HolidayCalendarRepository, LeaveBalanceRepository, LeavePolicyRepository, LeaveRequestRepository, OrgUnitRepository, PositionRepository, Repository, RequisitionRepository, SkillRepository } from "../application/ports.js";
export declare class SystemClock implements Clock {
    today(): IsoDate;
}
/** Deterministic clock for tests and replays. */
export declare class FixedClock implements Clock {
    private date;
    constructor(date: IsoDate);
    today(): IsoDate;
    set(date: IsoDate): void;
}
/**
 * In-memory transactional outbox. `append` is called in the same "transaction"
 * as repository saves; `drain` hands events to a dispatcher exactly once.
 * Subscribers receive events synchronously on append (useful for projections
 * and tests) but never remove them from the outbox.
 */
export declare class InMemoryOutbox implements EventOutbox {
    private events;
    private readonly subscribers;
    append(events: readonly EventEnvelope[]): void;
    drain(): EventEnvelope[];
    peek(): readonly EventEnvelope[];
    subscribe(listener: (event: EventEnvelope) => void): () => void;
}
interface Identified {
    readonly id: Ulid;
    readonly tenantId: TenantId;
}
declare class InMemoryStore<T extends Identified> implements Repository<T> {
    protected readonly byTenant: Map<TenantId, Map<Ulid, T>>;
    save(entity: T): void;
    findById(tenantId: TenantId, id: Ulid): T | undefined;
    listByTenant(tenantId: TenantId): T[];
}
export declare class InMemoryOrgUnitRepository extends InMemoryStore<OrgUnit> implements OrgUnitRepository {
    findByCode(tenantId: TenantId, code: string): OrgUnit | undefined;
    findChildren(tenantId: TenantId, parentId: Ulid): OrgUnit[];
}
export declare class InMemoryPositionRepository extends InMemoryStore<Position> implements PositionRepository {
    findByOrgUnit(tenantId: TenantId, orgUnitId: Ulid): Position[];
}
export declare class InMemoryEmployeeRepository extends InMemoryStore<Employee> implements EmployeeRepository {
    findByEmployeeNumber(tenantId: TenantId, employeeNumber: string): Employee | undefined;
    findByManager(tenantId: TenantId, managerEmployeeId: Ulid): Employee[];
    listByStatus(tenantId: TenantId, status: EmployeeStatus): Employee[];
}
export declare class InMemoryContractRepository extends InMemoryStore<EmploymentContract> implements ContractRepository {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): EmploymentContract[];
    findActiveByEmployee(tenantId: TenantId, employeeId: Ulid): EmploymentContract | undefined;
}
export declare class InMemoryLeavePolicyRepository extends InMemoryStore<LeavePolicy> implements LeavePolicyRepository {
    findByType(tenantId: TenantId, leaveType: LeaveTypeCode): LeavePolicy | undefined;
}
export declare class InMemoryHolidayCalendarRepository extends InMemoryStore<HolidayCalendar> implements HolidayCalendarRepository {
    findByYear(tenantId: TenantId, year: number): HolidayCalendar | undefined;
}
export declare class InMemoryLeaveBalanceRepository extends InMemoryStore<LeaveBalance> implements LeaveBalanceRepository {
    find(tenantId: TenantId, employeeId: Ulid, leaveType: LeaveTypeCode, year: number): LeaveBalance | undefined;
    listByEmployee(tenantId: TenantId, employeeId: Ulid, year?: number): LeaveBalance[];
}
export declare class InMemoryLeaveRequestRepository extends InMemoryStore<LeaveRequest> implements LeaveRequestRepository {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): LeaveRequest[];
}
export declare class InMemoryAttendancePeriodRepository extends InMemoryStore<AttendancePeriod> implements AttendancePeriodRepository {
    find(tenantId: TenantId, employeeId: Ulid, year: number, month: number): AttendancePeriod | undefined;
    listByEmployee(tenantId: TenantId, employeeId: Ulid): AttendancePeriod[];
}
export declare class InMemoryCompensationRepository extends InMemoryStore<CompensationRecord> implements CompensationRepository {
    findByEmployee(tenantId: TenantId, employeeId: Ulid): CompensationRecord | undefined;
}
export declare class InMemoryBonusRepository extends InMemoryStore<BonusAward> implements BonusRepository {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): BonusAward[];
}
export declare class InMemorySkillRepository extends InMemoryStore<Skill> implements SkillRepository {
    findByCode(tenantId: TenantId, code: string): Skill | undefined;
}
export declare class InMemoryEmployeeSkillRepository extends InMemoryStore<EmployeeSkill> implements EmployeeSkillRepository {
    find(tenantId: TenantId, employeeId: Ulid, skillId: Ulid): EmployeeSkill | undefined;
    listByEmployee(tenantId: TenantId, employeeId: Ulid): EmployeeSkill[];
    listBySkill(tenantId: TenantId, skillId: Ulid): EmployeeSkill[];
}
export declare class InMemoryCertificationRepository extends InMemoryStore<Certification> implements CertificationRepository {
    findByCode(tenantId: TenantId, code: string): Certification | undefined;
}
export declare class InMemoryEmployeeCertificationRepository extends InMemoryStore<EmployeeCertification> implements EmployeeCertificationRepository {
    listByEmployee(tenantId: TenantId, employeeId: Ulid): EmployeeCertification[];
    findActiveGrant(tenantId: TenantId, employeeId: Ulid, certificationId: Ulid): EmployeeCertification | undefined;
}
export declare class InMemoryRequisitionRepository extends InMemoryStore<HiringRequisition> implements RequisitionRepository {
    listByStatus(tenantId: TenantId, status: RequisitionStatus): HiringRequisition[];
    listByPosition(tenantId: TenantId, positionId: Ulid): HiringRequisition[];
}
export declare function createInMemoryRepositories(): HcmRepositories;
export {};
//# sourceMappingURL=in-memory.d.ts.map