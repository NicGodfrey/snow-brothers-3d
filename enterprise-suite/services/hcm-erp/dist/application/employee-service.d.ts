import { type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "../domain/common.js";
import { Employee, type EmployeeStatus, type TerminationReason } from "../domain/employee.js";
import type { ContractRepository, EmployeeRepository, EventOutbox, PositionRepository } from "./ports.js";
export declare class EmployeeService {
    private readonly employees;
    private readonly positions;
    private readonly contracts;
    private readonly outbox;
    constructor(employees: EmployeeRepository, positions: PositionRepository, contracts: ContractRepository, outbox: EventOutbox);
    hire(tenantId: TenantId, input: {
        employeeNumber: string;
        firstName: string;
        lastName: string;
        email: string;
        hireDate: IsoDate;
        managerEmployeeId?: Ulid;
    }): Employee;
    getEmployee(tenantId: TenantId, id: Ulid): Employee;
    listEmployees(tenantId: TenantId, status?: EmployeeStatus): Employee[];
    directReports(tenantId: TenantId, managerEmployeeId: Ulid): Employee[];
    updateContactInfo(tenantId: TenantId, id: Ulid, input: {
        firstName?: string;
        lastName?: string;
        email?: string;
    }): Employee;
    changeManager(tenantId: TenantId, id: Ulid, managerEmployeeId?: Ulid): Employee;
    placeOnLeave(tenantId: TenantId, id: Ulid): Employee;
    returnFromLeave(tenantId: TenantId, id: Ulid): Employee;
    suspend(tenantId: TenantId, id: Ulid, reason: string): Employee;
    reinstate(tenantId: TenantId, id: Ulid): Employee;
    /**
     * Offboarding orchestration: terminates the employee, vacates their
     * position, terminates active contracts, and re-parents direct reports to
     * the leaver's own manager so nobody is orphaned.
     */
    terminate(tenantId: TenantId, id: Ulid, input: {
        terminationDate: IsoDate;
        reason: TerminationReason;
        rehireEligible?: boolean;
    }): Employee;
    private applyTransition;
}
//# sourceMappingURL=employee-service.d.ts.map