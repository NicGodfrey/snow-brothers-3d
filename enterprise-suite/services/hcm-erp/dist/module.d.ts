import { AttendanceService } from "./application/attendance-service.js";
import { CompensationService } from "./application/compensation-service.js";
import { ContractService } from "./application/contract-service.js";
import { EmployeeService } from "./application/employee-service.js";
import { LeaveService } from "./application/leave-service.js";
import { OrgService } from "./application/org-service.js";
import type { Clock, HcmRepositories } from "./application/ports.js";
import { RequisitionService } from "./application/requisition-service.js";
import { SkillsService } from "./application/skills-service.js";
import { InMemoryOutbox } from "./infrastructure/in-memory.js";
export interface HcmModule {
    repos: HcmRepositories;
    outbox: InMemoryOutbox;
    clock: Clock;
    orgService: OrgService;
    employeeService: EmployeeService;
    contractService: ContractService;
    leaveService: LeaveService;
    attendanceService: AttendanceService;
    compensationService: CompensationService;
    skillsService: SkillsService;
    requisitionService: RequisitionService;
}
/**
 * Composition root. In-memory adapters by default; pass overrides to swap in
 * Postgres-backed repositories or a fixed clock without touching services.
 */
export declare function createHcmModule(overrides?: {
    repos?: HcmRepositories;
    outbox?: InMemoryOutbox;
    clock?: Clock;
}): HcmModule;
//# sourceMappingURL=module.d.ts.map