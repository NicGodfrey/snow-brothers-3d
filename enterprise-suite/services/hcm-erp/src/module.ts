import { AttendanceService } from "./application/attendance-service.js";
import { CompensationService } from "./application/compensation-service.js";
import { ContractService } from "./application/contract-service.js";
import { EmployeeService } from "./application/employee-service.js";
import { LeaveService } from "./application/leave-service.js";
import { OrgService } from "./application/org-service.js";
import type { Clock, HcmRepositories } from "./application/ports.js";
import { RequisitionService } from "./application/requisition-service.js";
import { SkillsService } from "./application/skills-service.js";
import { createInMemoryRepositories, InMemoryOutbox, SystemClock } from "./infrastructure/in-memory.js";

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
export function createHcmModule(overrides?: {
  repos?: HcmRepositories;
  outbox?: InMemoryOutbox;
  clock?: Clock;
}): HcmModule {
  const repos = overrides?.repos ?? createInMemoryRepositories();
  const outbox = overrides?.outbox ?? new InMemoryOutbox();
  const clock = overrides?.clock ?? new SystemClock();

  const orgService = new OrgService(repos.orgUnits, repos.positions, outbox);
  const employeeService = new EmployeeService(repos.employees, repos.positions, repos.contracts, outbox);
  const contractService = new ContractService(
    repos.contracts,
    repos.employees,
    repos.positions,
    repos.compensationRecords,
    outbox,
    clock,
  );
  const leaveService = new LeaveService(
    repos.leavePolicies,
    repos.holidayCalendars,
    repos.leaveBalances,
    repos.leaveRequests,
    repos.employees,
    outbox,
    clock,
  );
  const attendanceService = new AttendanceService(repos.attendancePeriods, repos.employees, outbox);
  const compensationService = new CompensationService(
    repos.compensationRecords,
    repos.bonuses,
    repos.employees,
    outbox,
  );
  const skillsService = new SkillsService(
    repos.skills,
    repos.employeeSkills,
    repos.certifications,
    repos.employeeCertifications,
    repos.employees,
    outbox,
    clock,
  );
  const requisitionService = new RequisitionService(
    repos.requisitions,
    repos.positions,
    repos.employees,
    employeeService,
    contractService,
    outbox,
  );

  return {
    repos,
    outbox,
    clock,
    orgService,
    employeeService,
    contractService,
    leaveService,
    attendanceService,
    compensationService,
    skillsService,
    requisitionService,
  };
}
