import type { TenantId } from "@enterprise-suite/shared-kernel";
import { Role, allow, deny, type RoleGrant } from "../../domain/role.js";

export interface SystemRoleTemplate {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly grants: readonly RoleGrant[];
  readonly inherits?: readonly string[];
  /** Non-assignable templates are building blocks for other roles. */
  readonly assignable?: boolean;
}

/**
 * Roles every tenant gets at provisioning time. They are marked `system`, so tenants can
 * clone them but cannot edit them — an upgrade that adds a permission to `tenant_admin`
 * must not be silently reverted by a local edit.
 */
export const SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = [
  {
    code: "platform_owner",
    name: "Platform Owner",
    description: "Unrestricted access, including tenant lifecycle. Grant sparingly.",
    grants: [allow("**:*")],
  },
  {
    code: "base_reader",
    name: "Base Reader",
    description: "Read-only building block inherited by most roles.",
    assignable: false,
    grants: [
      allow("identity.user:read"),
      allow("identity.group:read"),
      allow("identity.role:read"),
      allow("identity.permission:read"),
      allow("identity.role_binding:read"),
      allow("platform.report:read"),
    ],
  },
  {
    code: "tenant_admin",
    name: "Tenant Administrator",
    description: "Full administration of a tenant, excluding tenant suspension.",
    inherits: ["base_reader"],
    grants: [
      allow("identity.**:*"),
      deny("identity.tenant:suspend"),
      allow("platform.**:*"),
    ],
  },
  {
    code: "security_admin",
    name: "Security Administrator",
    description: "Owns roles, bindings, keys and the audit trail; cannot change user profiles.",
    inherits: ["base_reader"],
    grants: [
      allow("identity.role:*"),
      allow("identity.role_binding:*"),
      allow("identity.api_key:*"),
      allow("identity.session:*"),
      allow("identity.audit:*"),
      allow("identity.authz:*"),
      allow("identity.user:unlock"),
      deny("identity.user:impersonate"),
    ],
  },
  {
    code: "user_manager",
    name: "User Manager",
    description: "Day-to-day user and group administration without policy authority.",
    inherits: ["base_reader"],
    grants: [
      allow("identity.user:invite"),
      allow("identity.user:update"),
      allow("identity.user:suspend"),
      allow("identity.user:unlock"),
      allow("identity.user:reset_password"),
      allow("identity.user:manage_mfa"),
      allow("identity.group:create"),
      allow("identity.group:update"),
      allow("identity.group:manage_members"),
      deny("identity.user:deactivate"),
      deny("identity.user:impersonate"),
    ],
  },
  {
    code: "auditor",
    name: "Auditor",
    description: "Read-only access to identity configuration and the full audit log.",
    inherits: ["base_reader"],
    grants: [
      allow("identity.audit:read"),
      allow("identity.audit:export"),
      allow("identity.session:read"),
      allow("identity.api_key:read"),
      allow("identity.authz:explain"),
      allow("platform.report:export"),
    ],
  },
  {
    code: "integration_client",
    name: "Integration Client",
    description: "Intended for API keys: read access plus authorization checks, nothing else.",
    inherits: ["base_reader"],
    grants: [allow("identity.authz:check"), allow("platform.report:read")],
  },
  {
    code: "member",
    name: "Member",
    description: "Baseline role for ordinary users.",
    inherits: ["base_reader"],
    grants: [allow("sales.order:read"), allow("srm.supplier:read"), allow("prm.partner:read")],
  },
];

export function buildSystemRoles(tenantId: TenantId): readonly Role[] {
  return SYSTEM_ROLE_TEMPLATES.map((template) =>
    Role.create({
      tenantId,
      code: template.code,
      name: template.name,
      description: template.description,
      grants: template.grants,
      inherits: template.inherits,
      system: true,
      assignable: template.assignable ?? true,
    }),
  );
}
