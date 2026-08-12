import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { ImmutableRecordError, InvalidStateError, ValidationError } from "./errors.js";
import { AdminEventTypes } from "./events.js";

/**
 * Role aggregate and the permission catalogue behind it.
 *
 * Permissions are `<resource>:<action>` strings drawn from a fixed catalogue so
 * a typo cannot create a permission nothing will ever grant. A role may inherit
 * from one parent, which keeps "everything the operator can do, plus writes"
 * expressible without copying permission lists; the resolver walks the chain
 * and refuses cycles.
 *
 * System roles ship with the platform and cannot be edited or deleted — only
 * copied into a custom role.
 */

export const RESOURCES = [
  "tenant",
  "user",
  "role",
  "reference-data",
  "webhook",
  "feature-flag",
  "audit",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["read", "write", "delete", "admin"] as const;
export type Action = (typeof ACTIONS)[number];

export type Permission = `${Resource}:${Action}` | "*";

export const PERMISSION_CATALOG: readonly Permission[] = [
  "*",
  ...RESOURCES.flatMap((resource) => ACTIONS.map((action) => `${resource}:${action}` as Permission)),
];

export const ROLE_CODE_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export function isPermission(value: string): value is Permission {
  return (PERMISSION_CATALOG as readonly string[]).includes(value);
}

/**
 * `tenant:admin` implies read/write/delete on tenants; `*` implies everything.
 * Expansion happens once at grant time so evaluation stays a set lookup.
 */
export function expandPermission(permission: Permission): Permission[] {
  if (permission === "*") return [...PERMISSION_CATALOG];
  const [resource, action] = permission.split(":") as [Resource, Action];
  if (action !== "admin") return [permission];
  return ACTIONS.map((each) => `${resource}:${each}` as Permission);
}

export function expandPermissions(permissions: Iterable<Permission>): Set<Permission> {
  const out = new Set<Permission>();
  for (const permission of permissions) {
    for (const expanded of expandPermission(permission)) out.add(expanded);
  }
  return out;
}

export interface RoleProps {
  code: string;
  name: string;
  description?: string;
  permissions: Permission[];
  /** Code of the role this one extends, if any. */
  inheritsFrom?: string;
  system: boolean;
}

export interface CreateRoleInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly inheritsFrom?: string;
  readonly system?: boolean;
}

export class Role extends AggregateRoot<RoleProps> {
  static create(
    tenantId: TenantId,
    input: CreateRoleInput,
    existing?: Partial<EntityProps>,
  ): Role {
    const code = input.code.trim().toLowerCase();
    if (!ROLE_CODE_PATTERN.test(code)) {
      throw ValidationError.single(
        "code",
        "must be 3-40 lowercase characters: letters, digits and dashes",
      );
    }
    if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");
    const permissions = assertPermissions(input.permissions);
    if (input.inheritsFrom !== undefined && input.inheritsFrom === code) {
      throw ValidationError.single("inheritsFrom", "a role cannot inherit from itself");
    }

    const role = new Role(
      tenantId,
      {
        code,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        permissions,
        inheritsFrom: input.inheritsFrom,
        system: input.system ?? false,
      },
      existing,
    );
    role.raise(
      envelope({
        eventType: AdminEventTypes.roleCreated,
        aggregateType: "Role",
        aggregateId: role.id,
        tenantId,
        payload: { code, name: role.props.name, permissions },
      }),
    );
    return role;
  }

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string | undefined {
    return this.props.description;
  }
  get permissions(): readonly Permission[] {
    return this.props.permissions;
  }
  get inheritsFrom(): string | undefined {
    return this.props.inheritsFrom;
  }
  get isSystem(): boolean {
    return this.props.system;
  }

