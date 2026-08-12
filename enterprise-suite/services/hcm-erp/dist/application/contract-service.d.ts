import { type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "../domain/common.js";
import { EmploymentContract, type AmendableTerms, type ContractType, type PayFrequency } from "../domain/employment-contract.js";
import type { Clock, CompensationRepository, ContractRepository, EmployeeRepository, EventOutbox, PositionRepository } from "./ports.js";
export declare class ContractService {
    private readonly contracts;
    private readonly employees;
    private readonly positions;
    private readonly compensationRecords;
    private readonly outbox;
    private readonly clock;
    constructor(contracts: ContractRepository, employees: EmployeeRepository, positions: PositionRepository, compensationRecords: CompensationRepository, outbox: EventOutbox, clock: Clock);
    draftContract(tenantId: TenantId, input: {
        employeeId: Ulid;
        positionId: Ulid;
        contractType: ContractType;
        startDate: IsoDate;
        endDate?: IsoDate;
        probationEndDate?: IsoDate;
        fte?: number;
        weeklyHours?: number;
        /** Annual base salary in minor units. */
        baseSalary: Money;
        payFrequency?: PayFrequency;
    }): EmploymentContract;
    getContract(tenantId: TenantId, id: Ulid): EmploymentContract;
    listByEmployee(tenantId: TenantId, employeeId: Ulid): EmploymentContract[];
    /**
     * Activation is the onboarding pivot: the position is filled, the employee
     * gains a primary position, and a compensation record is initialized from
     * the contract terms when none exists yet.
     */
    activateContract(tenantId: TenantId, id: Ulid, activatedBy: Ulid): EmploymentContract;
    amendContract(tenantId: TenantId, id: Ulid, input: {
        effectiveDate: IsoDate;
        amendedBy: Ulid;
        changes: Partial<AmendableTerms>;
        note?: string;
    }): EmploymentContract;
    terminateContract(tenantId: TenantId, id: Ulid, input: {
        terminationDate: IsoDate;
        note?: string;
    }): EmploymentContract;
    /**
     * Sweep for fixed-term contracts that passed their end date; expires them
     * and vacates the corresponding positions. Returns the expired contracts.
     */
    expireContracts(tenantId: TenantId, asOf?: IsoDate): EmploymentContract[];
}
//# sourceMappingURL=contract-service.d.ts.map