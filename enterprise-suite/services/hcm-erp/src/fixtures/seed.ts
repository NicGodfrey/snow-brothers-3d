import { money, tenantId, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { isoDate } from "../domain/common.js";
import type { Employee } from "../domain/employee.js";
import type { OrgUnit } from "../domain/org-unit.js";
import type { Position } from "../domain/position.js";
import type { HcmModule } from "../module.js";

export interface SeedResult {
  tenant: TenantId;
  company: OrgUnit;
  engineering: OrgUnit;
  platformTeam: OrgUnit;
  peopleOps: OrgUnit;
  ctoPosition: Position;
  staffEngPosition: Position;
  hrLeadPosition: Position;
  cto: Employee;
  staffEngineer: Employee;
  hrLead: Employee;
  hrUserId: Ulid;
}

/**
 * Seeds a small but realistic tenant: a company with an engineering division,
 * a platform team, a people-ops department, three filled positions, leave
 * policies, a holiday calendar, and a couple of skills/certifications.
 * Used by tests and local development; safe to call once per tenant.
 */
export function seedDemoTenant(module: HcmModule, tenant = "acme"): SeedResult {
  const t = tenantId(tenant);
  const { orgService, employeeService, contractService, leaveService, skillsService } = module;

  const company = orgService.createOrgUnit(t, { code: "ACME", name: "Acme Corp", kind: "company" });
  const engineering = orgService.createOrgUnit(t, {
    code: "ENG",
    name: "Engineering",
    kind: "division",
    parentId: company.id,
    costCenter: "CC-100",
  });
  const platformTeam = orgService.createOrgUnit(t, {
    code: "ENG-PLAT",
    name: "Platform Team",
    kind: "team",
    parentId: engineering.id,
    costCenter: "CC-110",
  });
  const peopleOps = orgService.createOrgUnit(t, {
    code: "PEOPLE",
    name: "People Operations",
    kind: "department",
    parentId: company.id,
    costCenter: "CC-900",
  });

  const ctoPosition = orgService.openPosition(t, {
    orgUnitId: engineering.id,
    title: "Chief Technology Officer",
    jobFamily: "engineering",
    grade: "M5",
  });
  const staffEngPosition = orgService.openPosition(t, {
    orgUnitId: platformTeam.id,
    title: "Staff Engineer",
    jobFamily: "engineering",
    grade: "IC6",
    reportsToPositionId: ctoPosition.id,
  });
  const hrLeadPosition = orgService.openPosition(t, {
    orgUnitId: peopleOps.id,
    title: "Head of People",
    jobFamily: "people",
    grade: "M3",
  });

  const cto = employeeService.hire(t, {
    employeeNumber: "ACME-0001",
    firstName: "Ada",
    lastName: "Nkosi",
    email: "ada.nkosi@acme.test",
    hireDate: isoDate("2022-01-10"),
  });
  const staffEngineer = employeeService.hire(t, {
    employeeNumber: "ACME-0002",
    firstName: "Bram",
    lastName: "Okafor",
    email: "bram.okafor@acme.test",
    hireDate: isoDate("2023-03-01"),
    managerEmployeeId: cto.id,
  });
  const hrLead = employeeService.hire(t, {
    employeeNumber: "ACME-0003",
    firstName: "Carla",
    lastName: "Ibanez",
    email: "carla.ibanez@acme.test",
    hireDate: isoDate("2022-06-15"),
  });
  const hrUserId = hrLead.id;

  const ctoContract = contractService.draftContract(t, {
    employeeId: cto.id,
    positionId: ctoPosition.id,
    contractType: "permanent",
    startDate: isoDate("2022-01-10"),
    baseSalary: money(24_000_000, "USD"),
    payFrequency: "monthly",
  });
  contractService.activateContract(t, ctoContract.id, hrUserId);

  const engContract = contractService.draftContract(t, {
    employeeId: staffEngineer.id,
    positionId: staffEngPosition.id,
    contractType: "permanent",
    startDate: isoDate("2023-03-01"),
    probationEndDate: isoDate("2023-09-01"),
    baseSalary: money(16_500_000, "USD"),
    payFrequency: "monthly",
  });
  contractService.activateContract(t, engContract.id, hrUserId);

  const hrContract = contractService.draftContract(t, {
    employeeId: hrLead.id,
    positionId: hrLeadPosition.id,
    contractType: "permanent",
    startDate: isoDate("2022-06-15"),
    baseSalary: money(13_000_000, "USD"),
    payFrequency: "monthly",
  });
  contractService.activateContract(t, hrContract.id, hrUserId);

  leaveService.definePolicy(t, {
    leaveType: "annual",
    name: "Annual Leave",
    accrualDaysPerYear: 24,
    maxCarryoverDays: 5,
  });
  leaveService.definePolicy(t, {
    leaveType: "sick",
    name: "Sick Leave",
    accrualDaysPerYear: 10,
    requiresApproval: false,
    allowNegativeBalance: true,
  });
  leaveService.definePolicy(t, {
    leaveType: "unpaid",
    name: "Unpaid Leave",
    accrualDaysPerYear: 0,
    allowNegativeBalance: true,
    paid: false,
  });
  leaveService.setHolidayCalendar(t, 2026, [
    { date: isoDate("2026-01-01"), name: "New Year's Day" },
    { date: isoDate("2026-05-01"), name: "Labour Day" },
    { date: isoDate("2026-12-25"), name: "Christmas Day" },
  ]);

  skillsService.defineSkill(t, { code: "typescript", name: "TypeScript", category: "engineering" });
  skillsService.defineSkill(t, { code: "postgres", name: "PostgreSQL", category: "engineering" });
  skillsService.defineCertification(t, {
    code: "aws-sa-pro",
    name: "AWS Solutions Architect Professional",
    issuingBody: "Amazon Web Services",
    validityMonths: 36,
  });

  return {
    tenant: t,
    company,
    engineering,
    platformTeam,
    peopleOps,
    ctoPosition,
    staffEngPosition,
    hrLeadPosition,
    cto,
    staffEngineer,
    hrLead,
    hrUserId,
  };
}
