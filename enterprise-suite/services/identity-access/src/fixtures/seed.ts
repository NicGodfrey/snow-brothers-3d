import { tenantId as toTenantId, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { childScope, ROOT_SCOPE, type ScopePath } from "../domain/scope.js";
import { apiKeySubject, groupSubject, userSubject } from "../domain/subject.js";
import type { IdentityModule } from "../infrastructure/container.js";

export interface SeedRefs {
  readonly tenantId: TenantId;
  readonly scopes: {
    readonly root: ScopePath;
    readonly emea: ScopePath;
    readonly emeaHamburg: ScopePath;
    readonly amer: ScopePath;
  };
  readonly users: {
    readonly owner: Ulid;
    readonly securityAdmin: Ulid;
    readonly emeaManager: Ulid;
    readonly salesRep: Ulid;
    readonly auditor: Ulid;
    readonly contractor: Ulid;
  };
  readonly groups: {
    readonly emeaSales: Ulid;
    readonly allEmployees: Ulid;
  };
  readonly roles: {
    readonly emeaSalesManager: string;
    readonly readOnlyContractor: string;
  };
  readonly apiKey: { readonly id: Ulid; readonly token: string };
  readonly passwords: Readonly<Record<string, string>>;
}

const PASSWORD = "Sup3rSecret!Passphrase";

/**
 * Builds a realistic tenant: a scope tree, the system roles, two tenant-defined roles,
 * a group hierarchy, a time-boxed contractor binding and an integration API key.
 * Used by the HTTP demo server and as the starting point for most tests.
 */
export function seedDemoTenant(module: IdentityModule, slug = "northwind"): SeedRefs {
  const tenant = module.tenants.provision({
    tenantId: toTenantId(`ten_${slug}`),
    slug,
    name: "Northwind Industries",
    activate: true,
    settings: {
      allowedEmailDomains: ["northwind.example"],
      auditAllDecisions: true,
      sessionPolicy: { maxConcurrentSessions: 3 },
      lockoutPolicy: { maxFailedAttempts: 3 },
    },
  });
  const tenantId = tenant.tenantId;
  module.installSystemRoles(tenantId);

  const scopes = {
    root: ROOT_SCOPE,
    emea: childScope(ROOT_SCOPE, "bu", "emea"),
    emeaHamburg: childScope(childScope(ROOT_SCOPE, "bu", "emea"), "site", "hamburg"),
    amer: childScope(ROOT_SCOPE, "bu", "amer"),
  };

  const owner = invite(module, tenantId, "ada.owner@northwind.example", "Ada Owner");
  const securityAdmin = invite(module, tenantId, "sam.security@northwind.example", "Sam Security");
  const emeaManager = invite(module, tenantId, "mia.manager@northwind.example", "Mia Manager", {
    bu: "emea",
  });
  const salesRep = invite(module, tenantId, "raj.rep@northwind.example", "Raj Rep", {
    bu: "emea",
    site: "hamburg",
  });
  const auditor = invite(module, tenantId, "ava.auditor@northwind.example", "Ava Auditor");
  const contractor = invite(module, tenantId, "cody.contract@northwind.example", "Cody Contractor");

  // A business-unit-scoped role: broad sales rights, but the role itself pins the
  // dangerous approval to EMEA so it cannot leak if the binding is later widened.
  module.roles.create(tenantId, {
    code: "emea_sales_manager",
    name: "EMEA Sales Manager",
    description: "Runs the EMEA sales desk",
    inherits: ["member"],
    grants: [
      { permission: "sales.order:create" },
      { permission: "sales.order:approve", scope: scopes.emea },
      { permission: "identity.user:read" },
      { permission: "identity.role_binding:read" },
      { effect: "deny", permission: "sales.order:approve", scope: scopes.amer },
    ],
  });

  module.roles.create(tenantId, {
    code: "read_only_contractor",
    name: "Read-only Contractor",
    description: "Temporary read access for external staff",
    grants: [
      { permission: "sales.order:read" },
      { permission: "platform.report:read" },
      { effect: "deny", permission: "platform.report:export" },
    ],
  });

  const allEmployees = module.groups.create(tenantId, {
    name: "All Employees",
    description: "Everyone with a permanent contract",
    memberUserIds: [owner, securityAdmin, emeaManager, salesRep, auditor],
  }).id;

  const emeaSales = module.groups.create(tenantId, {
    name: "EMEA Sales",
    description: "Sales staff in the EMEA business unit",
    parentGroupId: allEmployees,
    memberUserIds: [emeaManager, salesRep],
  }).id;

  module.bindings.grant(tenantId, {
    subject: userSubject(owner),
    roleCode: "platform_owner",
    grantedBy: owner,
    reason: "founding administrator",
  });
  module.bindings.grant(tenantId, {
    subject: userSubject(securityAdmin),
    roleCode: "security_admin",
    grantedBy: owner,
    delegable: true,
  });
  module.bindings.grant(tenantId, {
    subject: userSubject(auditor),
    roleCode: "auditor",
    grantedBy: owner,
  });
  module.bindings.grant(tenantId, {
    subject: userSubject(emeaManager),
    roleCode: "emea_sales_manager",
    scope: scopes.emea,
    grantedBy: securityAdmin,
  });
  // The whole group gets the baseline role, so new joiners inherit it automatically.
  module.bindings.grant(tenantId, {
    subject: groupSubject(allEmployees),
    roleCode: "member",
    grantedBy: securityAdmin,
  });
  module.bindings.grant(tenantId, {
    subject: groupSubject(emeaSales),
    roleCode: "user_manager",
    scope: scopes.emea,
    grantedBy: securityAdmin,
    reason: "EMEA sales manages its own onboarding",
  });
  module.bindings.grantTemporary(tenantId, {
    subject: userSubject(contractor),
    roleCode: "read_only_contractor",
    scope: scopes.emeaHamburg,
    hours: 72,
    grantedBy: securityAdmin,
    reason: "Q1 stocktake support",
  });

  const issued = module.apiKeys.issue(tenantId, {
    name: "warehouse-sync",
    createdBy: securityAdmin,
    roleCodes: ["integration_client"],
    restrictions: ["sales.order:read", "identity.authz:check"],
    expiresInDays: 90,
  });
  module.bindings.grant(tenantId, {
    subject: apiKeySubject(issued.apiKey.id),
    roleCode: "member",
    scope: scopes.emeaHamburg,
    grantedBy: securityAdmin,
    validUntil: issued.apiKey.expiresAt,
  });

  return {
    tenantId,
    scopes,
    users: { owner, securityAdmin, emeaManager, salesRep, auditor, contractor },
    groups: { emeaSales, allEmployees },
    roles: {
      emeaSalesManager: "emea_sales_manager",
      readOnlyContractor: "read_only_contractor",
    },
    apiKey: { id: issued.apiKey.id, token: issued.token },
    passwords: {
      "ada.owner@northwind.example": PASSWORD,
      "sam.security@northwind.example": PASSWORD,
      "mia.manager@northwind.example": PASSWORD,
      "raj.rep@northwind.example": PASSWORD,
      "ava.auditor@northwind.example": PASSWORD,
      "cody.contract@northwind.example": PASSWORD,
    },
  };
}

function invite(
  module: IdentityModule,
  tenantId: TenantId,
  email: string,
  displayName: string,
  attributes: Record<string, string> = {},
): Ulid {
  const user = module.users.invite(tenantId, { email, displayName, attributes });
  module.users.activate(tenantId, { userId: user.id, password: PASSWORD });
  return user.id;
}

export const SEED_PASSWORD = PASSWORD;
