import { ForbiddenError } from "@enterprise-suite/shared-kernel";

/**
 * Portal-side RBAC.
 *
 * The portal never *is* the authority — `identity-access` owns roles and the
 * services re-check on every call. What lives here is the mirror the shell
 * needs to decide which modules, nav items and actions to render, so the UI
 * does not offer a button the backend will reject.
 *
 * Permissions are `<resource>:<action>` strings. Grants may use `*` in either
 * position (`sales:*`, `*:read`, `*`), requests may not.
 */

export type Permission = string;

export interface RoleDefinition {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  /** Grants, possibly wildcarded. */
  readonly grants: readonly Permission[];
  /** Roles whose grants are inherited transitively. */
  readonly inherits?: readonly string[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    code: "viewer",
    label: "Viewer",
    description: "Read-only access to every module the tenant has enabled.",
    grants: ["*:read"],
  },
  {
    code: "sales-rep",
    label: "Sales representative",
    description: "Owns quotes and orders, reads inventory availability.",
    grants: ["sales:write", "sales:approve-none", "marketing:read", "inventory:read"],
    inherits: ["viewer"],
  },
  {
    code: "sales-manager",
    label: "Sales manager",
    description: "Approves discounts and releases blocked orders.",
    grants: ["sales:approve", "prm:write"],
    inherits: ["sales-rep"],
  },
  {
    code: "marketing-manager",
    label: "Marketing manager",
    description: "Runs campaigns and owns lead routing rules.",
    grants: ["marketing:write", "marketing:approve"],
    inherits: ["viewer"],
  },
  {
    code: "warehouse-clerk",
    label: "Warehouse clerk",
    description: "Posts stock movements and confirms picks.",
    grants: ["inventory:write"],
    inherits: ["viewer"],
  },
  {
    code: "buyer",
    label: "Buyer",
    description: "Raises requisitions and purchase orders against suppliers.",
    grants: ["srm:write", "inventory:read"],
    inherits: ["viewer"],
  },
  {
    code: "supplier-manager",
    label: "Supplier manager",
    description: "Owns supplier onboarding, scorecards and contracts.",
    grants: ["srm:write", "srm:approve"],
    inherits: ["buyer"],
  },
  {
    code: "channel-manager",
    label: "Channel manager",
    description: "Manages partners, tiers, deal registration and MDF.",
    grants: ["prm:write", "prm:approve"],
    inherits: ["viewer"],
  },
  {
    code: "accountant",
    label: "Accountant",
    description: "Posts journals and works the AR/AP queues.",
    grants: ["finance:write"],
    inherits: ["viewer"],
  },
  {
    code: "controller",
    label: "Controller",
    description: "Closes periods and approves journals.",
    grants: ["finance:approve", "finance:close"],
    inherits: ["accountant"],
  },
  {
    code: "tenant-admin",
    label: "Tenant administrator",
    description: "Everything inside a single tenant.",
    grants: ["*"],
  },
];

const BY_CODE = new Map(ROLE_DEFINITIONS.map((r) => [r.code, r]));

export function findRole(code: string): RoleDefinition | undefined {
  return BY_CODE.get(code);
}

/** Expands a role list into the flat grant set, following `inherits`. */
export function expandGrants(roles: readonly string[]): ReadonlySet<Permission> {
  const grants = new Set<Permission>();
  const seen = new Set<string>();
  const visit = (code: string): void => {
    if (seen.has(code)) return;
    seen.add(code);
    const role = BY_CODE.get(code);
    if (!role) return;
    for (const grant of role.grants) grants.add(grant);
    for (const parent of role.inherits ?? []) visit(parent);
  };
  for (const code of roles) visit(code);
  return grants;
}

function grantMatches(grant: Permission, required: Permission): boolean {
  if (grant === "*" || grant === required) return true;
  const [grantResource, grantAction] = splitPermission(grant);
  const [required_, requiredAction] = splitPermission(required);
  const resourceOk = grantResource === "*" || grantResource === required_;
  const actionOk = grantAction === "*" || grantAction === requiredAction;
  return resourceOk && actionOk;
}

function splitPermission(value: Permission): [string, string] {
  const idx = value.indexOf(":");
  return idx === -1 ? [value, "*"] : [value.slice(0, idx), value.slice(idx + 1)];
}

export function grantsAllow(
  grants: ReadonlySet<Permission>,
  required: Permission | undefined,
): boolean {
  if (!required) return true;
  for (const grant of grants) {
    if (grantMatches(grant, required)) return true;
  }
  return false;
}

/** Grant set plus the convenience predicates the view layer uses. */
export class PermissionSet {
  private constructor(private readonly grants: ReadonlySet<Permission>) {}

  static fromRoles(roles: readonly string[]): PermissionSet {
    return new PermissionSet(expandGrants(roles));
  }

  static fromGrants(grants: readonly Permission[]): PermissionSet {
    return new PermissionSet(new Set(grants));
  }

  has(required: Permission | undefined): boolean {
    return grantsAllow(this.grants, required);
  }

  hasAny(required: readonly Permission[]): boolean {
    return required.length === 0 || required.some((p) => this.has(p));
  }

  hasAll(required: readonly Permission[]): boolean {
    return required.every((p) => this.has(p));
  }

  require(required: Permission): void {
    if (!this.has(required)) {
      throw new ForbiddenError(`Missing permission: ${required}`);
    }
  }

  list(): readonly Permission[] {
    return [...this.grants].sort();
  }
}
