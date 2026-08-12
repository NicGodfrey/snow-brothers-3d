import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { AuditCategory, AuditOutcome, AuditQuery } from "../../domain/audit.js";
import { isSubjectType, subjectRef } from "../../domain/subject.js";
import type { IdentityModule } from "../../infrastructure/container.js";
import { ok, respond, type Router } from "../router.js";

export function registerAuditRoutes(router: Router, module: IdentityModule): void {
  router.get(
    "/identity/audit",
    ({ principal, query }) => {
      const page = module.audit.page(
        principal.tenantId,
        { page: Number(query.get("page") ?? 1), pageSize: Number(query.get("pageSize") ?? 50) },
        auditQuery(query),
      );
      return ok({ ...page, items: page.items.map((entry) => entry.toJSON()) });
    },
    { permission: "identity.audit:read" },
  );

  router.get(
    "/identity/audit/denials",
    ({ principal, query }) =>
      ok(
        module.audit
          .recentDenials(principal.tenantId, Number(query.get("limit") ?? 50))
          .map((entry) => entry.toJSON()),
      ),
    { permission: "identity.audit:read" },
  );

  /** Aggregated denials: the view that tells you a role is missing a permission. */
  router.get(
    "/identity/audit/denial-summary",
    ({ principal, query }) =>
      ok(module.audit.denialSummary(principal.tenantId, query.get("since") ?? undefined)),
    { permission: "identity.audit:read" },
  );

  router.get(
    "/identity/audit/subject-activity",
    ({ principal, query }) =>
      ok(module.audit.subjectActivity(principal.tenantId, query.get("since") ?? undefined)),
    { permission: "identity.audit:read" },
  );

  router.get(
    "/identity/audit/trace/:correlationId",
    ({ principal, params }) =>
      ok(
        module.audit
          .trace(principal.tenantId, params.correlationId as Ulid)
          .map((entry) => entry.toJSON()),
      ),
    { permission: "identity.audit:read" },
  );

  /** NDJSON so the response streams straight into a SIEM ingest pipeline. */
  router.get(
    "/identity/audit/export",
    ({ principal, query }) =>
      respond(200, {
        contentType: "application/x-ndjson",
        body: module.audit.exportNdjson(principal.tenantId, auditQuery(query)),
      }),
    { permission: "identity.audit:export" },
  );
}

function auditQuery(query: URLSearchParams): AuditQuery {
  const subjectType = query.get("subjectType");
  const subjectId = query.get("subjectId");
  return {
    category: (query.get("category") as AuditCategory | null) ?? undefined,
    outcome: (query.get("outcome") as AuditOutcome | null) ?? undefined,
    action: query.get("action") ?? undefined,
    scopePrefix: query.get("scope") ?? undefined,
    from: (query.get("from") as never) ?? undefined,
    to: (query.get("to") as never) ?? undefined,
    subject:
      subjectType && subjectId && isSubjectType(subjectType)
        ? subjectRef(subjectType, subjectId)
        : undefined,
  };
}