  update(patch: {
    name?: string;
    description?: string;
    permissions?: readonly string[];
    inheritsFrom?: string | null;
  }): void {
    this.assertEditable();
    if (patch.name !== undefined) {
      if (patch.name.trim().length === 0) throw ValidationError.single("name", "is required");
      this.props.name = patch.name.trim();
    }
    if (patch.description !== undefined) {
      this.props.description = patch.description.trim() || undefined;
    }
    if (patch.permissions !== undefined) {
      this.props.permissions = assertPermissions(patch.permissions);
    }
    if (patch.inheritsFrom !== undefined) {
      if (patch.inheritsFrom === this.props.code) {
        throw ValidationError.single("inheritsFrom", "a role cannot inherit from itself");
      }
      this.props.inheritsFrom = patch.inheritsFrom ?? undefined;
    }
    this.raise(
      envelope({
        eventType: AdminEventTypes.roleUpdated,
        aggregateType: "Role",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          code: this.props.code,
          permissions: this.props.permissions,
          inheritsFrom: this.props.inheritsFrom,
        },
      }),
    );
  }

  /** Permissions granted directly by this role, `admin` shorthands expanded. */
  effectiveOwnPermissions(): Set<Permission> {
    return expandPermissions(this.props.permissions);
  }

  assertEditable(): void {
    if (this.props.system) throw new ImmutableRecordError("Role", this.props.code);
  }
}

function assertPermissions(values: readonly string[]): Permission[] {
  if (values.length === 0) {
    throw ValidationError.single("permissions", "at least one permission is required");
  }
  const invalid = values.filter((value) => !isPermission(value));
  if (invalid.length > 0) {
    throw ValidationError.from(
      invalid.map((value) => ({
        field: "permissions",
        message: `"${value}" is not in the permission catalogue`,
      })),
    );
  }
  return [...new Set(values as Permission[])].sort();
}

/**
 * Resolves the full permission set for a role, following the inheritance chain.
 * A cycle is a configuration bug that would otherwise hang the evaluator, so it
 * is reported rather than tolerated.
 */
export function resolveRolePermissions(
  code: string,
  roles: ReadonlyMap<string, Role>,
): Set<Permission> {
  const seen: string[] = [];
  const granted = new Set<Permission>();
  let current = roles.get(code);

  while (current) {
    if (seen.includes(current.code)) {
      throw new InvalidStateError(
        `Role inheritance cycle: ${[...seen, current.code].join(" -> ")}`,
        { chain: [...seen, current.code] },
      );
    }
    seen.push(current.code);
    for (const permission of current.effectiveOwnPermissions()) granted.add(permission);
    const parent = current.inheritsFrom;
    current = parent ? roles.get(parent) : undefined;
  }
  return granted;
}

/** Union of the permissions held by a caller across all assigned roles. */
export function permissionsForRoles(
  codes: readonly string[],
  roles: ReadonlyMap<string, Role>,
): Set<Permission> {
  const granted = new Set<Permission>();
  for (const code of codes) {
    for (const permission of resolveRolePermissions(code, roles)) granted.add(permission);
  }
  return granted;
}

export function hasPermission(granted: ReadonlySet<Permission>, required: Permission): boolean {
  return granted.has("*") || granted.has(required);
}

/** The roles every tenant starts with; they are not editable. */
export const SYSTEM_ROLES: readonly CreateRoleInput[] = [
  {
    code: "tenant-admin",
    name: "Tenant Administrator",
    description: "Full control over tenant configuration, users and integrations.",
    permissions: [
      "tenant:admin",
      "user:admin",
      "role:admin",
      "reference-data:admin",
      "webhook:admin",
      "feature-flag:admin",
      "audit:read",
    ],
    system: true,
  },
  {
    code: "tenant-operator",
    name: "Tenant Operator",
    description: "Day-to-day configuration without user or role management.",
    permissions: [
      "tenant:read",
      "user:read",
      "reference-data:write",
      "reference-data:read",
      "webhook:read",
      "feature-flag:read",
      "audit:read",
    ],
    system: true,
  },
  {
    code: "auditor",
    name: "Auditor",
    description: "Read-only access, including the audit log.",
    permissions: [
      "tenant:read",
      "user:read",
      "role:read",
      "reference-data:read",
      "webhook:read",
      "feature-flag:read",
      "audit:read",
    ],
    system: true,
  },
  {
    code: "service",
    name: "Service Account",
    description: "Machine reader for reference data and flag evaluation.",
    permissions: ["reference-data:read", "feature-flag:read"],
    system: true,
  },
];
