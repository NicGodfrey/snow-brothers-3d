import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { CompensationRecord } from "../domain/compensation.js";
import { EmploymentContract, } from "../domain/employment-contract.js";
export class ContractService {
    contracts;
    employees;
    positions;
    compensationRecords;
    outbox;
    clock;
    constructor(contracts, employees, positions, compensationRecords, outbox, clock) {
        this.contracts = contracts;
        this.employees = employees;
        this.positions = positions;
        this.compensationRecords = compensationRecords;
        this.outbox = outbox;
        this.clock = clock;
    }
    draftContract(tenantId, input) {
        const employee = this.employees.findById(tenantId, input.employeeId);
        if (!employee)
            throw new NotFoundError("Employee", input.employeeId);
        if (!employee.isEmployed()) {
            throw new ConflictError(`Cannot draft a contract for terminated employee ${employee.employeeNumber}`);
        }
        const position = this.positions.findById(tenantId, input.positionId);
        if (!position)
            throw new NotFoundError("Position", input.positionId);
        if (position.status === "eliminated") {
            throw new ConflictError(`Position "${position.title}" has been eliminated`);
        }
        const contract = EmploymentContract.draft(tenantId, input);
        this.contracts.save(contract);
        this.outbox.append(contract.pullEvents());
        return contract;
    }
    getContract(tenantId, id) {
        const contract = this.contracts.findById(tenantId, id);
        if (!contract)
            throw new NotFoundError("EmploymentContract", id);
        return contract;
    }
    listByEmployee(tenantId, employeeId) {
        return this.contracts.listByEmployee(tenantId, employeeId);
    }
    /**
     * Activation is the onboarding pivot: the position is filled, the employee
     * gains a primary position, and a compensation record is initialized from
     * the contract terms when none exists yet.
     */
    activateContract(tenantId, id, activatedBy) {
        const contract = this.getContract(tenantId, id);
        const employee = this.employees.findById(tenantId, contract.employeeId);
        if (!employee)
            throw new NotFoundError("Employee", contract.employeeId);
        if (!employee.isEmployed()) {
            throw new ConflictError(`Employee ${employee.employeeNumber} is terminated`);
        }
        const existingActive = this.contracts.findActiveByEmployee(tenantId, contract.employeeId);
        if (existingActive) {
            throw new ConflictError(`Employee ${employee.employeeNumber} already has an active contract (${existingActive.id})`);
        }
        const position = this.positions.findById(tenantId, contract.positionId);
        if (!position)
            throw new NotFoundError("Position", contract.positionId);
        if (!position.isFillable()) {
            throw new ConflictError(`Position "${position.title}" is ${position.status} and cannot be filled`);
        }
        contract.activate();
        position.fill(contract.employeeId);
        employee.assignPrimaryPosition(position.id);
        this.contracts.save(contract);
        this.positions.save(position);
        this.employees.save(employee);
        this.outbox.append(contract.pullEvents());
        this.outbox.append(position.pullEvents());
        this.outbox.append(employee.pullEvents());
        if (!this.compensationRecords.findByEmployee(tenantId, contract.employeeId)) {
            const record = CompensationRecord.initialize(tenantId, {
                employeeId: contract.employeeId,
                annualBaseSalary: contract.baseSalary,
                payFrequency: contract.payFrequency,
                effectiveDate: contract.startDate,
                changedBy: activatedBy,
            });
            this.compensationRecords.save(record);
            this.outbox.append(record.pullEvents());
        }
        return contract;
    }
    amendContract(tenantId, id, input) {
        const contract = this.getContract(tenantId, id);
        contract.amend(input);
        this.contracts.save(contract);
        this.outbox.append(contract.pullEvents());
        return contract;
    }
    terminateContract(tenantId, id, input) {
        const contract = this.getContract(tenantId, id);
        contract.terminate(input);
        const position = this.positions.findById(tenantId, contract.positionId);
        if (position && position.status === "filled" && position.currentEmployeeId === contract.employeeId) {
            position.vacate();
            this.positions.save(position);
            this.outbox.append(position.pullEvents());
        }
        const employee = this.employees.findById(tenantId, contract.employeeId);
        if (employee && employee.primaryPositionId === contract.positionId) {
            employee.clearPrimaryPosition();
            this.employees.save(employee);
        }
        this.contracts.save(contract);
        this.outbox.append(contract.pullEvents());
        return contract;
    }
    /**
     * Sweep for fixed-term contracts that passed their end date; expires them
     * and vacates the corresponding positions. Returns the expired contracts.
     */
    expireContracts(tenantId, asOf) {
        const effectiveAsOf = asOf ?? this.clock.today();
        const expired = [];
        for (const contract of this.contracts.listByTenant(tenantId)) {
            if (contract.status !== "active")
                continue;
            if (!contract.markExpired(effectiveAsOf))
                continue;
            const position = this.positions.findById(tenantId, contract.positionId);
            if (position && position.status === "filled" && position.currentEmployeeId === contract.employeeId) {
                position.vacate();
                this.positions.save(position);
                this.outbox.append(position.pullEvents());
            }
            const employee = this.employees.findById(tenantId, contract.employeeId);
            if (employee && employee.primaryPositionId === contract.positionId) {
                employee.clearPrimaryPosition();
                this.employees.save(employee);
            }
            this.contracts.save(contract);
            this.outbox.append(contract.pullEvents());
            expired.push(contract);
        }
        return expired;
    }
}
//# sourceMappingURL=contract-service.js.map