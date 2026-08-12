import { DomainError, type Ulid } from "@enterprise-suite/shared-kernel";
import { isSubjectType, subjectRef, type SubjectRef } from "../../domain/subject.js";
import type { IdentityModule } from "../../infrastructure/container.js";
import { toScope } from "../../rbac/helpers.js";
import { optionalString, optionalStringArray, requireString } from "../json.js";
import { ok, type Router } from "../router.js";

export function registerAuthzRoutes(router: Router, module: IdentityModule): void {
  /**
   * Decision endpoint for other services. The caller asks about itself by default; asking
   * on behalf of another subject requires `identity.authz:check`.
   */
  router.post("/identity/authz/check", ({ principal, body, correlationId }) => {
    const onBehalfOf = subjectFromBody(body);
    if (onBehalfOf) module.authorization.require(principal, "identity.authz:check");
    const subjectPrincipal = onBehalfOf
      ? { ...principal, subject: onBehalfOf, restrictions: undefined }
      : principal;
    const decision = module.authorization.check(subjectPrincipal, requireString(body, "permission"), {
      scope: optionalString(body, "scope"),
      resourceId: optionalString(body, "resourceId"),
      correlationId,
    });
    return ok(decision);
  });

  router.post("/identity/authz/check-batch", ({ principal, body, correlationId }) => {
    const permissions = optionalStringArray(body, "permissions");
    if (!permissions || permissions.length === 0) {
      throw new DomainError("permissions must be a non-empty array", "VALIDATION", 422);
    }
    const onBehalfOf = subjectFromBody(body);
    if (onBehalfOf) module.authorization.require(principal, "identity.authz:check");
    const subjectPrincipal = onBehalfOf
      ? { ...principal, subject: onBehalfOf, restrictions: undefined }
      : principal;
    return ok({
      decisions: module.authorization.checkMany(subjectPrincipal, permissions, {
        scope: optionalString(body, "scope"),
        correlationId,
      }),
    });
  });

  /** Full evaluation trace; the endpoint support staff use to answer "why not?". */
  router.post(
    "/identity/authz/explain",
    ({ principal, body }) => {
      const onBehalfOf = subjectFromBody(body);
      const subjectPrincipal = onBehalfOf
        ? { ...principal, subject: onBehalfOf, restrictions: undefined }
        : principal;
      return ok(
        module.authorization.explain(subjectPrincipal, requireString(body, "permission"), {
          scope: optionalString(body, "scope"),
        }),
      );
    },
    { permission: "identity.authz:explain" },
  );

  router.get(
    "/identity/authz/subjects",
    ({ principal, query }) => {
      const permission = query.get("permission");
      if (!permission) {
        throw new DomainError("permission query parameter is required", "VALIDATION", 422);
      }
      return ok({
        permission,
        scope: toScope(query.get("scope") ?? undefined),
        subjects: module.authorization.subjectsWithPermission(
          principal.tenantId,
          permission,
          toScope(query.get("scope") ?? undefined),
        ),
      });
    },
    { permission: "identity.role_binding:read" },
  );

  router.get(
    "/identity/permissions",
    ({ query }) => {
      const search = query.get("search");
      const category = query.get("category");
      const definitions = search
        ? module.catalog.search(search)
        : category
          ? module.catalog.byCategory(category)
          : module.catalog.list();
      return ok({ categories: module.catalog.categories(), permissions: definitions });
    },
    { permission: "identity.permission:read" },
  );

  router.get("/identity/authz/cache-stats", ({ principal }) => {
    module.authorization.require(principal, "identity.audit:read");
    return ok(module.authorization.cacheStats());
  });
}

function subjectFromBody(body: unknown): SubjectRef | undefined {
  const record = body as Record<string, unknown> | undefined;
  const type = record?.subjectType;
  const id = record?.subjectId;
  if (type === undefined && id === undefined) return undefined;
  if (typeof type !== "string" || typeof id !== "string" || !isSubjectType(type)) {
    throw new DomainError("subjectType and subjectId must both be valid", "VALIDATION", 422);
  }
  return subjectRef(type, id as Ulid);
}
