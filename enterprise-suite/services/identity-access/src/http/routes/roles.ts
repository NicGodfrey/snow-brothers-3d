import type { RoleCode } from "@enterprise-suite/shared-kernel";
import { roleCodeOf } from "../../domain/role.js";
import type { IdentityModule } from "../../infrastructure/container.js";
import type { GrantInput } from "../../application/role-service.js";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { optionalBoolean, optionalString, optionalStringArray, requireString } from "../json.js";
import { created, noContent, ok, type Router } from "../router.js";

export function registerRoleRoutes(router: Router, module: IdentityModule): void {
  router.get(
    "/identity/roles",
    ({ principal, query }) =>
      ok(
        module.roles
          .list(principal.tenantId, { assignableOnly: query.get("assignableOnly") === "true" })
          .map((role) => role.toJSON()),
      ),
    { permission: "identity.role:read" },
  );

  router.post(
    "/identity/roles",
    ({ principal, body }) =>
      created(
        module.roles
          .create(principal.tenantId, {
            code: requireString(body, "code"),
            name: requireString(body, "name"),
            description: optionalString(body, "description"),
            grants: grantsFrom(body),
            inherits: optionalStringArray(body, "inherits"),
            assignable: optionalBoolean(body, "assignable"),
          })
          .toJSON(),
      ),
    { permission: "identity.role:create" },
  );

  router.get(
    "/identity/roles/:code",
    ({ principal, params }) => ok(module.roles.get(principal.tenantId, code(params.code)).toJSON()),
    { permission: "identity.role:read" },
  );

  /** Flattened view: what the role actually confers once inheritance is applied. */
  router.get(
    "/identity/roles/:code/effective",
    ({ principal, params }) => ok(module.roles.resolve(principal.tenantId, code(params.code))),
    { permission: "identity.role:read" },
  );

  router.patch(
    "/identity/roles/:code",
    ({ principal, params, body }) =>
      ok(
        module.roles
          .describe(principal.tenantId, code(params.code), {
            name: optionalString(body, "name"),
            description: optionalString(body, "description"),
            assignable: optionalBoolean(body, "assignable"),
          })
          .toJSON(),
      ),
    { permission: "identity.role:update" },
  );

  router.put(
    "/identity/roles/:code/grants",
    ({ principal, params, body }) =>
      ok(
        module.roles
          .replaceGrants(principal.tenantId, code(params.code), grantsFrom(body) ?? [])
          .toJSON(),
      ),
    { permission: "identity.role:update" },
  );

  router.post(
    "/identity/roles/:code/grants",
    ({ principal, params, body }) =>
      created(
        module.roles
          .addGrant(principal.tenantId, code(params.code), {
            effect: (optionalString(body, "effect") as "allow" | "deny" | undefined) ?? "allow",
            permission: requireString(body, "permission"),
            scope: optionalString(body, "scope"),
          })
          .toJSON(),
      ),
    { permission: "identity.role:update" },
  );

  router.delete(
    "/identity/roles/:code/grants",
    ({ principal, params, query }) => {
      const permission = query.get("permission");
      if (!permission) throw new DomainError("permission query parameter is required", "VALIDATION", 422);
      return ok(
        module.roles
          .removeGrant(principal.tenantId, code(params.code), {
            effect: (query.get("effect") as "allow" | "deny" | null) ?? "allow",
            permission,
            scope: query.get("scope") ?? undefined,
          })
          .toJSON(),
      );
    },
    { permission: "identity.role:update" },
  );

  router.put(
    "/identity/roles/:code/inherits",
    ({ principal, params, body }) =>
      ok(
        module.roles
          .setInherits(principal.tenantId, code(params.code), optionalStringArray(body, "inherits") ?? [])
          .toJSON(),
      ),
    { permission: "identity.role:update" },
  );

  /** Cloning is how a tenant customizes an immutable system role. */
  router.post(
    "/identity/roles/:code/clone",
    ({ principal, params, body }) =>
      created(
        module.roles
          .clone(
            principal.tenantId,
            code(params.code),
            requireString(body, "code"),
            requireString(body, "name"),
          )
          .toJSON(),
      ),
    { permission: "identity.role:create" },
  );

  router.delete(
    "/identity/roles/:code",
    ({ principal, params }) => {
      module.roles.delete(principal.tenantId, code(params.code));
      return noContent();
    },
    { permission: "identity.role:delete" },
  );
}

function code(value: string): RoleCode {
  return roleCodeOf(value);
}

function grantsFrom(body: unknown): readonly GrantInput[] | undefined {
  const raw = (body as Record<string, unknown> | undefined)?.grants;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new DomainError("Field \"grants\" must be an array", "VALIDATION", 422);
  }
  return raw.map((entry) => {
    if (typeof entry === "string") return { permission: entry };
    const record = entry as Record<string, unknown>;
    if (typeof record.permission !== "string") {
      throw new DomainError("Each grant needs a \"permission\"", "VALIDATION", 422);
    }
    return {
      effect: (record.effect as "allow" | "deny" | undefined) ?? "allow",
      permission: record.permission,
      scope: typeof record.scope === "string" ? record.scope : undefined,
    };
  });
}
