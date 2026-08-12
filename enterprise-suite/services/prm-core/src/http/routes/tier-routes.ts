import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { SupportLevel } from "../../domain/tier.js";
import type { PrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalBoolean,
  optionalNumber,
  optionalRecord,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredNumber,
  requiredString,
} from "../validate.js";

const SUPPORT_LEVELS: readonly SupportLevel[] = ["standard", "priority", "dedicated"];

export function registerTierRoutes(router: Router, container: PrmContainer): void {
  const { tier } = container.services;

  router.get("/tiers", async (req) => jsonResponse(200, await tier.list(req.ctx)));

  router.post("/tiers", async (req) => {
    const body = asRecord(req.body);
    const requirements = optionalRecord(body["requirements"]);
    const benefits = asRecord(body["benefits"]);
    const definition = await tier.createTier(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      rank: requiredNumber(body, "rank"),
      currency: optionalString(body, "currency"),
      requirements: {
        minTrailingRevenueMinor: optionalNumber(requirements, "minTrailingRevenueMinor"),
        minCertifiedIndividuals: optionalNumber(requirements, "minCertifiedIndividuals"),
        requiredCertificationCodes: optionalStringArray(requirements, "requiredCertificationCodes"),
        minDealsWon: optionalNumber(requirements, "minDealsWon"),
        minMonthsActive: optionalNumber(requirements, "minMonthsActive"),
        requiresSignedContract: optionalBoolean(requirements, "requiresSignedContract"),
      },
      benefits: {
        baseDiscountBps: requiredNumber(benefits, "baseDiscountBps"),
        dealRegistrationBonusBps: requiredNumber(benefits, "dealRegistrationBonusBps"),
        mdfAccrualBps: requiredNumber(benefits, "mdfAccrualBps"),
        mdfRequestCapBps: requiredNumber(benefits, "mdfRequestCapBps"),
        leadSharing: optionalBoolean(benefits, "leadSharing") ?? false,
        namedChannelManager: optionalBoolean(benefits, "namedChannelManager") ?? false,
        supportLevel: requiredEnum<SupportLevel>(benefits, "supportLevel", SUPPORT_LEVELS),
        nfrSeats: requiredNumber(benefits, "nfrSeats"),
      },
    });
    return jsonResponse(201, definition);
  });

  /** Installs the reference tier ladder (registered → platinum). */
  router.post("/tiers/install-standard", async (req) =>
    jsonResponse(200, await tier.installStandardProgram(req.ctx)),
  );

  /** Scorecard: what the partner qualifies for and what is missing. */
  router.get("/partners/:id/tier-evaluation", async (req) =>
    jsonResponse(200, await tier.evaluate(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/partners/:id/tier-facts", async (req) =>
    jsonResponse(200, await tier.facts(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/partners/:id/tier-benefits", async (req) => {
    const benefits = await tier.benefitsFor(req.ctx, req.params["id"] as Ulid);
    return benefits
      ? jsonResponse(200, benefits)
      : jsonResponse(404, { code: "NOT_FOUND", message: "Partner holds no tier" });
  });

  router.post("/partners/:id/tier", async (req) => {
    const body = asRecord(req.body);
    const partner = await tier.assign(req.ctx, req.params["id"] as Ulid, {
      tierCode: requiredString(body, "tierCode"),
      reason: requiredString(body, "reason"),
      override: body["override"] === true,
    });
    return jsonResponse(200, partner.toJSON());
  });

  /** Applies the evaluated tier; downgrades need `allowDowngrade`. */
  router.post("/partners/:id/tier/auto", async (req) => {
    const body = optionalRecord(req.body);
    const review = await tier.autoAssign(req.ctx, req.params["id"] as Ulid, {
      allowDowngrade: body["allowDowngrade"] === true,
    });
    return jsonResponse(200, review);
  });

  router.post("/tier-reviews", async (req) => {
    const body = optionalRecord(req.body);
    const reviews = await tier.reviewAll(req.ctx, { allowDowngrade: body["allowDowngrade"] === true });
    return jsonResponse(200, {
      reviewed: reviews.length,
      applied: reviews.filter((r) => r.applied).length,
      reviews,
    });
  });
}
