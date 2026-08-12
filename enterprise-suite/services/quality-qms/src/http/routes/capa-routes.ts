import type { CapaService } from "../../application/capa-service.js";
import { riskRating, type CapaStatus } from "../../domain/capa.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalString,
  optionalUlid,
  requireEnum,
  requireIsoDate,
  requireNumber,
  requireObjectArray,
  requireString,
  ulidParam,
} from "../validation.js";

const STATUSES: readonly CapaStatus[] = [
  "draft", "open", "investigation", "action-planning", "implementation", "verification", "closed", "cancelled",
];

export function registerCapaRoutes(router: Router, capas: CapaService): void {
  router.post("/capas", async ({ ctx, body }) => {
    const obj = asObject(body);
    const riskRaw = obj["riskRating"] ? asObject(obj["riskRating"], "riskRating") : undefined;
    const sourceRaw = obj["source"] ? asObject(obj["source"], "source") : undefined;
    const capa = await capas.createCapa(ctx, {
      type: requireEnum(obj, "type", ["corrective", "preventive"] as const),
      title: requireString(obj, "title"),
      description: requireString(obj, "description"),
      priority: requireEnum(obj, "priority", ["low", "medium", "high", "urgent"] as const),
      owner: optionalString(obj, "owner"),
      riskRating: riskRaw
        ? riskRating(
            requireNumber(riskRaw, "severity"),
            requireNumber(riskRaw, "occurrence"),
            requireNumber(riskRaw, "detection"),
          )
        : undefined,
      source: sourceRaw
        ? {
            ncrIds: Array.isArray(sourceRaw["ncrIds"])
              ? (sourceRaw["ncrIds"] as string[]).map((id) =>
                  ulidParam({ id }, "id"),
                )
              : [],
            auditId: optionalUlid(sourceRaw, "auditId"),
            supplierEventId: optionalUlid(sourceRaw, "supplierEventId"),
            supplierId: optionalString(sourceRaw, "supplierId"),
            customerRef: optionalString(sourceRaw, "customerRef"),
          }
        : undefined,
    });
    return { status: 201, body: capa.toJSON() };
  });

  router.get("/capas", async ({ ctx, query }) => {
    const status = query.get("status");
    const ncrId = query.get("ncrId");
    const items = await capas.listCapas(ctx, {
      status: status && STATUSES.includes(status as CapaStatus) ? (status as CapaStatus) : undefined,
      ncrId: ncrId ? ulidParam({ ncrId }, "ncrId") : undefined,
    });
    return { body: { items: items.map((c) => c.toJSON()), total: items.length } };
  });

  router.get("/capas/overdue", async ({ ctx }) => {
    const entries = await capas.listOverdue(ctx);
    return {
      body: {
        items: entries.map((e) => ({ capa: e.capa.toJSON(), overdueActions: e.overdueActions })),
        total: entries.length,
      },
    };
  });

  router.get("/capas/:id", async ({ ctx, params }) => {
    const capa = await capas.getCapa(ctx, ulidParam(params, "id"));
    return { body: capa.toJSON() };
  });

  router.post("/capas/:id/submit", async ({ ctx, params }) => {
    return { body: (await capas.submit(ctx, ulidParam(params, "id"))).toJSON() };
  });

  router.post("/capas/:id/start-investigation", async ({ ctx, params }) => {
    return { body: (await capas.startInvestigation(ctx, ulidParam(params, "id"))).toJSON() };
  });

  router.post("/capas/:id/root-cause", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const causes = requireObjectArray(obj, "causes").map((c) => ({
      category: optionalString(c, "category"),
      description: requireString(c, "description"),
    }));
    const capa = await capas.recordRootCause(ctx, ulidParam(params, "id"), {
      method: requireEnum(obj, "method", ["5-whys", "fishbone", "8d", "fault-tree", "other"] as const),
      summary: requireString(obj, "summary"),
      causes,
    });
    return { body: capa.toJSON() };
  });

  router.post("/capas/:id/move-to-action-planning", async ({ ctx, params }) => {
    return { body: (await capas.moveToActionPlanning(ctx, ulidParam(params, "id"))).toJSON() };
  });

  router.post("/capas/:id/actions", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const { capa, action } = await capas.addAction(ctx, ulidParam(params, "id"), {
      type: requireEnum(obj, "type", ["containment", "corrective", "preventive"] as const),
      description: requireString(obj, "description"),
      owner: optionalString(obj, "owner"),
      dueAt: requireIsoDate(obj, "dueAt"),
    });
    return { status: 201, body: { capa: capa.toJSON(), action } };
  });

  router.post("/capas/:id/actions/:actionId/start", async ({ ctx, params }) => {
    const capa = await capas.startAction(ctx, ulidParam(params, "id"), ulidParam(params, "actionId"));
    return { body: capa.toJSON() };
  });

  router.post("/capas/:id/actions/:actionId/complete", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const capa = await capas.completeAction(
      ctx,
      ulidParam(params, "id"),
      ulidParam(params, "actionId"),
      optionalString(obj, "note"),
    );
    return { body: capa.toJSON() };
  });

  router.post("/capas/:id/actions/:actionId/cancel", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const capa = await capas.cancelAction(
      ctx,
      ulidParam(params, "id"),
      ulidParam(params, "actionId"),
      requireString(obj, "reason"),
    );
    return { body: capa.toJSON() };
  });

  router.post("/capas/:id/begin-implementation", async ({ ctx, params }) => {
    return { body: (await capas.beginImplementation(ctx, ulidParam(params, "id"))).toJSON() };
  });

  router.post("/capas/:id/effectiveness-check", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const capa = await capas.defineEffectivenessCheck(ctx, ulidParam(params, "id"), {
      criteria: requireString(obj, "criteria"),
      dueAt: requireIsoDate(obj, "dueAt"),
    });
    return { body: capa.toJSON() };
  });

  router.post("/capas/:id/request-verification", async ({ ctx, params }) => {
    return { body: (await capas.requestVerification(ctx, ulidParam(params, "id"))).toJSON() };
  });

  router.post("/capas/:id/effectiveness", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const capa = await capas.recordEffectiveness(ctx, ulidParam(params, "id"), {
      outcome: requireEnum(obj, "outcome", ["effective", "not-effective"] as const),
      note: optionalString(obj, "note"),
    });
    return { body: capa.toJSON() };
  });

  router.post("/capas/:id/return-to-planning", async ({ ctx, params }) => {
    return { body: (await capas.returnToPlanning(ctx, ulidParam(params, "id"))).toJSON() };
  });

  router.post("/capas/:id/close", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    return { body: (await capas.close(ctx, ulidParam(params, "id"), optionalString(obj, "note"))).toJSON() };
  });

  router.post("/capas/:id/cancel", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    return {
      body: (await capas.cancel(ctx, ulidParam(params, "id"), requireString(obj, "reason"))).toJSON(),
    };
  });
}
