import { DomainError, type IsoDateTime, type Ulid } from "@enterprise-suite/shared-kernel";
import { roleCodeOf } from "../../domain/role.js";
import { isSubjectType, subjectRef, type SubjectRef } from "../../domain/subject.js";
import type { IdentityModule } from "../../infrastructure/container.js";
import { optionalBoolean, optionalNumber, optionalString, requireString } from "../json.js";
import { created, ok, type Router } from "../router.js";

export function registerBindingRoutes(router: Router, module: IdentityModule): void {
  router.get(
    "/identity/role-bindings",
    ({ principal, query }) =>
      ok(
        module.bindings
          .list(principal.tenantId, {
            subject: subjectFromQuery(query),
            roleCode: query.get("roleCode") ? roleCodeOf(query.get("roleCode") as string) : undefined,
            scopePrefix: query.get("scope") ?? undefined,
            activeOnly: query.get("activeOnly") !== "false",
          })
          .map((binding) => binding.toJSON()),
      ),
    { permission: "identity.role_binding:read" },
  );

  router.post(
    "/identity/role-bindings",
    ({ principal, body }) => {
      const hours = optionalNumber(body, "hours");
      const input = {
        subject: subjectFromBody(body),
        roleCode: requireString(body, "roleCode"),
        scope: optionalString(body, "scope"),
        grantedBy: principal.subject.id,
        reason: optionalString(body, "reason"),
        delegable: optionalBoolean(body, "delegable"),
      };
      const binding = hours
        ? module.bindings.grantTemporary(principal.tenantId, { ...input, hours })
        : module.bindings.grant(principal.tenantId, {
            ...input,
            validUntil: optionalString(body, "validUntil") as IsoDateTime | undefined,
          });
      return created(binding.toJSON());
    },
    { permission: "identity.role_binding:grant" },
  );

  /** Delegation is checked against the caller's own delegable bindings, not a permission. */
  router.post(
    "/identity/role-bindings/delegate",
    ({ principal, body }) =>
      created(
        module.bindings
          .delegate(principal.tenantId, principal.subject, {
            subject: subjectFromBody(body),
            roleCode: requireString(body, "roleCode"),
            scope: optionalString(body, "scope"),
            reason: optionalString(body, "reason"),
          })
          .toJSON(),
      ),
    { permission: "identity.role_binding:delegate" },
  );

  router.get(
    "/identity/role-bindings/expiring",
    ({ principal, query }) =>
      ok(
        module.bindings
          .expiringWithin(principal.tenantId, Number(query.get("hours") ?? 24))
          .map((binding) => binding.toJSON()),
      ),
    { permission: "identity.role_binding:read" },
  );

  router.get(
    "/identity/role-bindings/:bindingId",
    ({ principal, params }) =>
      ok(module.bindings.get(principal.tenantId, params.bindingId as Ulid).toJSON()),
    { permission: "identity.role_binding:read" },
  );

  router.patch(
    "/identity/role-bindings/:bindingId",
    ({ principal, params, body }) =>
      ok(
        module.bindings
          .extend(
            principal.tenantId,
            params.bindingId as Ulid,
            optionalString(body, "validUntil") as IsoDateTime | undefined,
          )
          .toJSON(),
      ),
    { permission: "identity.role_binding:grant" },
  );

  router.delete(
    "/identity/role-bindings/:bindingId",
    ({ principal, params, query }) =>
      ok(
        module.bindings
          .revoke(principal.tenantId, params.bindingId as Ulid, {
            by: principal.subject.id,
            reason: query.get("reason") ?? undefined,
          })
          .toJSON(),
      ),
    { permission: "identity.role_binding:revoke" },
  );

  /** Everything a subject holds, including what it inherits from its groups. */
  router.get(
    "/identity/subjects/:subjectType/:subjectId/role-bindings",
    ({ principal, params }) =>
      ok(
        module.bindings
          .effectiveFor(principal.tenantId, subjectFromParams(params))
          .map((binding) => binding.toJSON()),
      ),
    { permission: "identity.role_binding:read" },
  );
}

function subjectFromBody(body: unknown): SubjectRef {
  const type = requireString(body, "subjectType");
  if (!isSubjectType(type)) {
    throw new DomainError(`Unknown subject type "${type}"`, "VALIDATION", 422);
  }
  return subjectRef(type, requireString(body, "subjectId"));
}

function subjectFromParams(params: Readonly<Record<string, string>>): SubjectRef {
  if (!isSubjectType(params.subjectType)) {
    throw new DomainError(`Unknown subject type "${params.subjectType}"`, "VALIDATION", 422);
  }
  return subjectRef(params.subjectType, params.subjectId);
}

function subjectFromQuery(query: URLSearchParams): SubjectRef | undefined {
  const type = query.get("subjectType");
  const id = query.get("subjectId");
  if (!type || !id) return undefined;
  if (!isSubjectType(type)) {
    throw new DomainError(`Unknown subject type "${type}"`, "VALIDATION", 422);
  }
  return subjectRef(type, id);
}
