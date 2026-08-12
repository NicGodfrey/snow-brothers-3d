import { type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "../domain/common.js";
import type { Employee } from "../domain/employee.js";
import type { ContractType, EmploymentContract, PayFrequency } from "../domain/employment-contract.js";
import { HiringRequisition, type RequisitionStatus, type SalaryBand } from "../domain/requisition.js";
import type { ContractService } from "./contract-service.js";
import type { EmployeeService } from "./employee-service.js";
import type { EmployeeRepository, EventOutbox, PositionRepository, RequisitionRepository } from "./ports.js";
export interface FillRequisitionResult {
    requisition: HiringRequisition;
    employee: Employee;
    contract: EmploymentContract;
}
/**
 * Owns the requisition lifecycle and the cross-aggregate "hire against a
 * requisition" orchestration (employee + contract + position + requisition).
 */
export declare class RequisitionService {
    private readonly requisitions;
    private readonly positions;
    private readonly employees;
    private readonly employeeService;
    private readonly contractService;
    private readonly outbox;
    constructor(requisitions: RequisitionRepository, positions: PositionRepository, employees: EmployeeRepository, employeeService: EmployeeService, contractService: ContractService, outbox: EventOutbox);
    createDraft(tenantId: TenantId, input: {
        positionId: Ulid;
        title?: string;
        headcount?: number;
        hiringManagerId: Ulid;
        recruiterId?: Ulid;
        justification: string;
        salaryBand?: SalaryBand;
        targetStartDate?: IsoDate;
    }): HiringRequisition;
    getRequisition(tenantId: TenantId, id: Ulid): HiringRequisition;
    listRequisitions(tenantId: TenantId, status?: RequisitionStatus): HiringRequisition[];
    submitForApproval(tenantId: TenantId, id: Ulid): HiringRequisition;
    approve(tenantId: TenantId, id: Ulid, approverId: Ulid, comment?: string): HiringRequisition;
    reject(tenantId: TenantId, id: Ulid, approverId: Ulid, comment: string): HiringRequisition;
    hold(tenantId: TenantId, id: Ulid, note: string): HiringRequisition;
    resume(tenantId: TenantId, id: Ulid): HiringRequisition;
    cancel(tenantId: TenantId, id: Ulid, note: string): HiringRequisition;
    /**
     * End-to-end hire: creates the employee, drafts and activates the contract
     * (which fills the position and initializes compensation), and records the
     * hire on the requisition. For multi-headcount requisitions, subsequent
     * hires pass another open position from the same org unit via `positionId`.
     */
    fill(tenantId: TenantId, requisitionId: Ulid, input: {
        positionId?: Ulid;
        recordedBy: Ulid;
        employee: {
            employeeNumber: string;
            firstName: string;
            lastName: string;
            email: string;
            hireDate: IsoDate;
        };
        contract: {
            contractType: ContractType;
            startDate: IsoDate;
            endDate?: IsoDate;
            probationEndDate?: IsoDate;
            fte?: number;
            weeklyHours?: number;
            baseSalary: Money;
            payFrequency?: PayFrequency;
        };
    }): FillRequisitionResult;
    private applyTransition;
}
//# sourceMappingURL=requisition-service.d.ts.map