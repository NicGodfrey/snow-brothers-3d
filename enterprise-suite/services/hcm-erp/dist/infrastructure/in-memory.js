import { brand } from "@enterprise-suite/shared-kernel";
// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------
export class SystemClock {
    today() {
        return brand(new Date().toISOString().slice(0, 10));
    }
}
/** Deterministic clock for tests and replays. */
export class FixedClock {
    date;
    constructor(date) {
        this.date = date;
    }
    today() {
        return this.date;
    }
    set(date) {
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
export class InMemoryOutbox {
    events = [];
    subscribers = [];
    append(events) {
        for (const event of events) {
            this.events.push(event);
            for (const subscriber of this.subscribers)
                subscriber(event);
        }
    }
    drain() {
        const drained = this.events;
        this.events = [];
        return drained;
    }
    peek() {
        return this.events;
    }
    subscribe(listener) {
        this.subscribers.push(listener);
        return () => {
            const idx = this.subscribers.indexOf(listener);
            if (idx >= 0)
                this.subscribers.splice(idx, 1);
        };
    }
}
class InMemoryStore {
    byTenant = new Map();
    save(entity) {
        let tenantMap = this.byTenant.get(entity.tenantId);
        if (!tenantMap) {
            tenantMap = new Map();
            this.byTenant.set(entity.tenantId, tenantMap);
        }
        tenantMap.set(entity.id, entity);
    }
    findById(tenantId, id) {
        return this.byTenant.get(tenantId)?.get(id);
    }
    listByTenant(tenantId) {
        return [...(this.byTenant.get(tenantId)?.values() ?? [])];
    }
}
// ---------------------------------------------------------------------------
// Concrete repositories
// ---------------------------------------------------------------------------
export class InMemoryOrgUnitRepository extends InMemoryStore {
    findByCode(tenantId, code) {
        return this.listByTenant(tenantId).find((u) => u.code === code);
    }
    findChildren(tenantId, parentId) {
        return this.listByTenant(tenantId).filter((u) => u.parentId === parentId);
    }
}
export class InMemoryPositionRepository extends InMemoryStore {
    findByOrgUnit(tenantId, orgUnitId) {
        return this.listByTenant(tenantId).filter((p) => p.orgUnitId === orgUnitId);
    }
}
export class InMemoryEmployeeRepository extends InMemoryStore {
    findByEmployeeNumber(tenantId, employeeNumber) {
        return this.listByTenant(tenantId).find((e) => e.employeeNumber === employeeNumber);
    }
    findByManager(tenantId, managerEmployeeId) {
        return this.listByTenant(tenantId).filter((e) => e.managerEmployeeId === managerEmployeeId);
    }
    listByStatus(tenantId, status) {
        return this.listByTenant(tenantId).filter((e) => e.status === status);
    }
}
export class InMemoryContractRepository extends InMemoryStore {
    listByEmployee(tenantId, employeeId) {
        return this.listByTenant(tenantId).filter((c) => c.employeeId === employeeId);
    }
    findActiveByEmployee(tenantId, employeeId) {
        return this.listByEmployee(tenantId, employeeId).find((c) => c.status === "active");
    }
}
export class InMemoryLeavePolicyRepository extends InMemoryStore {
    findByType(tenantId, leaveType) {
        return this.listByTenant(tenantId).find((p) => p.leaveType === leaveType);
    }
}
export class InMemoryHolidayCalendarRepository extends InMemoryStore {
    findByYear(tenantId, year) {
        return this.listByTenant(tenantId).find((c) => c.year === year);
    }
}
export class InMemoryLeaveBalanceRepository extends InMemoryStore {
    find(tenantId, employeeId, leaveType, year) {
        return this.listByTenant(tenantId).find((b) => b.employeeId === employeeId && b.leaveType === leaveType && b.year === year);
    }
    listByEmployee(tenantId, employeeId, year) {
        return this.listByTenant(tenantId).filter((b) => b.employeeId === employeeId && (year === undefined || b.year === year));
    }
}
export class InMemoryLeaveRequestRepository extends InMemoryStore {
    listByEmployee(tenantId, employeeId) {
        return this.listByTenant(tenantId).filter((r) => r.employeeId === employeeId);
    }
}
export class InMemoryAttendancePeriodRepository extends InMemoryStore {
    find(tenantId, employeeId, year, month) {
        return this.listByTenant(tenantId).find((p) => p.employeeId === employeeId && p.year === year && p.month === month);
    }
    listByEmployee(tenantId, employeeId) {
        return this.listByTenant(tenantId).filter((p) => p.employeeId === employeeId);
    }
}
export class InMemoryCompensationRepository extends InMemoryStore {
    findByEmployee(tenantId, employeeId) {
        return this.listByTenant(tenantId).find((r) => r.employeeId === employeeId);
    }
}
export class InMemoryBonusRepository extends InMemoryStore {
    listByEmployee(tenantId, employeeId) {
        return this.listByTenant(tenantId).filter((b) => b.employeeId === employeeId);
    }
}
export class InMemorySkillRepository extends InMemoryStore {
    findByCode(tenantId, code) {
        return this.listByTenant(tenantId).find((s) => s.code === code);
    }
}
export class InMemoryEmployeeSkillRepository extends InMemoryStore {
    find(tenantId, employeeId, skillId) {
        return this.listByTenant(tenantId).find((es) => es.employeeId === employeeId && es.skillId === skillId);
    }
    listByEmployee(tenantId, employeeId) {
        return this.listByTenant(tenantId).filter((es) => es.employeeId === employeeId);
    }
    listBySkill(tenantId, skillId) {
        return this.listByTenant(tenantId).filter((es) => es.skillId === skillId);
    }
}
export class InMemoryCertificationRepository extends InMemoryStore {
    findByCode(tenantId, code) {
        return this.listByTenant(tenantId).find((c) => c.code === code);
    }
}
export class InMemoryEmployeeCertificationRepository extends InMemoryStore {
    listByEmployee(tenantId, employeeId) {
        return this.listByTenant(tenantId).filter((g) => g.employeeId === employeeId);
    }
    findActiveGrant(tenantId, employeeId, certificationId) {
        return this.listByEmployee(tenantId, employeeId).find((g) => g.certificationId === certificationId && g.status === "active");
    }
}
export class InMemoryRequisitionRepository extends InMemoryStore {
    listByStatus(tenantId, status) {
        return this.listByTenant(tenantId).filter((r) => r.status === status);
    }
    listByPosition(tenantId, positionId) {
        return this.listByTenant(tenantId).filter((r) => r.positionId === positionId);
    }
}
export function createInMemoryRepositories() {
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
//# sourceMappingURL=in-memory.js.map