import type { Ulid } from "@enterprise-suite/shared-kernel";
import {
  HOLD_REASON_CODES,
  HOLD_TYPES,
  RISK_CATEGORIES,
  RISK_SOURCES,
  type HoldReasonCode,
  type HoldScope,
  type HoldType,
  type RiskCategory,
  type RiskSource,
  type RiskTier,
} from "../../domain/risk.js";
import type { SrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalDate,
  optionalEnum,
  optionalIdArray,
  optionalString,
  optionalStringArray,
  optionalUserId,
  queryDate,
  queryEnum,
  queryId,
  requiredDate,
  requiredEnum,
  requiredNumber,
  requiredString,
} from "../validate.js";

const RISK_TIERS = ["low", "medium", "high", "critical"] as const satisfies readonly RiskTier[];
const HOLD_SCOPES = ["supplier", "categories", "sites"] as const satisfies readonly HoldScope[];

export function registerRiskRoutes(router: Router, container: SrmContainer): void {
  const { services } = container;

  router.get("/suppliers/:id/risk", async (req) =>
    jsonResponse(200, (await services.risk.profile(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  /** Portfolio heatmap, worst score first. */
  router.get("/risk/heatmap", async (req) =>
    jsonResponse(200, await services.risk.heatmap(req.ctx, queryEnum<RiskTier>(req.query, "minimumTier", RISK_TIERS))),
  );

  /** Open flags whose review date has arrived. */
  router.get("/risk/review-queue", async (req) => jsonResponse(200, await services.risk.reviewQueue(req.ctx)));

  // --- risk flags ----------------------------------------------------------

  router.post("/suppliers/:id/risk/flags", async (req) => {
    const body = asRecord(req.body);
    const flag = await services.risk.raiseFlag(req.ctx, req.params["id"] as Ulid, {
      category: requiredEnum<RiskCategory>(body, "category", RISK_CATEGORIES),
      title: requiredString(body, "title"),
      source: requiredEnum<RiskSource>(body, "source", RISK_SOURCES),
      likelihood: requiredNumber(body, "likelihood"),
      impact: requiredNumber(body, "impact"),
      detectedOn: requiredDate(body, "detectedOn"),
      description: optionalString(body, "description"),
      ownerId: optionalUserId(body, "ownerId"),
      reviewDueOn: optionalDate(body, "reviewDueOn"),
      sourceRef: optionalString(body, "sourceRef"),
    });
    return jsonResponse(201, flag);
  });

  router.post("/suppliers/:id/risk/flags/:flagId/mitigate", async (req) => {
    const body = asRecord(req.body);
    const flag = await services.risk.mitigateFlag(req.ctx, req.params["id"] as Ulid, req.params["flagId"] as Ulid, {
      plan: requiredString(body, "plan"),
      ownerId: optionalUserId(body, "ownerId") ?? req.ctx.userId,
      dueOn: requiredDate(body, "dueOn"),
      residualLikelihood: requiredNumber(body, "residualLikelihood"),
      residualImpact: requiredNumber(body, "residualImpact"),
    });
    return jsonResponse(200, flag);
  });

  router.post("/suppliers/:id/risk/flags/:flagId/accept", async (req) => {
    const body = asRecord(req.body);
    const flag = await services.risk.acceptFlag(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["flagId"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, flag);
  });

  router.post("/suppliers/:id/risk/flags/:flagId/close", async (req) => {
    const body = asRecord(req.body);
    const flag = await services.risk.closeFlag(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["flagId"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, flag);
  });

  // --- compliance holds ----------------------------------------------------

  router.get("/suppliers/:id/holds", async (req) =>
    jsonResponse(200, await services.risk.holds(req.ctx, req.params["id"] as Ulid)),
  );

  router.post("/suppliers/:id/holds", async (req) => {
    const body = asRecord(req.body);
    const hold = await services.risk.placeHold(req.ctx, req.params["id"] as Ulid, {
      type: requiredEnum<HoldType>(body, "type", HOLD_TYPES),
      reasonCode: requiredEnum<HoldReasonCode>(body, "reasonCode", HOLD_REASON_CODES),
      scope: optionalEnum<HoldScope>(body, "scope", HOLD_SCOPES),
      categoryIds: optionalIdArray(body, "categoryIds"),
      siteIds: optionalIdArray(body, "siteIds"),
      note: optionalString(body, "note"),
      expiresOn: optionalDate(body, "expiresOn"),
      releaseRoles: optionalStringArray(body, "releaseRoles"),
      sourceRef: optionalString(body, "sourceRef"),
    });
    return jsonResponse(201, hold);
  });

  /** Release is role-gated by the hold's own `releaseRoles`. */
  router.post("/suppliers/:id/holds/:holdId/release", async (req) => {
    const body = asRecord(req.body);
    const hold = await services.risk.releaseHold(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["holdId"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, hold);
  });

  /**
   * Non-throwing clearance check other bounded contexts call before issuing a
   * purchase order or paying an invoice.
   */
  router.get("/suppliers/:id/clearance/:activity", async (req) => {
    const activity = req.params["activity"] as HoldType;
    if (!HOLD_TYPES.includes(activity)) {
      return jsonResponse(400, {
        code: "VALIDATION",
        message: `activity must be one of [${HOLD_TYPES.join(", ")}]`,
      });
    }
    const clearance = await services.risk.clearance(req.ctx, req.params["id"] as Ulid, activity, {
      categoryId: queryId(req.query, "categoryId"),
      siteId: queryId(req.query, "siteId"),
    });
    return jsonResponse(200, clearance);
  });

  // --- award eligibility ---------------------------------------------------

  /** Blockers and warnings for awarding this supplier work today. */
  router.get("/suppliers/:id/eligibility", async (req) => {
    const assessment = await services.eligibility.assess(req.ctx, req.params["id"] as Ulid, {
      categoryId: queryId(req.query, "categoryId"),
      asOf: queryDate(req.query, "asOf"),
    });
    return jsonResponse(200, assessment);
  });
}
