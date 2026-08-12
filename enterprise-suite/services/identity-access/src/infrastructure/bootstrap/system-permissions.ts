import { PermissionCatalog, definePermission, type PermissionDefinition } from "../../domain/permission.js";

const identity = (
  key: string,
  description: string,
  options: { scopable?: boolean; dangerous?: boolean } = {},
): PermissionDefinition =>
  definePermission({ key, description, category: "Identity & Access", ...options });

/**
 * Permissions owned by this bounded context. Other contexts register their own keys
 * against the same catalog at startup, which is why the registry lives in a service
 * rather than in a static file.
 */
export const IDENTITY_PERMISSIONS: readonly PermissionDefinition[] = [
  identity("identity.tenant:read", "View tenant profile and settings", { scopable: false }),
  identity("identity.tenant:update", "Change tenant name and settings", { scopable: false }),
  identity("identity.tenant:suspend", "Suspend or archive the tenant", {
    scopable: false,
    dangerous: true,
  }),

  identity("identity.user:read", "View users"),
  identity("identity.user:invite", "Invite new users"),
  identity("identity.user:update", "Change a user's profile, email or attributes"),
  identity("identity.user:suspend", "Suspend or reactivate a user"),
  identity("identity.user:deactivate", "Permanently deactivate a user", { dangerous: true }),
  identity("identity.user:reset_password", "Set a password on behalf of a user", {
    dangerous: true,
  }),
  identity("identity.user:unlock", "Clear a lockout after failed sign-ins"),
  identity("identity.user:impersonate", "Sign in as another user", { dangerous: true }),
  identity("identity.user:manage_mfa", "Enroll or remove a user's second factor"),

  identity("identity.group:read", "View groups and their membership"),
  identity("identity.group:create", "Create groups"),
  identity("identity.group:update", "Rename groups and change their parent"),
  identity("identity.group:manage_members", "Add or remove group members"),
  identity("identity.group:delete", "Delete a group", { dangerous: true }),

  identity("identity.role:read", "View roles and their grants"),
  identity("identity.role:create", "Create roles"),
  identity("identity.role:update", "Change a role's grants or inheritance", { dangerous: true }),
  identity("identity.role:delete", "Delete a role", { dangerous: true }),

  identity("identity.permission:read", "Browse the permission catalog", { scopable: false }),

  identity("identity.role_binding:read", "View who holds which role"),
  identity("identity.role_binding:grant", "Bind a role to a subject", { dangerous: true }),
  identity("identity.role_binding:revoke", "Revoke a role binding"),
  identity("identity.role_binding:delegate", "Pass on a delegable role at a narrower scope"),

  identity("identity.api_key:read", "List API keys and their metadata"),
  identity("identity.api_key:issue", "Issue a new API key", { dangerous: true }),
  identity("identity.api_key:rotate", "Rotate an API key secret", { dangerous: true }),
  identity("identity.api_key:revoke", "Revoke an API key"),

  identity("identity.session:read", "List active sessions"),
  identity("identity.session:revoke", "Sign a user out of one or all sessions"),

  identity("identity.audit:read", "Read the authorization and administrative audit log"),
  identity("identity.audit:export", "Export the audit log to an external system"),

  identity("identity.authz:check", "Ask for an authorization decision on another subject's behalf", {
    scopable: false,
  }),
  identity("identity.authz:explain", "See why a decision was made, including the grant trace"),
];

/**
 * A small cross-context set so the seeded roles and the RBAC examples are not
 * self-referential. Each owning context is expected to replace these with its own
 * registration at startup.
 */
export const PLATFORM_PERMISSIONS: readonly PermissionDefinition[] = [
  definePermission({
    key: "platform.report:read",
    description: "View reports and dashboards",
    category: "Platform",
  }),
  definePermission({
    key: "platform.report:export",
    description: "Export report data",
    category: "Platform",
  }),
  definePermission({
    key: "sales.order:read",
    description: "View sales orders",
    category: "Sales",
  }),
  definePermission({
    key: "sales.order:create",
    description: "Create sales orders",
    category: "Sales",
  }),
  definePermission({
    key: "sales.order:approve",
    description: "Approve sales orders above the automatic threshold",
    category: "Sales",
    dangerous: true,
  }),
  definePermission({
    key: "procurement.purchase_order:read",
    description: "View purchase orders",
    category: "Procurement",
  }),
  definePermission({
    key: "procurement.purchase_order:approve",
    description: "Approve purchase orders",
    category: "Procurement",
    dangerous: true,
  }),
  definePermission({
    key: "srm.supplier:read",
    description: "View supplier master data",
    category: "Supplier Relationship",
  }),
  definePermission({
    key: "srm.supplier:update",
    description: "Maintain supplier master data",
    category: "Supplier Relationship",
  }),
  definePermission({
    key: "prm.partner:read",
    description: "View partner records",
    category: "Partner Relationship",
  }),
  definePermission({
    key: "prm.deal_registration:approve",
    description: "Approve partner deal registrations",
    category: "Partner Relationship",
  }),
];

export function createPermissionCatalog(
  extra: readonly PermissionDefinition[] = [],
): PermissionCatalog {
  return new PermissionCatalog([...IDENTITY_PERMISSIONS, ...PLATFORM_PERMISSIONS, ...extra]);
}
