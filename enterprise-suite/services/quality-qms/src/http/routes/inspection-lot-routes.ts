import type { InspectionLotService } from "../../application/inspection-lot-service.js";
import type { LotStatus, UsageDecisionType } from "../../domain/inspection-lot.js";
import type { LotOrigin } from "../../domain/inspection-plan.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireEnum,
  requireNumber,
  requireNumberArray,
  requireString,
  requireUlid,
  ulidParam,
} from "../validation.js";

const LOT_STATUSES: readonly LotStatus[] = ["created", "in-progress", "completed", "decided", "cancelled"];
const ORIGINS: readonly LotOrigin[] = ["goods-receipt", "in-process", "final", "customer-return", "stock-audit"];
const DECISIONS: readonly UsageDecisionType[] = ["accept", "reject", "accept-with-deviation", "partial"];

export function registerInspectionLotRoutes(router: Router, lots: InspectionLotService): void {
  router.post("/inspection-lots", async ({ ctx, body }) => {
    const obj = asObject(body);
    const lot = await lots.createLot(ctx, {
      planId: requireUlid(obj, "planId"),
      origin: requireEnum(obj, "origin", ORIGINS),
      quantity: requireNumber(obj, "quantity"),
      uom: requireString(obj, "uom"),
      materialCode: optionalString(obj, "materialCode"),
      supplierId: optionalString(obj, "supplierId"),
      purchaseOrderRef: optionalString(obj, "purchaseOrderRef"),
      workOrderRef: optionalString(obj, "workOrderRef"),
      customerRef: optionalString(obj, "customerRef"),
      batchNumber: optionalString(obj, "batchNumber"),
    });
    return { status: 201, body: lot.toJSON() };
  });

  router.get("/inspection-lots", async ({ ctx, query }) => {
    const status = query.get("status");
    const origin = query.get("origin");
    const items = await lots.listLots(ctx, {
      status: status && LOT_STATUSES.includes(status as LotStatus) ? (status as LotStatus) : undefined,
      origin: origin && ORIGINS.includes(origin as LotOrigin) ? (origin as LotOrigin) : undefined,
      supplierId: query.get("supplierId") ?? undefined,
      materialCode: query.get("materialCode") ?? undefined,
    });
    return { body: { items: items.map((l) => l.toJSON()), total: items.length } };
  });

  router.get("/inspection-lots/:id", async ({ ctx, params }) => {
    const lot = await lots.getLot(ctx, ulidParam(params, "id"));
    return { body: lot.toJSON() };
  });

  router.post("/inspection-lots/:id/start", async ({ ctx, params }) => {
    const lot = await lots.startInspection(ctx, ulidParam(params, "id"));
    return { body: lot.toJSON() };
  });

  router.post("/inspection-lots/:id/results/quantitative", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const lot = await lots.recordQuantitativeResult(
      ctx,
      ulidParam(params, "id"),
      requireString(obj, "characteristicCode"),
      requireNumberArray(obj, "readings"),
      optionalString(obj, "note"),
    );
    return { status: 201, body: lot.toJSON() };
  });

  router.post("/inspection-lots/:id/results/attribute", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const lot = await lots.recordAttributeResult(
      ctx,
      ulidParam(params, "id"),
      requireString(obj, "characteristicCode"),
      { inspected: requireNumber(obj, "inspected"), defective: requireNumber(obj, "defective") },
      optionalString(obj, "note"),
    );
    return { status: 201, body: lot.toJSON() };
  });

  router.post("/inspection-lots/:id/complete", async ({ ctx, params }) => {
    const lot = await lots.completeInspection(ctx, ulidParam(params, "id"));
    return { body: lot.toJSON() };
  });

  router.post("/inspection-lots/:id/decision", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const outcome = await lots.decideUsage(ctx, ulidParam(params, "id"), {
      decision: requireEnum(obj, "decision", DECISIONS),
      note: optionalString(obj, "note"),
      acceptedQuantity: optionalNumber(obj, "acceptedQuantity"),
      autoCreateNcr: optionalBoolean(obj, "autoCreateNcr"),
    });
    return {
      body: {
        lot: outcome.lot.toJSON(),
        ncr: outcome.ncr?.toJSON(),
        supplierEvent: outcome.supplierEvent?.toJSON(),
      },
    };
  });

  router.post("/inspection-lots/:id/cancel", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const lot = await lots.cancelLot(ctx, ulidParam(params, "id"), requireString(obj, "reason"));
    return { body: lot.toJSON() };
  });
}
