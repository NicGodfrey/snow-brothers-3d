import { type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
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
export declare function seedDemoTenant(module: HcmModule, tenant?: string): SeedResult;
//# sourceMappingURL=seed.d.ts.map