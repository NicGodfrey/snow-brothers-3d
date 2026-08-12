import { json, type Router } from "@enterprise-suite/api-gateway";
import { tenantId as toTenantId } from "@enterprise-suite/shared-kernel";
import type { AuditOutcome, AuditQuery } from "../../domain/audit.js";
import type { AdminContainer } from "../../infrastructure/container.js";
import { pageFromQuery } from "../validate.js";

/** Audit log reads: paged entries, a rollup, and the raw event stream. */
export function registerAuditRoutes(router: Router, container: AdminContainer): void {
  const { audit } = container.services;
  const tenantOf = (req: { ctx: { tenantId: unknown } }) => toTenantId(String(req.ctx.tenantId));

  const queryFrom = (params: URLSearchParams): AuditQuery => ({
    actor: params.get("actor") ?? undefined,
    action: params.get("action") ?? undefined,
    resourceType: params.get("resourceType") ?? undefined,
    resourceId: params.get("resourceId") ?? undefined,
    outcome: (params.get("outcome") as AuditOutcome | null) ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    search: params.get("q") ?? undefined,
  });

  router.get(
    "/audit-log",
    (req) => json(200, audit.query(tenantOf(req), queryFrom(req.query), pageFromQuery(req.query))),
    "audit.list",
  );

  router.get(
    "/audit-log/summary",
    (req) => json(200, audit.summary(tenantOf(req), queryFrom(req.query))),
    "audit.summary",
  );

  /** The tenant's domain events, straight off the outbox. */
  router.get(
    "/events",
    (req) => {
      const type = req.query.get("type");
      const events = container.outbox
        .entries(tenantOf(req))
        .filter((event) => (type ? event.eventType === type : true));
      return json(200, { count: events.length, items: events });
    },
    "audit.events",
  );
}
