import {
  ConflictError,
  DomainError,
  NotFoundError,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "../domain/common.js";
import { Employee, type EmployeeStatus, type TerminationReason } from "../domain/employee.js";
import type {
  ContractRepository,
  EmployeeRepository,
  EventOutbox,
  PositionRepository,
} from "./ports.js";

const MAX_CHAIN_DEPTH = 64;

export class EmployeeService {
  constructor(
    private readonly employees: EmployeeRepository,
    private readonly positions: PositionRepository,
    private readonly contracts: ContractRepository,
    private readonly outbox: EventOutbox,
  ) {}

  hire(
    tenantId: TenantId,
    input: {
      employeeNumber: string;
      firstName: string;
      lastName: string;
      email: string;
      hireDate: IsoDate;
      managerEmployeeId?: Ulid;
    },
  ): Employee {
    const normalizedNumber = input.employeeNumber.trim().toUpperCase();
    if (this.employees.findByEmployeeNumber(tenantId, normalizedNumber)) {
      throw new ConflictError(`Employee number already in use: ${normalizedNumber}`);
    }
    if (input.managerEmployeeId) {
      const manager = this.getEmployee(tenantId, input.managerEmployeeId);
      if (!manager.isEmployed()) {
        throw new ConflictError(`Manager ${manager.employeeNumber} is terminated`);
      }
    }
    const employee = Employee.hire(tenantId, input);
    this.employees.save(employee);
    this.outbox.append(employee.pullEvents());
    return employee;
  }

  getEmployee(tenantId: TenantId, id: Ulid): Employee {
    const employee = this.employees.findById(tenantId, id);
    if (!employee) throw new NotFoundError("Employee", id);
    return employee;
  }

  listEmployees(tenantId: TenantId, status?: EmployeeStatus): Employee[] {
    return status ? this.employees.listByStatus(tenantId, status) : this.employees.listByTenant(tenantId);
  }

  directReports(tenantId: TenantId, managerEmployeeId: Ulid): Employee[] {
    this.getEmployee(tenantId, managerEmployeeId);
    return this.employees.findByManager(tenantId, managerEmployeeId);
  }

  updateContactInfo(
    tenantId: TenantId,
    id: Ulid,
    input: { firstName?: string; lastName?: string; email?: string },
  ): Employee {
    const employee = this.getEmployee(tenantId, id);
    employee.updateContactInfo(input);
    this.employees.save(employee);
    return employee;
  }

  changeManager(tenantId: TenantId, id: Ulid, managerEmployeeId?: Ulid): Employee {
    const employee = this.getEmployee(tenantId, id);
    if (managerEmployeeId) {
      const manager = this.getEmployee(tenantId, managerEmployeeId);
      if (!manager.isEmployed()) {
        throw new ConflictError(`Manager ${manager.employeeNumber} is terminated`);
      }
      // Walking up from the new manager must never reach the employee.
      let cursor: Employee | undefined = manager;
      let depth = 0;
      while (cursor) {
        if (cursor.id === employee.id) {
          throw new DomainError(
            `Assigning ${manager.employeeNumber} as manager of ${employee.employeeNumber} creates a management cycle`,
            "MANAGEMENT_CYCLE",
            409,
          );
        }
        if (++depth > MAX_CHAIN_DEPTH) {
          throw new DomainError("Management chain exceeds maximum depth", "MANAGEMENT_CHAIN_TOO_DEEP", 500);
        }
        cursor = cursor.managerEmployeeId
          ? this.employees.findById(tenantId, cursor.managerEmployeeId)
          : undefined;
      }
    }
    employee.changeManager(managerEmployeeId);
    this.employees.save(employee);
    this.outbox.append(employee.pullEvents());
    return employee;
  }

  placeOnLeave(tenantId: TenantId, id: Ulid): Employee {
    return this.applyTransition(tenantId, id, (e) => e.placeOnLeave());
  }

  returnFromLeave(tenantId: TenantId, id: Ulid): Employee {
    return this.applyTransition(tenantId, id, (e) => e.returnFromLeave());
  }

  suspend(tenantId: TenantId, id: Ulid, reason: string): Employee {
    return this.applyTransition(tenantId, id, (e) => e.suspend(reason));
  }

  reinstate(tenantId: TenantId, id: Ulid): Employee {
    return this.applyTransition(tenantId, id, (e) => e.reinstate());
  }

  /**
   * Offboarding orchestration: terminates the employee, vacates their
   * position, terminates active contracts, and re-parents direct reports to
   * the leaver's own manager so nobody is orphaned.
   */
  terminate(
    tenantId: TenantId,
    id: Ulid,
    input: { terminationDate: IsoDate; reason: TerminationReason; rehireEligible?: boolean },
  ): Employee {
    const employee = this.getEmployee(tenantId, id);
    const newManagerForReports = employee.managerEmployeeId;

    employee.terminate({
      terminationDate: input.terminationDate,
      reason: input.reason,
      rehireEligible: input.rehireEligible ?? true,
    });

    if (employee.primaryPositionId) {
      const position = this.positions.findById(tenantId, employee.primaryPositionId);
      if (position && position.status === "filled" && position.currentEmployeeId === employee.id) {
        position.vacate();
        this.positions.save(position);
        this.outbox.append(position.pullEvents());
      }
      employee.clearPrimaryPosition();
    }

    const activeContract = this.contracts.findActiveByEmployee(tenantId, id);
    if (activeContract) {
      activeContract.terminate({ terminationDate: input.terminationDate, note: `employee ${input.reason}` });
      this.contracts.save(activeContract);
      this.outbox.append(activeContract.pullEvents());
    }

    for (const report of this.employees.findByManager(tenantId, id)) {
      report.changeManager(newManagerForReports);
      this.employees.save(report);
      this.outbox.append(report.pullEvents());
    }

    this.employees.save(employee);
    this.outbox.append(employee.pullEvents());
    return employee;
  }

  private applyTransition(tenantId: TenantId, id: Ulid, transition: (e: Employee) => void): Employee {
    const employee = this.getEmployee(tenantId, id);
    transition(employee);
    this.employees.save(employee);
    this.outbox.append(employee.pullEvents());
    return employee;
  }
}
