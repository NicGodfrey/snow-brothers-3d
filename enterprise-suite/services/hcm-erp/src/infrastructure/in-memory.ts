import type { EventEnvelope, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { brand } from "@enterprise-suite/shared-kernel";
import type { AttendancePeriod } from "../domain/attendance.js";
import type { IsoDate } from "../domain/common.js";
import type { BonusAward, CompensationRecord } from "../domain/compensation.js";
import type { Employee, EmployeeStatus } from "../domain/employee.js";
import type { EmploymentContract } from "../domain/employment-contract.js";
import type {
  HolidayCalendar,
  LeaveBalance,
  LeavePolicy,
  LeaveRequest,
  LeaveTypeCode,
} from "../domain/leave.js";
import type { OrgUnit } from "../domain/org-unit.js";
import type { Position } from "../domain/position.js";
import type { HiringRequisition, RequisitionStatus } from "../domain/requisition.js";
import type {
  Certification,
  EmployeeCertification,
  EmployeeSkill,
  Skill,
} from "../domain/skills.js";
import type {
  AttendancePeriodRepository,
  BonusRepository,
  CertificationRepository,
  Clock,
  CompensationRepository,
  ContractRepository,
  EmployeeCertificationRepository,
  EmployeeRepository,
  EmployeeSkillRepository,
  EventOutbox,
  HcmRepositories,
  HolidayCalendarRepository,
  LeaveBalanceRepository,
  LeavePolicyRepository,
  LeaveRequestRepository,
  OrgUnitRepository,
  PositionRepository,
  Repository,
  SkillRepository,
} from "../application/ports.js";

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

export class SystemClock implements Clock {
  today(): IsoDate {
    return brand<string, "IsoDate">(new Date().toISOString().slice(0, 10));
  }
}

/** Deterministic clock for tests and replays. */
export class FixedClock implements Clock {
  constructor(private date: IsoDate) {}
  today(): IsoDate {
    return this.date;
  }
  set(date: IsoDate): void {
    this.date = date;
  }
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

/**
 * In-memory transactional outbox. `append` is called in the same "transaction"
 * as repository saves; `drain` hands events to a dispatcher exactly once.
 * Subscribers receive events synchronously on append (useful for projections
 * and tests) but never remove them from the outbox.
 */
export class InMemoryOutbox implements EventOutbox {
  private events: EventEnvelope[] = [];
  private readonly subscribers: Array<(event: EventEnvelope) => void> = [];

  append(events: readonly EventEnvelope[]): void {
    for (const event of events) {
      this.events.push(event);
      for (const subscriber of this.subscribers) subscriber(event);
    }
  }

  drain(): EventEnvelope[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  peek(): readonly EventEnvelope[] {
    return this.events;
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.subscribers.push(listener);
    return () => {
      const idx = this.subscribers.indexOf(listener);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
  }
}

// ---------------------------------------------------------------------------
// Generic in-memory store: tenant-partitioned map keyed by aggregate id
// ---------------------------------------------------------------------------

interface Identified {
  readonly id: Ulid;
  readonly tenantId: TenantId;
}

class InMemoryStore<T extends Identified> implements Repository<T> {
  protected readonly byTenant = new Map<TenantId, Map<Ulid, T>>();

  save(entity: T): void {
    let tenantMap = this.byTenant.get(entity.tenantId);
    if (!tenantMap) {
      tenantMap = new Map();
      this.byTenant.set(entity.tenantId, tenantMap);
    }
    tenantMap.set(entity.id, entity);
  }

  findById(tenantId: TenantId, id: Ulid): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  listByTenant(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }
}

// ---------------------------------------------------------------------------
// Concrete repositories
// ---------------------------------------------------------------------------

export class InMemoryOrgUnitRepository extends InMemoryStore<OrgUnit> implements OrgUnitRepository {
  findByCode(tenantId: TenantId, code: string): OrgUnit | undefined {
    return this.listByTenant(tenantId).find((u) => u.code === code);
  }
  findChildren(tenantId: TenantId, parentId: Ulid): OrgUnit[] {
    return this.listByTenant(tenantId).filter((u) => u.parentId === parentId);
  }
}

export class InMemoryPositionRepository extends InMemoryStore<Position> implements PositionRepository {
  findByOrgUnit(tenantId: TenantId, orgUnitId: Ulid): Position[] {
    return this.listByTenant(tenantId).filter((p) => p.orgUnitId === orgUnitId);
  }
}

export class InMemoryEmployeeRepository extends InMemoryStore<Employee> implements EmployeeRepository {
  findByEmployeeNumber(tenantId: TenantId, employeeNumber: string): Employee | undefined {
    return this.listByTenant(tenantId).find((e) => e.employeeNumber === employeeNumber);
  }
  findByManager(tenantId: TenantId, managerEmployeeId: Ulid): Employee[] {
    return this.listByTenant(tenantId).filter((e) => e.managerEmployeeId === managerEmployeeId);
  }
  listByStatus(tenantId: TenantId, status: EmployeeStatus): Employee[] {
    return this.listByTenant(tenantId).filter((e) => e.status === status);
  }
}

export class InMemoryContractRepository
  extends InMemoryStore<EmploymentContract>
  implements ContractRepository
{
  listByEmployee(tenantId: TenantId, employeeId: Ulid): EmploymentContract[] {
    return this.listByTenant(tenantId).filter((c) => c.employeeId === employeeId);
  }
  findActiveByEmployee(tenantId: TenantId, employeeId: Ulid): EmploymentContract | undefined {
    return this.listByEmployee(tenantId, employeeId).find((c) => c.status === "active");
  }
}

export class InMemoryLeavePolicyRepository
  extends InMemoryStore<LeavePolicy>
  implements LeavePolicyRepository
{
  findByType(tenantId: TenantId, leaveType: LeaveTypeCode): LeavePolicy | undefined {
    return this.listByTenant(tenantId).find((p) => p.leaveType === leaveType);
  }
}

export class InMemoryHolidayCalendarRepository
  extends InMemoryStore<HolidayCalendar>
  implements HolidayCalendarRepository
{
  findByYear(tenantId: TenantId, year: number): HolidayCalendar | undefined {
    return this.listByTenant(tenantId).find((c) => c.year === year);
  }
}

export class InMemoryLeaveBalanceRepository
  extends InMemoryStore<LeaveBalance>
  implements LeaveBalanceRepository
{
  find(
    tenantId: TenantId,
    employeeId: Ulid,
    leaveType: LeaveTypeCode,
    year: number,
  ): LeaveBalance | undefined {
    return this.listByTenant(tenantId).find(
      (b) => b.employeeId === employeeId && b.leaveType === leaveType && b.year === year,
    );
  }
  listByEmployee(tenantId: TenantId, employeeId: Ulid, year?: number): LeaveBalance[] {
    return this.listByTenant(tenantId).filter(
      (b) => b.employeeId === employeeId && (year === undefined || b.year === year),
    );
  }
}

export class InMemoryLeaveRequestRepository
  extends InMemoryStore<LeaveRequest>
  implements LeaveRequestRepository
{
  listByEmployee(tenantId: TenantId, employeeId: Ulid): LeaveRequest[] {
    return this.listByTenant(tenantId).filter((r) => r.employeeId === employeeId);
  }
}

export class InMemoryAttendancePeriodRepository
  extends InMemoryStore<AttendancePeriod>
  implements AttendancePeriodRepository
{
  find(tenantId: TenantId, employeeId: Ulid, year: number, month: number): AttendancePeriod | undefined {
    return this.listByTenant(tenantId).find(
      (p) => p.employeeId === employeeId && p.year === year && p.month === month,
    );
  }
  listByEmployee(tenantId: TenantId, employeeId: Ulid): AttendancePeriod[] {
    return this.listByTenant(tenantId).filter((p) => p.employeeId === employeeId);
  }
}

export class InMemoryCompensationRepository
  extends InMemoryStore<CompensationRecord>
  implements CompensationRepository
{
  findByEmployee(tenantId: TenantId, employeeId: Ulid): CompensationRecord | undefined {
    return this.listByTenant(tenantId).find((r) => r.employeeId === employeeId);
  }
}

export class InMemoryBonusRepository extends InMemoryStore<BonusAward> implements BonusRepository {
  listByEmployee(tenantId: TenantId, employeeId: Ulid): BonusAward[] {
    return this.listByTenant(tenantId).filter((b) => b.employeeId === employeeId);
  }
}

export class InMemorySkillRepository extends InMemoryStore<Skill> implements SkillRepository {
  findByCode(tenantId: TenantId, code: string): Skill | undefined {
    return this.listByTenant(tenantId).find((s) => s.code === code);
  }
}

export class InMemoryEmployeeSkillRepository
  extends InMemoryStore<EmployeeSkill>
  implements EmployeeSkillRepository
{
  find(tenantId: TenantId, employeeId: Ulid, skillId: Ulid): EmployeeSkill | undefined {
    return this.listByTenant(tenantId).find(
      (es) => es.employeeId === employeeId && es.skillId === skillId,
    );
  }
  listByEmployee(tenantId: TenantId, employeeId: Ulid): EmployeeSkill[] {
    return this.listByTenant(tenantId).filter((es) => es.employeeId === employeeId);
  }
  listBySkill(tenantId: TenantId, skillId: Ulid): EmployeeSkill[] {
    return this.listByTenant(tenantId).filter((es) => es.skillId === skillId);
  }
}

export class InMemoryCertificationRepository
  extends InMemoryStore<Certification>
  implements CertificationRepository
{
  findByCode(tenantId: TenantId, code: string): Certification | undefined {
    return this.listByTenant(tenantId).find((c) => c.code === code);
  }
}

export class InMemoryEmployeeCertificationRepository
  extends InMemoryStore<EmployeeCertification>
  implements EmployeeCertificationRepository
{
  listByEmployee(tenantId: TenantId, employeeId: Ulid): EmployeeCertification[] {
    return this.listByTenant(tenantId).filter((g) => g.employeeId === employeeId);
  }
  findActiveGrant(
    tenantId: TenantId,
    employeeId: Ulid,
    certificationId: Ulid,
  ): EmployeeCertification | undefined {
    return this.listByEmployee(tenantId, employeeId).find(
      (g) => g.certificationId === certificationId && g.status === "active",
    );
  }
}

export class InMemoryRequisitionRepository
  extends InMemoryStore<HiringRequisition>
  implements RequisitionRepository
{
  listByStatus(tenantId: TenantId, status: RequisitionStatus): HiringRequisition[] {
    return this.listByTenant(tenantId).filter((r) => r.status === status);
  }
  listByPosition(tenantId: TenantId, positionId: Ulid): HiringRequisition[] {
    return this.listByTenant(tenantId).filter((r) => r.positionId === positionId);
  }
}

export function createInMemoryRepositories(): HcmRepositories {
  return {
    orgUnits: new InMemoryOrgUnitRepository(),
    positions: new InMemoryPositionRepository(),
    employees: new InMemoryEmployeeRepository(),
    contracts: new InMemoryContractRepository(),
    leavePolicies: new InMemoryLeavePolicyRepository(),
    holidayCalendars: new InMemoryHolidayCalendarRepository(),
    leaveBalances: new InMemoryLeaveBalanceRepository(),
    leaveRequests: new InMemoryLeaveRequestRepository(),
    attendancePeriods: new InMemoryAttendancePeriodRepository(),
    compensationRecords: new InMemoryCompensationRepository(),
    bonuses: new InMemoryBonusRepository(),
    skills: new InMemorySkillRepository(),
    employeeSkills: new InMemoryEmployeeSkillRepository(),
    certifications: new InMemoryCertificationRepository(),
    employeeCertifications: new InMemoryEmployeeCertificationRepository(),
    requisitions: new InMemoryRequisitionRepository(),
  };
}
