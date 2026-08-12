import type { AttributionService } from "../../application/attribution-service.js";
import type { BudgetService } from "../../application/budget-service.js";
import type { Router } from "../router.js";
import {
  asRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireNumber,
  requireString,
} from "../validation.js";

export function registerAttributionRoutes(
  router: Router,
  attribution: AttributionService,
  budgets: BudgetService,
): void {
  router.get("/attribution/report", ({ ctx, query }) => ({
    body: attribution.report(ctx, query.get("model") ?? "linear"),
  }));

  router.get("/attribution/compare", ({ ctx }) => ({
    body: attribution.compareModels(ctx),
  }));

  router.post("/budgets", ({ ctx, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: budgets.create(ctx, {
        campaignId: requireString(b, "campaignId"),
        totalMinor: requireNumber(b, "totalMinor"),
        currency: requireString(b, "currency"),
        warnThreshold: optionalNumber(b, "warnThreshold"),
        allowOverspend: optionalBoolean(b, "allowOverspend"),
      }),
    };
  });

  router.get("/budgets/:id", ({ ctx, params }) => ({
    body: budgets.get(ctx, params.id!),
  }));

  router.post("/budgets/:id/spend", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: budgets.recordSpend(ctx, params.id!, {
        amountMinor: requireNumber(b, "amountMinor"),
        currency: requireString(b, "currency"),
        category: requireString(b, "category"),
        channelId: optionalString(b, "channelId"),
        occurredAt: optionalString(b, "occurredAt"),
        note: optionalString(b, "note"),
      }),
    };
  });

  router.post("/budgets/:id/adjust", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      body: budgets.adjustTotal(
        ctx,
        params.id!,
        requireNumber(b, "totalMinor"),
        requireString(b, "currency"),
        requireString(b, "reason"),
      ),
    };
  });

  router.get("/roi/portfolio", ({ ctx, query }) => ({
    body: budgets.portfolioRoi(ctx, query.get("model") ?? "linear"),
  }));
}
