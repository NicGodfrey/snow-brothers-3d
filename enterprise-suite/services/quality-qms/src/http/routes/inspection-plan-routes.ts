import type { InspectionPlanService } from "../../application/inspection-plan-service.js";
import type { LotOrigin, PlanStatus } from "../../domain/inspection-plan.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalEnum,
  optionalString,
  requireEnum,
  requireObjectArray,
  requireString,
  ulidParam,
} from "../validation.js";
import { parseCharacteristic, parseSamplingRule } from "./parsers.js";

const ORIGINS: readonly LotOrigin[] = ["goods-receipt", "in-process", "final", "customer-return", "stock-audit"];
const PLAN_STATUSES: readonly PlanStatus[] = ["draft", "active", "retired"];

export function registerInspectionPlanRoutes(router: Router, plans: InspectionPlanService): void {
  router.post("/inspection-plans", async ({ ctx, body }) => {
    const obj = asObject(body);
    const allowedOriginsRaw = obj["allowedOrigins"];
    let allowedOrigins: LotOrigin[] | undefined;
    if (allowedOriginsRaw !== undefined) {
      const arr = Array.isArray(allowedOriginsRaw) ? allowedOriginsRaw : [];
      allowedOrigins = arr.map((o) =>
        requireEnum({ origin: o } as Record<string, unknown>, "origin", ORIGINS),
      );
    }
    const characteristics = obj["characteristics"]
      ? requireObjectArray(obj, "characteristics").map(parseCharacteristic)
      : undefined;
    const plan = await plans.createPlan(ctx, {
      planCode: requireString(obj, "planCode"),
      name: requireString(obj, "name"),
      description: optionalString(obj, "description"),
      targetType: requireEnum(obj, "targetType", ["material", "product", "process"] as const),
      materialCode: optionalString(obj, "materialCode"),
      allowedOrigins,
      samplingRule: parseSamplingRule(obj["samplingRule"]),
      characteristics,
    });
    return { status: 201, body: plan.toJSON() };
  });

  router.get("/inspection-plans", async ({ ctx, query }) => {
    const status = query.get("status");
    const items = await plans.listPlans(ctx, {
      status: status && PLAN_STATUSES.includes(status as PlanStatus) ? (status as PlanStatus) : undefined,
      materialCode: query.get("materialCode") ?? undefined,
    });
    return { body: { items: items.map((p) => p.toJSON()), total: items.length } };
  });

  router.get("/inspection-plans/:id", async ({ ctx, params }) => {
    const plan = await plans.getPlan(ctx, ulidParam(params, "id"));
    return { body: plan.toJSON() };
  });

  router.post("/inspection-plans/:id/characteristics", async ({ ctx, params, body }) => {
    const { plan, characteristic } = await plans.addCharacteristic(
      ctx,
      ulidParam(params, "id"),
      parseCharacteristic(asObject(body)),
    );
    return { status: 201, body: { plan: plan.toJSON(), characteristic } };
  });

  router.delete("/inspection-plans/:id/characteristics/:characteristicId", async ({ ctx, params }) => {
    const plan = await plans.removeCharacteristic(
      ctx,
      ulidParam(params, "id"),
      ulidParam(params, "characteristicId"),
    );
    return { body: plan.toJSON() };
  });

  router.put("/inspection-plans/:id/sampling-rule", async ({ ctx, params, body }) => {
    const plan = await plans.updateSamplingRule(ctx, ulidParam(params, "id"), parseSamplingRule(body));
    return { body: plan.toJSON() };
  });

  router.post("/inspection-plans/:id/activate", async ({ ctx, params }) => {
    const plan = await plans.activatePlan(ctx, ulidParam(params, "id"));
    return { body: plan.toJSON() };
  });

  router.post("/inspection-plans/:id/retire", async ({ ctx, params }) => {
    const plan = await plans.retirePlan(ctx, ulidParam(params, "id"));
    return { body: plan.toJSON() };
  });

  router.post("/inspection-plans/:id/revise", async ({ ctx, params }) => {
    const next = await plans.revisePlan(ctx, ulidParam(params, "id"));
    return { status: 201, body: next.toJSON() };
  });
}
