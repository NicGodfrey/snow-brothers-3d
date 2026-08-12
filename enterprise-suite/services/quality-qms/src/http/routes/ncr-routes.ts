import { brand } from "@enterprise-suite/shared-kernel";
import type { NcrService } from "../../application/ncr-service.js";
import type { DispositionType, NcrSeverity, NcrSource, NcrStatus } from "../../domain/ncr.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalEnum,
  optionalNumber,
  optionalString,
  optionalUlid,
  requireEnum,
  requireIsoDate,
  requireString,
  ulidParam,
} from "../validation.js";

const SOURCES: readonly NcrSource[] = [
  "inspection", "production", "customer-complaint", "supplier", "audit", "internal",
];
const SEVERITIES: readonly NcrSeverity[] = ["critical", "major", "minor"];
const STATUSES: readonly NcrStatus[] = ["draft", "open", "containment", "disposition", "closed", "cancelled"];
const DISPOSITIONS: readonly DispositionType[] = [
  "use-as-is", "rework", "repair", "scrap", "return-to-supplier", "regrade",
];

export function registerNcrRoutes(router: Router, ncrs: NcrService): void {
  router.post("/ncrs", async ({ ctx, body }) => {
    const obj = asObject(body);
    const linkageRaw = obj["linkage"] ? asObject(obj["linkage"], "linkage") : undefined;
    const ncr = await ncrs.createNcr(ctx, {
      title: requireString(obj, "title"),
      description: requireString(obj, "description"),
      source: requireEnum(obj, "source", SOURCES),
      severity: requireEnum(obj, "severity", SEVERITIES),
      defectCode: optionalString(obj, "defectCode"),
      quantityAffected: optionalNumber(obj, "quantityAffected"),
      uom: optionalString(obj, "uom"),
      materialCode: optionalString(obj, "materialCode"),
      linkage: linkageRaw
        ? {
            inspectionLotId: optionalUlid(linkageRaw, "inspectionLotId"),
            supplierId: optionalString(linkageRaw, "supplierId"),
            purchaseOrderRef: optionalString(linkageRaw, "purchaseOrderRef"),
            workOrderRef: optionalString(linkageRaw, "workOrderRef"),
            customerRef: optionalString(linkageRaw, "customerRef"),
            auditId: optionalUlid(linkageRaw, "auditId"),
          }
        : undefined,
    });
    return { status: 201, body: ncr.toJSON() };
  });

  router.get("/ncrs", async ({ ctx, query }) => {
    const status = query.get("status");
    const severity = query.get("severity");
    const lotId = query.get("inspectionLotId");
    const items = await ncrs.listNcrs(ctx, {
      status: status && STATUSES.includes(status as NcrStatus) ? (status as NcrStatus) : undefined,
      severity:
        severity && SEVERITIES.includes(severity as NcrSeverity) ? (severity as NcrSeverity) : undefined,
      supplierId: query.get("supplierId") ?? undefined,
      inspectionLotId: lotId ? brand<string, "Ulid">(lotId) : undefined,
    });
    return { body: { items: items.map((n) => n.toJSON()), total: items.length } };
  });

  router.get("/ncrs/:id", async ({ ctx, params }) => {
    const ncr = await ncrs.getNcr(ctx, ulidParam(params, "id"));
    return { body: ncr.toJSON() };
  });

  router.post("/ncrs/:id/submit", async ({ ctx, params }) => {
    const ncr = await ncrs.submit(ctx, ulidParam(params, "id"));
    return { body: ncr.toJSON() };
  });

  router.post("/ncrs/:id/containment/start", async ({ ctx, params }) => {
    const ncr = await ncrs.startContainment(ctx, ulidParam(params, "id"));
    return { body: ncr.toJSON() };
  });

  router.post("/ncrs/:id/containment/actions", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const { ncr, action } = await ncrs.addContainmentAction(ctx, ulidParam(params, "id"), {
      description: requireString(obj, "description"),
      dueAt: requireIsoDate(obj, "dueAt"),
    });
    return { status: 201, body: { ncr: ncr.toJSON(), action } };
  });

  router.post("/ncrs/:id/containment/actions/:actionId/complete", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const { ncr, action } = await ncrs.completeContainmentAction(
      ctx,
      ulidParam(params, "id"),
      ulidParam(params, "actionId"),
      optionalString(obj, "note"),
    );
    return { body: { ncr: ncr.toJSON(), action } };
  });

  router.post("/ncrs/:id/move-to-disposition", async ({ ctx, params }) => {
    const ncr = await ncrs.moveToDisposition(ctx, ulidParam(params, "id"));
    return { body: ncr.toJSON() };
  });

  router.post("/ncrs/:id/disposition", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const ncr = await ncrs.recordDisposition(ctx, ulidParam(params, "id"), {
      type: requireEnum(obj, "type", DISPOSITIONS),
      justification: requireString(obj, "justification"),
    });
    return { body: ncr.toJSON() };
  });

  router.post("/ncrs/:id/disposition/approve", async ({ ctx, params }) => {
    const ncr = await ncrs.approveDisposition(ctx, ulidParam(params, "id"));
    return { body: ncr.toJSON() };
  });

  router.post("/ncrs/:id/escalate", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const { ncr, capa } = await ncrs.escalateToCapa(ctx, ulidParam(params, "id"), {
      type: optionalEnum(obj, "type", ["corrective", "preventive"] as const),
      title: optionalString(obj, "title"),
      description: optionalString(obj, "description"),
      priority: optionalEnum(obj, "priority", ["low", "medium", "high", "urgent"] as const),
    });
    return { status: 201, body: { ncr: ncr.toJSON(), capa: capa.toJSON() } };
  });

  router.post("/ncrs/:id/close", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const ncr = await ncrs.close(ctx, ulidParam(params, "id"), optionalString(obj, "note"));
    return { body: ncr.toJSON() };
  });

  router.post("/ncrs/:id/cancel", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const ncr = await ncrs.cancel(ctx, ulidParam(params, "id"), requireString(obj, "reason"));
    return { body: ncr.toJSON() };
  });
}
