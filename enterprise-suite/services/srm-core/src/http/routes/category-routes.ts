import type { Ulid } from "@enterprise-suite/shared-kernel";
import { CATEGORY_RISK_TIERS, type CategoryRiskTier } from "../../domain/category.js";
import type { SrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  nullableString,
  optionalBoolean,
  optionalEnum,
  optionalId,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredString,
} from "../validate.js";

export function registerCategoryRoutes(router: Router, container: SrmContainer): void {
  const { services } = container;

  router.post("/categories", async (req) => {
    const body = asRecord(req.body);
    const category = await services.category.create(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      parentId: optionalId(body, "parentId"),
      riskTier: optionalEnum<CategoryRiskTier>(body, "riskTier", CATEGORY_RISK_TIERS),
      requiresQualification: optionalBoolean(body, "requiresQualification"),
      requiredCertifications: optionalStringArray(body, "requiredCertifications"),
      requalificationMonths: optionalNumber(body, "requalificationMonths"),
      managerUserId: optionalString(body, "managerUserId"),
      sortOrder: optionalNumber(body, "sortOrder"),
    });
    return jsonResponse(201, category);
  });

  router.get("/categories", async (req) => jsonResponse(200, await services.category.list(req.ctx)));

  router.get("/categories/tree", async (req) => jsonResponse(200, await services.category.tree(req.ctx)));

  router.get("/categories/:id", async (req) =>
    jsonResponse(200, await services.category.get(req.ctx, req.params["id"] as Ulid)),
  );

  /** Effective policy after merging the ancestor chain. */
  router.get("/categories/:id/policy", async (req) =>
    jsonResponse(200, await services.category.policy(req.ctx, req.params["id"] as Ulid)),
  );

  router.patch("/categories/:id", async (req) => {
    const body = asRecord(req.body);
    const category = await services.category.update(req.ctx, req.params["id"] as Ulid, {
      name: optionalString(body, "name"),
      riskTier: optionalEnum<CategoryRiskTier>(body, "riskTier", CATEGORY_RISK_TIERS),
      requiresQualification: optionalBoolean(body, "requiresQualification"),
      requiredCertifications: optionalStringArray(body, "requiredCertifications"),
      requalificationMonths: optionalNumber(body, "requalificationMonths"),
      managerUserId: nullableString(body, "managerUserId"),
      sortOrder: optionalNumber(body, "sortOrder"),
      isActive: optionalBoolean(body, "isActive"),
    });
    return jsonResponse(200, category);
  });

  /** Re-parents a node and rewrites the paths of its whole subtree. */
  router.post("/categories/:id/move", async (req) => {
    const body = asRecord(req.body ?? {});
    const category = await services.category.move(req.ctx, req.params["id"] as Ulid, optionalId(body, "parentId"));
    return jsonResponse(200, category);
  });

  /** Panel review: every assigned supplier assessed against the category. */
  router.get("/categories/:id/panel", async (req) => {
    const assessments = await services.eligibility.assessCategoryPanel(req.ctx, req.params["id"] as Ulid, {
      eligibleOnly: req.query.get("eligibleOnly") === "true",
    });
    return jsonResponse(200, assessments);
  });
}
