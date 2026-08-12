import {
  ConflictError,
  DomainError,
  NotFoundError,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "../domain/common.js";
import type { Employee } from "../domain/employee.js";
import type { ContractType, EmploymentContract, PayFrequency } from "../domain/employment-contract.js";
import { HiringRequisition, type RequisitionStatus, type SalaryBand } from "../domain/requisition.js";
import type { ContractService } from "./contract-service.js";
import type { EmployeeService } from "./employee-service.js";
import type {
  EmployeeRepository,
  EventOutbox,
  PositionRepository,
  RequisitionRepository,
} from "./ports.js";

export interface FillRequisitionResult {
  requisition: HiringRequisition;
  employee: Employee;
  contract: EmploymentContract;
}

/**
 * Owns the requisition lifecycle and the cross-aggregate "hire against a
 * requisition" orchestration (employee + contract + position + requisition).
 */
export class RequisitionService {
  constructor(
    private readonly requisitions: RequisitionRepository,
    private readonly positions: PositionRepository,
    private readonly employees: EmployeeRepository,
    private readonly employeeService: EmployeeService,
    private readonly contractService: ContractService,
    private readonly outbox: EventOutbox,
  ) {}

  createDraft(
    tenantId: TenantId,
    input: {
      positionId: Ulid;
      title?: string;
      headcount?: number;
      hiringManagerId: Ulid;
      recruiterId?: Ulid;
      justification: string;
      salaryBand?: SalaryBand;
      targetStartDate?: IsoDate;
    },
  ): HiringRequisition {
    const position = this.positions.findById(tenantId, input.positionId);
    if (!position) throw new NotFoundError("Position", input.positionId);
    if (position.status === "eliminated") {
      throw new ConflictError(`Position "${position.title}" has been eliminated`);
    }
    if (position.status === "filled") {
      throw new ConflictError(`Position "${position.title}" is already filled`);
    }
    const hiringManager = this.employees.findById(tenantId, input.hiringManagerId);
    if (!hiringManager) throw new NotFoundError("Employee", input.hiringManagerId);
    if (!hiringManager.isEmployed()) {
      throw new ConflictError(`Hiring manager ${hiringManager.employeeNumber} is terminated`);
    }
    const requisition = HiringRequisition.createDraft(tenantId, {
      positionId: input.positionId,
      orgUnitId: position.orgUnitId,
      title: input.title ?? position.title,
      headcount: input.headcount,
      hiringManagerId: input.hiringManagerId,
      recruiterId: input.recruiterId,
      justification: input.justification,
      salaryBand: input.salaryBand,
      targetStartDate: input.targetStartDate,
    });
    this.requisitions.save(requisition);
    return requisition;
  }

  getRequisition(tenantId: TenantId, id: Ulid): HiringRequisition {
    const requisition = this.requisitions.findById(tenantId, id);
    if (!requisition) throw new NotFoundError("HiringRequisition", id);
    return requisition;
  }

  listRequisitions(tenantId: TenantId, status?: RequisitionStatus): HiringRequisition[] {
    return status
      ? this.requisitions.listByStatus(tenantId, status)
      : this.requisitions.listByTenant(tenantId);
  }

  submitForApproval(tenantId: TenantId, id: Ulid): HiringRequisition {
    return this.applyTransition(tenantId, id, (r) => r.submitForApproval());
  }

  approve(tenantId: TenantId, id: Ulid, approverId: Ulid, comment?: string): HiringRequisition {
    return this.applyTransition(tenantId, id, (r) => r.approve(approverId, comment));
  }

  reject(tenantId: TenantId, id: Ulid, approverId: Ulid, comment: string): HiringRequisition {
    return this.applyTransition(tenantId, id, (r) => r.reject(approverId, comment));
  }

  hold(tenantId: TenantId, id: Ulid, note: string): HiringRequisition {
    return this.applyTransition(tenantId, id, (r) => r.hold(note));
  }

  resume(tenantId: TenantId, id: Ulid): HiringRequisition {
    return this.applyTransition(tenantId, id, (r) => r.resume());
  }

  cancel(tenantId: TenantId, id: Ulid, note: string): HiringRequisition {
    return this.applyTransition(tenantId, id, (r) => r.cancel(note));
  }

  /**
   * End-to-end hire: creates the employee, drafts and activates the contract
   * (which fills the position and initializes compensation), and records the
   * hire on the requisition. For multi-headcount requisitions, subsequent
   * hires pass another open position from the same org unit via `positionId`.
   */
  fill(
    tenantId: TenantId,
    requisitionId: Ulid,
    input: {
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
    },
  ): FillRequisitionResult {
    const requisition = this.getRequisition(tenantId, requisitionId);
    if (requisition.status !== "open") {
      throw new ConflictError(`Requisition is ${requisition.status}; hires require an open requisition`);
    }

    const positionId = input.positionId ?? requisition.positionId;
    const position = this.positions.findById(tenantId, positionId);
    if (!position) throw new NotFoundError("Position", positionId);
    if (position.orgUnitId !== requisition.orgUnitId) {
      throw new ConflictError("Hire position must belong to the requisition's org unit");
    }
    if (!position.isFillable()) {
      throw new ConflictError(`Position "${position.title}" is ${position.status} and cannot be filled`);
    }

    const band = requisition.salaryBand;
    if (band) {
      if (input.contract.baseSalary.currency !== band.min.currency) {
        throw new DomainError(
          `Offer currency ${input.contract.baseSalary.currency} does not match salary band currency ${band.min.currency}`,
          "CURRENCY_MISMATCH",
        );
      }
      const offered = input.contract.baseSalary.amountMinor;
      if (offered < band.min.amountMinor || offered > band.max.amountMinor) {
        throw new DomainError(
          `Offered salary ${offered} is outside the approved band [${band.min.amountMinor}, ${band.max.amountMinor}]`,
          "SALARY_OUTSIDE_BAND",
          409,
        );
      }
    }

    const employee = this.employeeService.hire(tenantId, {
      ...input.employee,
      managerEmployeeId: requisition.hiringManagerId,
    });
    const contract = this.contractService.draftContract(tenantId, {
      employeeId: employee.id,
      positionId,
      ...input.contract,
    });
    this.contractService.activateContract(tenantId, contract.id, input.recordedBy);

    requisition.recordHire(employee.id);
    this.requisitions.save(requisition);
    this.outbox.append(requisition.pullEvents());
    return { requisition, employee, contract };
  }

  private applyTransition(
    tenantId: TenantId,
    id: Ulid,
    transition: (r: HiringRequisition) => void,
  ): HiringRequisition {
    const requisition = this.getRequisition(tenantId, id);
    transition(requisition);
    this.requisitions.save(requisition);
    this.outbox.append(requisition.pullEvents());
    return requisition;
  }
}
